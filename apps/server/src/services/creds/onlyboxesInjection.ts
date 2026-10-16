import debug from 'debug';

import type { MarketService } from '@/server/services/market';
import type { SandboxService } from '@/server/services/sandbox';
import { credentialFilePath, maskCredentialEnv } from '@/server/services/sandbox/credentials';

const log = debug('lobe-server:creds:onlyboxes');

/** Refuse to pull absurdly large file credentials into the sandbox. */
const MAX_FILE_CRED_BYTES = 5 * 1024 * 1024;

/** Minimal shape of a Market creds service (personal or organization-scoped). */
interface CredsAccessor {
  get: (
    id: number,
    options?: { decrypt?: boolean },
  ) => Promise<{
    fileName?: string;
    fileUrl?: string;
    manifest?: Record<string, unknown> | null;
    plaintext?: Record<string, string>;
  }>;
  list: () => Promise<{ data?: Array<{ id: number; key: string; type: string }> }>;
}

export interface OnlyboxesInjectionResult {
  credentials: {
    env?: Record<string, string>;
    files?: Array<{ filename: string; key: string; path: string }>;
  };
  notFound: string[];
  success: boolean;
  unsupportedInSandbox: string[];
}

/**
 * Resolve credentials for an Onlyboxes sandbox and write the real values into
 * it, returning only a masked env map for display.
 *
 * Market's `inject` endpoint never returns plaintext — it only ever emits a
 * masked preview, because when it performs an injection (`sandbox: true`) it
 * writes the real values into ITS OWN sandbox. Since the sandbox here is the
 * Onlyboxes one, resolve the values ourselves: `creds.get(decrypt: true)` is the
 * one Market read that returns them — plaintext for kv-env, a presigned file URL
 * for file creds.
 *
 * `inject({ sandbox: false })` is still consulted, but only for its plan: the
 * per-file path env var name, which the credential summary does not expose.
 *
 * Shared by the server-side creds runtime and the `market.creds.inject` tRPC
 * route, which is how the desktop client executes `injectCredsToSandbox`.
 */
export const injectCredsIntoOnlyboxesSandbox = async ({
  keys,
  marketService,
  sandboxService,
  topicId,
  userId,
  workspaceId,
}: {
  keys: string[];
  marketService: MarketService;
  sandboxService: SandboxService;
  topicId: string;
  userId: string;
  workspaceId?: string;
}): Promise<OnlyboxesInjectionResult> => {
  const accessor = (workspaceId
    ? marketService.market.organizations.creds({ workspaceId })
    : marketService.market.creds) as unknown as CredsAccessor;

  const list = await accessor.list();
  const byKey = new Map((list.data ?? []).map((cred) => [cred.key, cred]));

  const env: Record<string, string> = {};
  const pathEnv: Record<string, string> = {};
  const files: Array<{
    contentBase64: string;
    envName?: string;
    path: string;
  }> = [];
  const resolvedFiles: Array<{ filename: string; key: string; path: string }> = [];
  const notFound: string[] = [];
  const unsupportedInSandbox: string[] = [];

  // Market's inject plan carries each file's path env var name. Best-effort: a
  // failure here only costs the env var, never the file itself.
  const fileEnvNames = new Map<string, string>();
  if (keys.some((key) => byKey.get(key)?.type === 'file')) {
    try {
      const plan = await marketService.market.creds.inject({
        keys,
        sandbox: false,
        topicId,
        userId,
      });
      const planned = (
        plan as { credentials?: { files?: Array<{ envName?: string; key: string }> } }
      ).credentials?.files;
      for (const item of planned ?? []) {
        if (item.envName) fileEnvNames.set(item.key, item.envName);
      }
    } catch (error) {
      log('inject plan lookup failed (file env names unavailable): %O', error);
    }
  }

  for (const key of keys) {
    const cred = byKey.get(key);
    if (!cred) {
      notFound.push(key);
      continue;
    }

    if (cred.type === 'kv-env') {
      const full = await accessor.get(cred.id, { decrypt: true });
      Object.assign(env, full.plaintext ?? {});
      continue;
    }

    if (cred.type === 'file') {
      try {
        const full = await accessor.get(cred.id, { decrypt: true });
        const fileName = full.fileName ?? String(full.manifest?.fileName ?? cred.key);
        if (!full.fileUrl) throw new Error('file credential has no download URL');

        const response = await fetch(full.fileUrl);
        if (!response.ok) throw new Error(`file download failed with HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > MAX_FILE_CRED_BYTES) {
          throw new Error(`file credential exceeds ${MAX_FILE_CRED_BYTES} bytes`);
        }

        const path = credentialFilePath(key, fileName);
        const envName = fileEnvNames.get(key);
        files.push({ contentBase64: bytes.toString('base64'), envName, path });
        resolvedFiles.push({ filename: fileName, key, path });
        if (envName) pathEnv[envName] = path;
      } catch (error) {
        log('file credential %s could not be injected: %O', key, error);
        unsupportedInSandbox.push(key);
      }
      continue;
    }

    // kv-header is never sandbox-injectable, and oauth carries no decryptable
    // value, so neither can be written into a sandbox this process owns.
    unsupportedInSandbox.push(key);
  }

  if (Object.keys(env).length > 0 || files.length > 0) {
    await sandboxService.writeCredentials({ env, files });
  }

  return {
    credentials: {
      env: { ...maskCredentialEnv(env), ...pathEnv },
      files: resolvedFiles,
    },
    notFound,
    success: notFound.length === 0,
    unsupportedInSandbox,
  };
};
