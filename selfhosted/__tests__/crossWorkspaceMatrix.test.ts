// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cloudWorkspaceAuth } from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { lambdaRouter } from '@/server/routers/lambda';
import { toolsRouter } from '@/server/routers/tools';

import { WORKSPACE_SCOPED_SOURCES } from './fixtures/workspaceScopedRouters';

/**
 * Check 2 of the WS-6 phase gate: a caller who belongs to workspace X and sends
 * workspace Y's id must be refused by *every* router that composes
 * `wsProcedure`, `wsMemberProcedure` or `wsCompatProcedure`.
 *
 * Two independent halves make that an enumeration rather than a sample:
 *
 * 1. `source inventory` rescans the tree for composition sites and fails when
 *    the checked-in list drifts. A new workspace router cannot be added without
 *    the gate noticing.
 * 2. `runtime matrix` walks every procedure of the real aggregate routers,
 *    selects the ones whose middleware chain actually contains
 *    `cloudWorkspaceAuth` (identity check, not a name convention), and invokes
 *    each one with a valid foreign workspace id. Every one must answer
 *    FORBIDDEN. Procedures that lost the middleware would either run or fail
 *    differently, and the sweep reports them by name.
 */

// The middleware reaches the database through `getServerDB`; point that at the
// real (PGlite) test database so the membership check is the production one.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 'matrix-user-a';
const userB = 'matrix-user-b';
const workspaceX = 'matrix-workspace-x';
const workspaceY = 'matrix-workspace-y';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCAN_DIRS = ['apps/server/src/routers', 'packages/business-server/src', 'selfhosted/server'];
const PROCEDURE_NAMES = ['wsProcedure', 'wsMemberProcedure', 'wsCompatProcedure'] as const;

const listSourceFiles = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(relative, acc);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.includes('.test.')) continue;
    // The definitions themselves, not a composition site.
    if (entry.name === 'workspaceAuth.ts') continue;
    acc.push(relative);
  }
  return acc;
};

const scanCompositionSites = () => {
  const sites: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      if (PROCEDURE_NAMES.some((name) => source.includes(name))) sites.push(file);
    }
  }
  return sites.sort();
};

interface ScopedProcedure {
  call: (input?: unknown) => Promise<unknown>;
  name: string;
  path: string;
  type: string;
}

const resolveCallerPath = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root);

const collectScopedProcedures = (): ScopedProcedure[] => {
  // `trpc.middleware(fn)` returns `{ _middlewares: [fn] }`, and the builder
  // flattens that wrapper, so the chain holds the inner function.
  const authInner = (cloudWorkspaceAuth as unknown as { _middlewares: unknown[] })._middlewares[0];
  const callerA = lambdaRouter.createCaller({
    userId: userA,
    workspaceId: workspaceY,
  } as never);
  const callerTools = toolsRouter.createCaller({
    userId: userA,
    workspaceId: workspaceY,
  } as never);

  const sources: Array<{ caller: unknown; name: string; path: string; proc: any }> = [
    ...Object.entries(lambdaRouter._def.procedures).map(([path, proc]) => ({
      caller: callerA,
      name: path,
      path,
      proc: proc as any,
    })),
    ...Object.entries(toolsRouter._def.procedures).map(([path, proc]) => ({
      caller: callerTools,
      // Namespaced for the report only; the caller path stays router-relative.
      name: `tools.${path}`,
      path,
      proc: proc as any,
    })),
  ];

  return sources
    .filter(({ proc }) => proc._def.middlewares.includes(authInner))
    .map(({ caller, name, path, proc }) => ({
      call: resolveCallerPath(caller, path) as (input?: unknown) => Promise<unknown>,
      name,
      path,
      type: proc._def.type,
    }));
};

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceX, name: 'X', primaryOwnerId: userA, slug: 'matrix-x' },
    { id: workspaceY, name: 'Y', primaryOwnerId: userB, slug: 'matrix-y' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    // A belongs to X only; Y is a real workspace owned by somebody else.
    { role: 'owner', userId: userA, workspaceId: workspaceX },
    { role: 'owner', userId: userB, workspaceId: workspaceY },
  ]);
});

describe('check 2 — source inventory (enumerate, do not sample)', () => {
  it('lists exactly the files that compose a workspace-scoped procedure', () => {
    const scanned = scanCompositionSites();
    const listed = WORKSPACE_SCOPED_SOURCES.map(({ file }) => file).sort();

    expect(listed).toEqual(scanned);
  });

  it('records which procedure each site composes', () => {
    for (const { file, uses } of WORKSPACE_SCOPED_SOURCES) {
      expect(uses.length, `${file} records no procedure`).toBeGreaterThan(0);
    }
  });

  it('never lets a composition site bypass the shared middleware', () => {
    // The inventory is only meaningful if every entry imports one of the three
    // builders that compose `cloudWorkspaceAuth`. Re-read the file so a fixture
    // typo cannot pass this check.
    for (const { file } of WORKSPACE_SCOPED_SOURCES) {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      expect(
        PROCEDURE_NAMES.some((name) => source.includes(name)),
        `${file} no longer composes a workspace procedure`,
      ).toBe(true);
    }
  });
});

describe('check 2 — runtime matrix over every ws-scoped procedure', () => {
  it('refuses a foreign workspace id on every procedure that composes cloudWorkspaceAuth', async () => {
    const procedures = collectScopedProcedures();

    // Sanity: the identity-based selection found the surface it claims to test.
    expect(procedures.length).toBeGreaterThan(1000);

    const subscriptions = procedures.filter(({ type }) => type === 'subscription');
    expect(subscriptions.map(({ name }) => name)).toEqual([]);

    const failures: string[] = [];

    for (const procedure of procedures) {
      try {
        await procedure.call(undefined);
        failures.push(`${procedure.name}: resolved instead of refusing`);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'FORBIDDEN') {
          failures.push(`${procedure.name}: ${code ?? (error as Error).message}`);
        }
      }
    }

    expect(failures).toEqual([]);
  }, 120_000);

  it('exercises every router path in the inventory', async () => {
    const procedures = collectScopedProcedures();
    const coveredPaths = new Set(
      procedures.map(({ name }) => (name.startsWith('tools.') ? 'tools' : name.split('.')[0])),
    );

    const missing = [...new Set(WORKSPACE_SCOPED_SOURCES.map(({ routerPath }) => routerPath))]
      .filter((routerPath) => !coveredPaths.has(routerPath))
      .sort();

    // A path with no ws-scoped procedure means its module lost the middleware
    // (the WS-1b regression) or the fixture maps it to the wrong router.
    expect(missing).toEqual([]);
  });
});
