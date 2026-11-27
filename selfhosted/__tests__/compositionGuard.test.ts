// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cloudWorkspaceAuth, wsProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { workspaceRouter as deviceWorkspaceRouter } from '@/server/routers/lambda/device/workspace';
import { workspaceDeviceWorkingDirProcedures } from '@/server/routers/lambda/deviceWorkspaceWorkingDirs';
import { documentCommentRouter } from '@/server/routers/lambda/documentComment';
import { documentLikeRouter } from '@/server/routers/lambda/documentLike';
import { topicCommentRouter } from '@/server/routers/lambda/topicComment';

/**
 * Check 7 of the WS-6 phase gate — the composition guard.
 *
 * WS-1 shipped `wsProcedure` without `cloudWorkspaceAuth`, so a router built
 * directly on it trusted a bare `X-Workspace-Id` header. WS-1b closed the gap,
 * but the acceptance gate did not notice it: it only exercised `wsCompatProcedure`.
 *
 * This file asserts the primitive *itself* refuses a foreign workspace, then
 * drives every procedure of the four routers that compose `wsProcedure`
 * directly. If `wsProcedure` loses `cloudWorkspaceAuth` again, these fail.
 */

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const memberA = 'guard-member-a';
const outsider = 'guard-outsider';
const workspaceX = 'guard-workspace-x';
const workspaceY = 'guard-workspace-y';
const unknownWorkspace = 'guard-workspace-missing';

const authInner = (cloudWorkspaceAuth as unknown as { _middlewares: unknown[] })._middlewares[0];

const workspaceCaller = (routerToCall: typeof wsProcedure, userId: string, workspace: string) =>
  router({
    probe: routerToCall.query(({ ctx }) => ({
      workspaceId: (ctx as { workspaceId?: string }).workspaceId,
      workspaceRole: (ctx as { workspaceRole?: string }).workspaceRole,
    })),
  }).createCaller({ userId, workspaceId: workspace } as never);

const probe = (userId: string, workspace: string) =>
  workspaceCaller(wsProcedure, userId, workspace).probe();

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: memberA }, { id: outsider }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceX, name: 'X', primaryOwnerId: memberA, slug: 'guard-x' },
    { id: workspaceY, name: 'Y', primaryOwnerId: outsider, slug: 'guard-y' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'member', userId: memberA, workspaceId: workspaceX },
    { role: 'owner', userId: outsider, workspaceId: workspaceY },
  ]);
});

describe('wsProcedure composes cloudWorkspaceAuth', () => {
  it('carries the membership middleware in its own chain', () => {
    // Structural half of the guard: `wsProcedure` must be built on
    // `cloudWorkspaceAuth`, not on `authedProcedure` alone.
    expect(
      (wsProcedure as unknown as { _def: { middlewares: unknown[] } })._def.middlewares,
    ).toContain(authInner);
  });

  it('refuses a foreign workspace id', async () => {
    await expect(probe(memberA, workspaceY)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this workspace',
    });
  });

  it('refuses a non-member and an unknown workspace', async () => {
    await expect(probe(outsider, workspaceX)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(probe(memberA, unknownWorkspace)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workspace not found',
    });
  });

  it('still resolves a real member with the role on the context', async () => {
    await expect(probe(memberA, workspaceX)).resolves.toEqual({
      workspaceId: workspaceX,
      workspaceRole: 'member',
    });
  });
});

const workingDirRouter = router({ ...workspaceDeviceWorkingDirProcedures });

const composedRouters = [
  {
    name: 'documentComment',
    required: [
      'create',
      'delete',
      'get',
      'listAnchors',
      'listReplies',
      'listThreads',
      'summary',
      'update',
    ],
    router: documentCommentRouter,
  },
  {
    name: 'documentLike',
    required: ['like', 'summary', 'unlike'],
    router: documentLikeRouter,
  },
  {
    name: 'topicComment',
    required: [
      'create',
      'delete',
      'get',
      'listReplies',
      'listThreads',
      'restore',
      'summary',
      'update',
    ],
    router: topicCommentRouter,
  },
  {
    // Mounted as `device.*`; the workspace half lives in `device/workspace.ts`.
    name: 'device',
    required: [
      'mintWorkspaceConnectToken',
      'registerWorkspaceDevice',
      'removeWorkspaceDevice',
      'setWorkspaceDeviceVisibility',
      'shareDeviceToWorkspace',
      'updateWorkspaceDevice',
    ],
    router: deviceWorkspaceRouter,
  },
  {
    name: 'device.workspaceWorkingDirs',
    required: ['addWorkspaceDeviceWorkingDir', 'removeWorkspaceDeviceWorkingDir'],
    router: workingDirRouter,
  },
];

describe.each(composedRouters)(
  'check 7 — $name composes wsProcedure directly',
  ({ required, router: composed }) => {
    const procedureNames = Object.keys(composed._def.procedures).sort();

    it('exposes the procedures the guard expects', () => {
      expect(procedureNames).toEqual(expect.arrayContaining([...required].sort()));
    });

    it('puts cloudWorkspaceAuth in every procedure chain', () => {
      for (const [name, procedure] of Object.entries(composed._def.procedures)) {
        expect(
          (procedure as unknown as { _def: { middlewares: unknown[] } })._def.middlewares,
          `${name} does not compose cloudWorkspaceAuth`,
        ).toContain(authInner);
      }
    });

    it('refuses a foreign workspace id on every procedure', async () => {
      const caller = composed.createCaller({ userId: memberA, workspaceId: workspaceY } as never);
      const failures: string[] = [];

      for (const name of procedureNames) {
        try {
          await (caller as unknown as Record<string, (input?: unknown) => Promise<unknown>>)[name](
            undefined,
          );
          failures.push(`${name}: resolved instead of refusing`);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code !== 'FORBIDDEN') failures.push(`${name}: ${code ?? (error as Error).message}`);
        }
      }

      expect(failures).toEqual([]);
    });
  },
);
