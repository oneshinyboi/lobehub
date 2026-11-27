// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cloudWorkspaceAuth,
  lobeWorkspaceAuth,
  wsCompatProcedure,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';

/**
 * Check 6 of the WS-6 phase gate — the regression guard.
 *
 * The legacy test deleted by WS-6 asserted the *vulnerable* behaviour: that a
 * bare `X-Workspace-Id` is trusted. This file asserts the opposite and is
 * designed to fail the moment `cloudWorkspaceAuth` is reverted to a pass-through:
 *
 * - the same foreign-workspace call that a pass-through middleware resolves must
 *   now be refused;
 * - a valid workspace the caller is not a member of is FORBIDDEN, not empty;
 * - an unknown workspace is NOT_FOUND;
 * - a soft-deleted membership is FORBIDDEN;
 * - personal mode still passes untouched and does not even consult the database.
 */

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const memberId = 'reg-member';
const ownerId = 'reg-owner';
const workspaceX = 'reg-workspace-x';
const workspaceY = 'reg-workspace-y';
const unknownWorkspace = 'reg-workspace-missing';

const securedRouter = router({
  probe: wsCompatProcedure.query(({ ctx }) => ({
    workspaceId: ctx.workspaceId,
    workspaceRole: ctx.workspaceRole,
    workspaceSlug: ctx.workspaceSlug,
  })),
});

// Deliberately redundant with check 7: the WS-1b regression removed
// `cloudWorkspaceAuth` from `wsProcedure` only, so the guard must notice that
// shape too, not just a pass-through `cloudWorkspaceAuth`.
const wsProcedureRouter = router({
  probe: wsProcedure.query(({ ctx }) => ({ workspaceId: ctx.workspaceId })),
});

// The pass-through the security fix replaced, kept only as a control: it shows
// what "vulnerable" looks like so the secured assertion cannot be vacuous.
const passthroughRouter = router({
  probe: authedProcedure.use(lobeWorkspaceAuth).query(({ ctx }) => ({
    workspaceId: ctx.workspaceId,
  })),
});

const caller = (userId: string, workspace?: string) =>
  securedRouter.createCaller({ userId, workspaceId: workspace } as never);

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: memberId }, { id: ownerId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceX, name: 'X', primaryOwnerId: memberId, slug: 'reg-x' },
    { id: workspaceY, name: 'Y', primaryOwnerId: ownerId, slug: 'reg-y' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'member', userId: memberId, workspaceId: workspaceX },
    { role: 'owner', userId: ownerId, workspaceId: workspaceY },
  ]);
});

afterEach(() => {
  vi.mocked(getServerDB).mockClear();
});

describe('check 6 — cloudWorkspaceAuth is not a pass-through', () => {
  it('is a different middleware from the pass-through stub', () => {
    const secured = (cloudWorkspaceAuth as unknown as { _middlewares: unknown[] })._middlewares[0];
    const passthrough = (lobeWorkspaceAuth as unknown as { _middlewares: unknown[] })
      ._middlewares[0];

    expect(secured).not.toBe(passthrough);
  });

  it('refuses what the pass-through would have allowed', async () => {
    // Control: the vulnerable composition trusts the header.
    await expect(
      passthroughRouter
        .createCaller({ userId: memberId, workspaceId: workspaceY } as never)
        .probe(),
    ).resolves.toEqual({ workspaceId: workspaceY });

    // Secured: the same request is refused.
    await expect(caller(memberId, workspaceY).probe()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this workspace',
    });
  });

  it('refuses a valid workspace the caller is not in with FORBIDDEN', async () => {
    await expect(caller(memberId, workspaceY).probe()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('answers NOT_FOUND for a workspace that does not exist', async () => {
    await expect(caller(memberId, unknownWorkspace).probe()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workspace not found',
    });
  });

  it('refuses a membership that has been soft-deleted', async () => {
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(workspaceMembers.userId, memberId), eq(workspaceMembers.workspaceId, workspaceX)),
      );

    await expect(caller(memberId, workspaceX).probe()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('still admits the real member and attaches the resolved identity', async () => {
    await expect(caller(memberId, workspaceX).probe()).resolves.toEqual({
      workspaceId: workspaceX,
      workspaceRole: 'member',
      workspaceSlug: 'reg-x',
    });
  });

  it('also refuses through wsProcedure, so the WS-1b regression fails here too', async () => {
    await expect(
      wsProcedureRouter
        .createCaller({ userId: memberId, workspaceId: workspaceY } as never)
        .probe(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      wsProcedureRouter
        .createCaller({ userId: memberId, workspaceId: workspaceX } as never)
        .probe(),
    ).resolves.toEqual({ workspaceId: workspaceX });
  });

  it('leaves personal mode untouched and does not consult the database', async () => {
    await expect(caller(memberId).probe()).resolves.toEqual({
      workspaceId: undefined,
      workspaceRole: undefined,
      workspaceSlug: undefined,
    });

    expect(getServerDB).not.toHaveBeenCalled();
  });
});
