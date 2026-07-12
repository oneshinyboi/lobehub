import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { createFileStoreImageUploader } from '@lobechat/heterogeneous-agents/spawn';
import {
  buildClaudeCodeImportPayload,
  buildCodexImportPayload,
  parseClaudeCodeSession,
  parseClaudeCodeSessionDigest,
  parseCodexSessionDigest,
  rewriteImagePlaceholders,
} from '@lobechat/heterogeneous-agents/transcript';
import type {
  HeteroSessionDigest,
  HeteroSessionDirGroup,
  HeteroSessionDirPref,
  HeteroSessionImportMessage,
  HeteroSessionImportPayload,
  HeteroSessionImportSource,
  HeteroSessionImportThread,
  HeteroSessionScanResult,
} from '@lobechat/types';

import { compressTranscriptImage } from '@/modules/heterogeneousAgent/compressTranscriptImage';
import { createLambdaFileStorePort } from '@/modules/heterogeneousAgent/fileStorePort';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:HeteroSessionCtr');

/**
 * Sidecar Claude Code writes next to every `subagents/agent-<id>.jsonl`.
 * `toolUseId` is what links the subagent transcript back to the `Agent` tool
 * call that spawned it — without it the imported thread has nothing to hang on.
 */
interface SubagentMeta {
  agentType?: string;
  description?: string;
  spawnDepth?: number;
  toolUseId?: string;
}

const claudeProjectsRoot = () => path.join(homedir(), '.claude', 'projects');
const codexSessionsRoot = () => path.join(homedir(), '.codex', 'sessions');

/**
 * Sessions recorded under throwaway directories (agent probes, mkdtemp
 * scratch dirs) are ignored by default — they land in the Ignored group and
 * can be restored explicitly (which stores a `none` pref so the default
 * doesn't re-apply).
 */
const TEMP_DIR_PREFIXES = ['/tmp/', '/private/tmp/', '/private/var/folders/', '/var/folders/'];
const isTempWorkingDirectory = (dir: string) =>
  TEMP_DIR_PREFIXES.some((prefix) => dir.startsWith(prefix)) ||
  dir === '/tmp' ||
  dir === '/private/tmp';

/**
 * HeteroSessionController
 *
 * Discovers local CLI agent transcripts (Claude Code / Codex) and turns them
 * into normalized import payloads for `topic.importHeteroSessions`.
 *
 * Grouping is keyed by the RESOLVED workingDirectory, not the storage folder:
 * a session started in the main repo and switched into a worktree is stored
 * under the worktree slug folder while its cwd still points at the main repo,
 * so several storage folders can map onto one cwd.
 */
export default class HeteroSessionController extends ControllerModule {
  static override readonly groupName = 'heteroSession';

  /**
   * Full scan of both CLI transcript roots. Per-file failures land in
   * `errors` instead of failing the scan.
   */
  @IpcMethod()
  async listLocalSessions(): Promise<HeteroSessionScanResult> {
    const errors: string[] = [];
    const groups = new Map<string, HeteroSessionDirGroup>();

    const addDigest = (source: HeteroSessionImportSource, digest: HeteroSessionDigest) => {
      if (!digest.workingDirectory) return;
      const key = `${source}::${digest.workingDirectory}`;
      const group = groups.get(key) ?? {
        isGit: false,
        sessionCount: 0,
        sessions: [],
        source,
        totalTokens: 0,
        workingDirectory: digest.workingDirectory,
      };
      group.sessionCount++;
      group.totalTokens += digest.tokens ?? 0;
      group.isGit ||= Boolean(digest.gitBranch);
      group.sessions.push(digest);
      groups.set(key, group);
    };

    // Claude Code: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
    const ccRoot = claudeProjectsRoot();
    if (existsSync(ccRoot)) {
      for (const folder of await readdir(ccRoot)) {
        const folderPath = path.join(ccRoot, folder);
        try {
          if (!(await stat(folderPath)).isDirectory()) continue;
        } catch {
          continue;
        }
        for (const file of await readdir(folderPath)) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = path.join(folderPath, file);
          try {
            if (!(await stat(filePath)).isFile()) continue;
            const digest = parseClaudeCodeSessionDigest(await readFile(filePath, 'utf8'), filePath);
            if (digest) addDigest('claude-code', digest);
          } catch (error) {
            errors.push(`${filePath}: ${(error as Error).message}`);
          }
        }
      }
    }

    // Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    const codexRoot = codexSessionsRoot();
    if (existsSync(codexRoot)) {
      const walk = async (dir: string) => {
        for (const entry of await readdir(dir)) {
          const entryPath = path.join(dir, entry);
          try {
            const info = await stat(entryPath);
            if (info.isDirectory()) {
              await walk(entryPath);
            } else if (entry.endsWith('.jsonl')) {
              const digest = parseCodexSessionDigest(await readFile(entryPath, 'utf8'), entryPath);
              if (digest) addDigest('codex', digest);
            }
          } catch (error) {
            errors.push(`${entryPath}: ${(error as Error).message}`);
          }
        }
      };
      await walk(codexRoot);
    }

    const dirPrefs = this.app.storeManager.get('heteroSessionDirPrefs', {});
    const result = [...groups.values()]
      .map((group) => {
        group.sessions.sort((a, b) => (b.endAt ?? '').localeCompare(a.endAt ?? ''));
        const stored = dirPrefs[`${group.source}::${group.workingDirectory}`];
        // stored 'none' = user explicitly restored a default-ignored dir
        const pref =
          stored === 'none'
            ? undefined
            : (stored ?? (isTempWorkingDirectory(group.workingDirectory) ? 'ignored' : undefined));
        return pref ? { ...group, dirPref: pref } : group;
      })
      .sort((a, b) => b.sessionCount - a.sessionCount);

    logger.debug(
      `scanned ${result.reduce((s, g) => s + g.sessionCount, 0)} sessions in ${result.length} dirs (${errors.length} errors)`,
    );
    return { errors, groups: result };
  }

  /**
   * Parse one transcript into the normalized import payload. For Claude Code,
   * subagent transcripts under `<sessionId>/subagents/` are attached as threads.
   */
  @IpcMethod()
  async readLocalSession(params: {
    filePath: string;
    source: HeteroSessionImportSource;
  }): Promise<HeteroSessionImportPayload | null> {
    const { filePath, source } = params;
    const root = source === 'claude-code' ? claudeProjectsRoot() : codexSessionsRoot();
    // IPC-exposed file read — only transcripts under the CLI roots are readable
    const relative = path.relative(path.resolve(root), path.resolve(filePath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`refusing to read transcript outside ${root}`);
    }

    const content = await readFile(filePath, 'utf8');
    const payload =
      source === 'codex' ? buildCodexImportPayload(content) : buildClaudeCodeImportPayload(content);
    if (!payload) return null;

    if (source === 'claude-code')
      payload.threads = await this.readSubagentThreads(filePath, payload);

    await this.uploadPayloadImages(payload);

    return payload;
  }

  /**
   * Parse the subagent transcripts of a Claude Code session into threads.
   *
   * Each `subagents/agent-<id>.jsonl` has a sibling `agent-<id>.meta.json`
   * carrying the `toolUseId` of the `Agent` tool call that spawned it. That id is
   * what the CC `Agent` render matches a thread on (`metadata.sourceToolCallId`),
   * so it — not the file name — is what makes the subagent conversation expand
   * inline under its tool call. A transcript without the sidecar (pre-sidecar CC
   * versions) still imports; it just stays unattached.
   *
   * Threads are returned parent-first, so a nested subagent's spawning tool call
   * has already been assigned a message id by the time the importer resolves it.
   */
  private async readSubagentThreads(
    filePath: string,
    payload: HeteroSessionImportPayload,
  ): Promise<HeteroSessionImportThread[] | undefined> {
    const subagentsDir = path.join(
      path.dirname(filePath),
      path.basename(filePath, '.jsonl'),
      'subagents',
    );
    if (!existsSync(subagentsDir)) return undefined;

    const parsedThreads: { depth: number; thread: HeteroSessionImportThread }[] = [];

    for (const file of await readdir(subagentsDir)) {
      if (!file.endsWith('.jsonl')) continue;
      try {
        const parsed = parseClaudeCodeSession(
          await readFile(path.join(subagentsDir, file), 'utf8'),
          { sessionIdOverride: payload.sessionId, sidechain: true },
        );
        if (!parsed) continue;

        const agentId = path.basename(file, '.jsonl');
        const meta = await this.readSubagentMeta(path.join(subagentsDir, `${agentId}.meta.json`));

        parsedThreads.push({
          depth: meta?.spawnDepth ?? 1,
          thread: {
            // agent file names (`agent-<hex>`) are globally unique — no session scoping needed
            clientId: `claude-code-thread-${agentId}`,
            messages: parsed.messages,
            metadata: {
              ...(meta?.toolUseId ? { sourceToolCallId: meta.toolUseId } : {}),
              ...(meta?.agentType ? { subagentType: meta.agentType } : {}),
            },
            status: 'completed',
            title: meta?.description ?? parsed.title,
            // matches the live spawn path — the sidebar badges a subagent off this
            type: 'isolation',
          },
        });
      } catch (error) {
        logger.warn(`failed to parse subagent transcript ${file}: ${(error as Error).message}`);
      }
    }

    if (parsedThreads.length === 0) return undefined;

    parsedThreads.sort((a, b) => a.depth - b.depth);
    const threads = parsedThreads.map((t) => t.thread);

    // anchor each thread on the assistant message that emitted its tool call.
    // A depth-2 subagent's `Agent` call lives inside a depth-1 thread, so the
    // lookup spans the main chain AND the already-anchored threads.
    const searched: HeteroSessionImportMessage[][] = [payload.messages];
    for (const thread of threads) {
      const toolCallId = thread.metadata?.sourceToolCallId;
      const owner = toolCallId
        ? searched.flat().find((m) => m.tools?.some((tool) => tool.id === toolCallId))
        : undefined;

      if (owner) {
        thread.sourceMessageClientId = owner.clientId;
        // the thread's opening prompt hangs off the spawning message, mirroring
        // the seed message the live path writes with `parentId = mainAssistantId`
        const [first] = thread.messages;
        if (first && !first.parentClientId) first.parentClientId = owner.clientId;
      }
      searched.push(thread.messages);
    }

    return threads;
  }

  private async readSubagentMeta(metaPath: string): Promise<SubagentMeta | undefined> {
    try {
      return JSON.parse(await readFile(metaPath, 'utf8')) as SubagentMeta;
    } catch {
      // pre-sidecar CC versions, or a truncated write — the thread still imports
      return undefined;
    }
  }

  /**
   * Upload every base64 image the parsers carried out of the transcript, and
   * replace it with a file reference. Runs here, in main, because this is the
   * only process holding file-store credentials — and because a single pasted
   * screenshot is routinely several MB, which must never be shipped through the
   * tRPC import payload.
   *
   * Where the reference lands depends on the role, matching how each is rendered:
   * - `tool` → `pluginState.images`, which the CC tool renders read (same shape
   *   the live spawn path persists), and the placeholder becomes a markdown image
   * - everything else → `fileIds`, attached as native message files (thumbnails)
   *
   * Degradation is deliberate: no authed server, or a failed upload, leaves the
   * text placeholder in place rather than failing the import of a whole session.
   */
  private async uploadPayloadImages(payload: HeteroSessionImportPayload): Promise<void> {
    const messages = [...payload.messages, ...(payload.threads ?? []).flatMap((t) => t.messages)];
    const withImages = messages.filter((m) => m.images?.length);
    if (withImages.length === 0) return;

    for (const message of withImages) {
      const images = message.images ?? [];
      const uploaded = [];

      for (const image of images) {
        try {
          // downscale first: a Retina screenshot is commonly several MB, and one
          // session can inline dozens of them
          const bytes = image.data
            ? compressTranscriptImage({ data: image.data, mediaType: image.mediaType })
            : undefined;
          const ref = bytes ? await this.uploadImage(bytes) : undefined;
          // `undefined` → no file store to upload into; keep the placeholder
          uploaded.push(
            ref ? { fileId: ref.fileId, mediaType: bytes!.mediaType, url: ref.url } : image,
          );
        } catch (error) {
          logger.warn(`failed to upload transcript image: ${(error as Error).message}`);
          uploaded.push(image);
        }
      }

      const stored = uploaded.filter((image) => image.fileId);
      if (message.role === 'tool') {
        if (stored.length > 0) message.pluginState = { ...message.pluginState, images: stored };
        message.content = rewriteImagePlaceholders(message.content, uploaded, 'markdown');
      } else {
        if (stored.length > 0) message.fileIds = stored.map((image) => image.fileId!);
        message.content = rewriteImagePlaceholders(message.content, uploaded, 'strip');
      }

      // base64 must not cross the IPC/tRPC boundary — this is the only strip point
      delete message.images;
    }
  }

  /**
   * Uploads a base64 image lifted out of a transcript to the file store, so the
   * imported message carries a `{ fileId, url }` reference. Same port the live
   * spawn path uses for CC `Read` tool_result images.
   */
  private uploadImage = createFileStoreImageUploader(() =>
    createLambdaFileStorePort({
      getAccessToken: () => this.app.getController(RemoteServerConfigCtr).getAccessToken(),
      getServerUrl: async () =>
        (await this.app.getController(RemoteServerConfigCtr).getRemoteServerUrl()) ?? null,
    }),
  );

  @IpcMethod()
  async getDirPrefs(): Promise<Record<string, HeteroSessionDirPref>> {
    return this.app.storeManager.get('heteroSessionDirPrefs', {});
  }

  /**
   * Set or clear (pref = null) the preference of one directory,
   * keyed by `${source}::${workingDirectory}`. Clearing a default-ignored
   * (temp) directory stores `none` so the default doesn't re-apply.
   */
  @IpcMethod()
  async setDirPref(params: { key: string; pref: HeteroSessionDirPref | null }): Promise<void> {
    const prefs = { ...this.app.storeManager.get('heteroSessionDirPrefs', {}) };
    const workingDirectory = params.key.split('::')[1] ?? '';
    if (params.pref) prefs[params.key] = params.pref;
    else if (isTempWorkingDirectory(workingDirectory)) prefs[params.key] = 'none';
    else delete prefs[params.key];
    this.app.storeManager.set('heteroSessionDirPrefs', prefs);
  }
}
