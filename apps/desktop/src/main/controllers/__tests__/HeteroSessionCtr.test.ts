import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import HeteroSessionCtr from '../HeteroSessionCtr';

const { ipcMainHandleMock, homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn(),
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, homedir: homedirMock };
});

// the file store the transcript images are uploaded into; `undefined` = signed out
const { fileStorePortMock } = vi.hoisted(() => ({ fileStorePortMock: vi.fn() }));

vi.mock('@/modules/heterogeneousAgent/fileStorePort', () => ({
  createLambdaFileStorePort: () => fileStorePortMock(),
}));

// ---------- fixtures ----------

const fakeHome = mkdtempSync(path.join(tmpdir(), 'hetero-session-ctr-'));
homedirMock.mockReturnValue(fakeHome);

const ccLine = (record: Record<string, any>) => JSON.stringify(record);

const AGENT_TOOL_USE_ID = 'toolu_agent1';
const PNG_BASE64 = 'aW1hZ2UtYnl0ZXM=';

/**
 * `agentToolUse` adds an `Agent` tool call to the assistant turn — the anchor a
 * subagent thread hangs on. `image` pastes a base64 screenshot into the user
 * turn, as CC records one.
 */
const writeCcSession = (
  folder: string,
  sessionId: string,
  cwd: string,
  opts?: { agentToolUse?: boolean; image?: boolean },
) => {
  const dir = path.join(fakeHome, '.claude', 'projects', folder);
  mkdirSync(dir, { recursive: true });
  const lines = [
    ccLine({
      cwd,
      gitBranch: 'main',
      isSidechain: false,
      message: {
        content: [
          { text: `question of ${sessionId}`, type: 'text' },
          ...(opts?.image
            ? [
                {
                  source: { data: PNG_BASE64, media_type: 'image/png', type: 'base64' },
                  type: 'image',
                },
              ]
            : []),
        ],
        role: 'user',
      },
      parentUuid: null,
      sessionId,
      timestamp: '2026-07-01T00:00:00.000Z',
      type: 'user',
      uuid: `${sessionId}-u1`,
    }),
    ccLine({
      isSidechain: false,
      message: {
        content: [
          { text: 'answer', type: 'text' },
          ...(opts?.agentToolUse
            ? [
                {
                  id: AGENT_TOOL_USE_ID,
                  input: { description: 'Probe the repo' },
                  name: 'Agent',
                  type: 'tool_use',
                },
              ]
            : []),
        ],
        id: `${sessionId}-msg1`,
        model: 'claude-opus-4-8',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      parentUuid: `${sessionId}-u1`,
      sessionId,
      timestamp: '2026-07-01T00:00:01.000Z',
      type: 'assistant',
      uuid: `${sessionId}-a1`,
    }),
    ccLine({ leafUuid: `${sessionId}-a1`, sessionId, type: 'last-prompt' }),
  ];
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  writeFileSync(filePath, lines.join('\n'));
  return filePath;
};

/** `meta` mirrors the `agent-<id>.meta.json` sidecar CC writes next to each transcript */
const writeCcSubagent = (
  sessionFilePath: string,
  sessionId: string,
  agentId = 'agent-abc',
  meta?: Record<string, unknown>,
) => {
  const subDir = path.join(sessionFilePath.replace(/\.jsonl$/, ''), 'subagents');
  mkdirSync(subDir, { recursive: true });
  const lines = [
    ccLine({
      agentId: 'sub1',
      isSidechain: true,
      message: { content: [{ text: 'subagent prompt', type: 'text' }], role: 'user' },
      parentUuid: null,
      sessionId,
      timestamp: '2026-07-01T00:00:02.000Z',
      type: 'user',
      uuid: `${sessionId}-${agentId}-s1`,
    }),
    ccLine({
      agentId: 'sub1',
      isSidechain: true,
      message: { content: [{ text: 'subagent answer', type: 'text' }], id: `${sessionId}-smsg` },
      parentUuid: `${sessionId}-${agentId}-s1`,
      sessionId,
      timestamp: '2026-07-01T00:00:03.000Z',
      type: 'assistant',
      uuid: `${sessionId}-${agentId}-s2`,
    }),
  ];
  writeFileSync(path.join(subDir, `${agentId}.jsonl`), lines.join('\n'));
  if (meta) writeFileSync(path.join(subDir, `${agentId}.meta.json`), JSON.stringify(meta));
};

const writeCodexSession = (sessionId: string, cwd: string) => {
  const dir = path.join(fakeHome, '.codex', 'sessions', '2026', '07', '01');
  mkdirSync(dir, { recursive: true });
  const lines = [
    ccLine({
      payload: { cwd, git: { branch: 'main' }, id: sessionId },
      timestamp: '2026-07-01T00:00:00.000Z',
      type: 'session_meta',
    }),
    ccLine({
      payload: {
        content: [{ text: 'codex question', type: 'input_text' }],
        role: 'user',
        type: 'message',
      },
      timestamp: '2026-07-01T00:00:01.000Z',
      type: 'response_item',
    }),
    ccLine({
      payload: {
        content: [{ text: 'codex answer', type: 'output_text' }],
        role: 'assistant',
        type: 'message',
      },
      timestamp: '2026-07-01T00:00:02.000Z',
      type: 'response_item',
    }),
  ];
  const filePath = path.join(dir, `rollout-${sessionId}.jsonl`);
  writeFileSync(filePath, lines.join('\n'));
  return filePath;
};

// two CC storage folders resolving to the SAME cwd (EnterWorktree case) + one other cwd
const ccFileA = writeCcSession('-repo-main', 'sess-a', '/repo/main', {
  agentToolUse: true,
  image: true,
});
writeCcSession('-repo-main--claude-worktrees-x', 'sess-b', '/repo/main');
const ccFileC = writeCcSession('-repo-other', 'sess-c', '/repo/other');
writeCcSubagent(ccFileA, 'sess-a', 'agent-abc', {
  agentType: 'Explore',
  description: 'Probe the repo',
  spawnDepth: 1,
  toolUseId: AGENT_TOOL_USE_ID,
});
// a subagent from a pre-sidecar CC version: transcript, but no meta.json
writeCcSubagent(ccFileC, 'sess-c', 'agent-legacy');
writeCcSession('-tmp-probe', 'sess-tmp', '/tmp/probe');
const codexFile = writeCodexSession('cdx-1', '/repo/main');
// corrupt file must not fail the scan
writeFileSync(
  path.join(fakeHome, '.claude', 'projects', '-repo-main', 'broken.jsonl'),
  '{not json',
);

afterAll(() => {
  rmSync(fakeHome, { force: true, recursive: true });
});

// ---------- app mock ----------

const storeData: Record<string, any> = { heteroSessionDirPrefs: {} };
const mockApp = {
  getController: vi.fn(() => ({
    getAccessToken: async () => 'token',
    getRemoteServerUrl: async () => 'https://server.test',
  })),
  storeManager: {
    get: vi.fn((key: string, fallback?: any) => storeData[key] ?? fallback),
    set: vi.fn((key: string, value: any) => {
      storeData[key] = value;
    }),
  },
} as unknown as App;

/** an authed file store: hash miss → presign → PUT → file record */
const signedInFileStore = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' })),
  );
  fileStorePortMock.mockResolvedValue({
    checkFileHash: async () => ({ isExist: false }),
    createFile: async () => ({ id: 'file-1', url: 'https://cdn.test/shot.png' }),
    createS3PreSignedUrl: async () => 'https://s3.test/put',
  });
};

describe('HeteroSessionCtr', () => {
  let controller: HeteroSessionCtr;

  beforeEach(() => {
    storeData.heteroSessionDirPrefs = {};
    // default: signed out — no file store to upload into
    fileStorePortMock.mockReset().mockResolvedValue(undefined);
    controller = new HeteroSessionCtr(mockApp);
  });

  describe('listLocalSessions', () => {
    it('aggregates by resolved workingDirectory across storage folders', async () => {
      const { errors, groups } = await controller.listLocalSessions();

      const ccMain = groups.find(
        (g) => g.source === 'claude-code' && g.workingDirectory === '/repo/main',
      )!;
      // sess-a and sess-b live in different storage folders but share the cwd
      expect(ccMain.sessionCount).toBe(2);
      expect(ccMain.isGit).toBe(true);
      expect(ccMain.totalTokens).toBe(300); // 2 × (100 + 50)

      expect(
        groups.find((g) => g.source === 'claude-code' && g.workingDirectory === '/repo/other')
          ?.sessionCount,
      ).toBe(1);
      expect(
        groups.find((g) => g.source === 'codex' && g.workingDirectory === '/repo/main')
          ?.sessionCount,
      ).toBe(1);
      // the corrupt file is skipped silently (unparsable lines ≠ scan error)
      expect(errors).toEqual([]);
    });

    it('attaches persisted dir prefs to their groups', async () => {
      storeData.heteroSessionDirPrefs = { 'claude-code::/repo/other': 'ignored' };
      const { groups } = await controller.listLocalSessions();

      expect(
        groups.find((g) => g.source === 'claude-code' && g.workingDirectory === '/repo/other')
          ?.dirPref,
      ).toBe('ignored');
      expect(
        groups.find((g) => g.source === 'claude-code' && g.workingDirectory === '/repo/main')
          ?.dirPref,
      ).toBeUndefined();
    });
  });

  describe('temp directory defaults', () => {
    it('default-ignores temp working directories', async () => {
      const { groups } = await controller.listLocalSessions();
      expect(groups.find((g) => g.workingDirectory === '/tmp/probe')?.dirPref).toBe('ignored');
    });

    it('restoring a temp dir stores `none` so the default does not re-apply', async () => {
      await controller.setDirPref({ key: 'claude-code::/tmp/probe', pref: null });
      expect(storeData.heteroSessionDirPrefs).toEqual({ 'claude-code::/tmp/probe': 'none' });

      const { groups } = await controller.listLocalSessions();
      expect(groups.find((g) => g.workingDirectory === '/tmp/probe')?.dirPref).toBeUndefined();
    });
  });

  describe('readLocalSession', () => {
    it('builds a Claude Code payload with subagent threads', async () => {
      const payload = await controller.readLocalSession({
        filePath: ccFileA,
        source: 'claude-code',
      });

      expect(payload?.topicClientId).toBe('claude-code-session-sess-a');
      expect(payload?.messages).toHaveLength(2);
      expect(payload?.threads).toHaveLength(1);
      expect(payload?.threads?.[0].messages).toHaveLength(2);
    });

    it('anchors a subagent thread on the tool call that spawned it', async () => {
      const payload = await controller.readLocalSession({
        filePath: ccFileA,
        source: 'claude-code',
      });

      const [thread] = payload!.threads!;
      const assistant = payload!.messages.find((m) => m.role === 'assistant')!;

      expect(thread).toMatchObject({
        clientId: 'claude-code-thread-agent-abc',
        // the CC Agent render finds the subagent conversation by this id — a
        // thread without it never expands under its tool call
        metadata: { sourceToolCallId: AGENT_TOOL_USE_ID, subagentType: 'Explore' },
        title: 'Probe the repo',
        type: 'isolation',
      });
      expect(thread.sourceMessageClientId).toBe(assistant.clientId);
      // the thread's opening prompt hangs off the spawning message
      expect(thread.messages[0].parentClientId).toBe(assistant.clientId);
    });

    it('still imports a subagent transcript that has no meta.json sidecar', async () => {
      const payload = await controller.readLocalSession({
        filePath: ccFileC,
        source: 'claude-code',
      });

      const [thread] = payload!.threads!;
      expect(thread.clientId).toBe('claude-code-thread-agent-legacy');
      expect(thread.metadata?.sourceToolCallId).toBeUndefined();
      expect(thread.sourceMessageClientId).toBeUndefined();
    });

    it('builds a Codex payload', async () => {
      const payload = await controller.readLocalSession({
        filePath: codexFile,
        source: 'codex',
      });

      expect(payload?.topicClientId).toBe('codex-session-cdx-1');
      expect(payload?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });

    it('uploads embedded images and attaches them as message files', async () => {
      signedInFileStore();

      const payload = await controller.readLocalSession({
        filePath: ccFileA,
        source: 'claude-code',
      });

      const user = payload!.messages.find((m) => m.role === 'user')!;
      expect(user.fileIds).toEqual(['file-1']);
      // base64 must never reach the server — it is stripped once uploaded
      expect(user.images).toBeUndefined();
      // the file renders as a native attachment, so the marker is dropped
      expect(user.content).toBe('question of sess-a');
    });

    it('keeps the placeholder when there is no file store to upload into', async () => {
      const payload = await controller.readLocalSession({
        filePath: ccFileA,
        source: 'claude-code',
      });

      const user = payload!.messages.find((m) => m.role === 'user')!;
      expect(user.fileIds).toBeUndefined();
      expect(user.images).toBeUndefined();
      // silently dropping the image would erase the fact that one was there
      expect(user.content).toContain('![imported image placeholder]');
    });

    it('refuses to read files outside the CLI transcript roots', async () => {
      await expect(
        controller.readLocalSession({ filePath: '/etc/passwd', source: 'claude-code' }),
      ).rejects.toThrow('outside');
    });

    it('refuses a sibling directory that merely shares the root prefix', async () => {
      const sibling = path.join(fakeHome, '.claude', 'projects-evil', 'sess.jsonl');
      mkdirSync(path.dirname(sibling), { recursive: true });
      writeFileSync(sibling, '');

      await expect(
        controller.readLocalSession({ filePath: sibling, source: 'claude-code' }),
      ).rejects.toThrow('outside');
    });
  });

  describe('dir prefs', () => {
    it('sets, persists and clears preferences', async () => {
      await controller.setDirPref({ key: 'codex::/repo/main', pref: 'watched' });
      expect(await controller.getDirPrefs()).toEqual({ 'codex::/repo/main': 'watched' });

      await controller.setDirPref({ key: 'codex::/repo/main', pref: null });
      expect(await controller.getDirPrefs()).toEqual({});
    });
  });
});
