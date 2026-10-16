import type { MarketService } from '@/server/services/market';
import type { SandboxService } from '@/server/services/sandbox';
import { maskCredentialEnv } from '@/server/services/sandbox/credentials';

/** Minimal shape of a Market creds service (personal or organization-scoped). */
interface CredsAccessor {
  get: (
    id: number,
    options?: { decrypt?: boolean },
  ) => Promise<{ plaintext?: Record<string, string> }>;
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
 * writes the real values into ITS OWN sandbox and nothing needs to leave the
 * response. Since the sandbox here is the Onlyboxes one, resolve the plaintext
 * ourselves: `creds.get(decrypt: true)` is the one Market read that returns real
 * values, and only for KV credentials.
 *
 * Shared by the server-side creds runtime and the `market.creds.inject` tRPC
 * route, which is how the desktop client executes `injectCredsToSandbox`.
 */
export const injectCredsIntoOnlyboxesSandbox = async ({
  keys,
  marketService,
  sandboxService,
  workspaceId,
}: {
  keys: string[];
  marketService: MarketService;
  sandboxService: SandboxService;
  workspaceId?: string;
}): Promise<OnlyboxesInjectionResult> => {
  const accessor = (workspaceId
    ? marketService.market.organizations.creds({ workspaceId })
    : marketService.market.creds) as unknown as CredsAccessor;

  const list = await accessor.list();
  const byKey = new Map((list.data ?? []).map((cred) => [cred.key, cred]));

  const env: Record<string, string> = {};
  const notFound: string[] = [];
  const unsupportedInSandbox: string[] = [];

  for (const key of keys) {
    const cred = byKey.get(key);
    if (!cred) {
      notFound.push(key);
      continue;
    }

    if (cred.type !== 'kv-env') {
      // kv-header is never sandbox-injectable, and oauth/file carry no
      // decryptable plaintext, so none of them can be written into a sandbox
      // this process owns.
      unsupportedInSandbox.push(key);
      continue;
    }

    const full = await accessor.get(cred.id, { decrypt: true });
    Object.assign(env, full.plaintext ?? {});
  }

  if (Object.keys(env).length > 0) {
    await sandboxService.writeCredentials({ env });
  }

  return {
    credentials: { env: maskCredentialEnv(env), files: [] },
    notFound,
    success: notFound.length === 0,
    unsupportedInSandbox,
  };
};
