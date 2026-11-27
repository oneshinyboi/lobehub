// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  requireWorkspaceRole,
  requireWorkspaceRoleWhenScoped,
  wsAdminProcedure,
  wsCompatProcedure,
  wsMemberProcedure,
  wsOwnerProcedure,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';

// The middleware reaches the database through `getServerDB`; point that at the
// real (PGlite) test database so the membership check runs through
// `WorkspaceModel` / `WorkspaceMemberModel`, not a hand-rolled mock.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'ws-auth-owner';
const adminId = 'ws-auth-admin';
const memberId = 'ws-auth-member';
const outsiderId = 'ws-auth-outsider';
const viewerId = 'ws-auth-viewer';

const workspaceId = 'ws-auth-workspace';
const foreignWorkspaceId = 'ws-auth-foreign-workspace';
const unknownWorkspaceId = 'ws-auth-does-not-exist';

const testRouter = router({
  admin: wsAdminProcedure.query(() => 'admin-ok'),
  compat: wsCompatProcedure.query(({ ctx }) => ({
    workspaceId: ctx.workspaceId,
    workspaceRole: ctx.workspaceRole,
    workspaceSlug: ctx.workspaceSlug,
  })),
  member: wsMemberProcedure.query(() => 'member-ok'),
  owner: wsOwnerProcedure.query(() => 'owner-ok'),
  requireAdmin: wsCompatProcedure.use(requireWorkspaceRole('admin')).query(() => 'role-ok'),
  ws: wsProcedure.query(({ ctx }) => ({
    workspaceId: ctx.workspaceId,
    workspaceRole: ctx.workspaceRole,
    workspaceSlug: ctx.workspaceSlug,
  })),
  whenScopedAdmin: wsCompatProcedure
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .query(() => 'scoped-ok'),
});

const caller = (userId: string, workspace?: string) =>
  testRouter.createCaller({ userId, workspaceId: workspace } as never);

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([
      { id: ownerId },
      { id: adminId },
      { id: memberId },
      { id: outsiderId },
      { id: viewerId },
    ]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Acme', primaryOwnerId: ownerId, slug: 'acme' },
    { id: foreignWorkspaceId, name: 'Other', primaryOwnerId: outsiderId, slug: 'other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'admin', userId: adminId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
    { role: 'viewer', userId: viewerId, workspaceId },
    { role: 'owner', userId: outsiderId, workspaceId: foreignWorkspaceId },
  ]);
});

afterEach(async () => {
  vi.mocked(getServerDB).mockClear();
});

describe('cloudWorkspaceAuth — I3 membership check', () => {
  it('refuses a caller that passes a foreign workspace id', async () => {
    // `member` belongs to `workspaceId`, not `foreignWorkspaceId`. Before this
    // middleware the header alone was enough to address the other workspace.
    await expect(caller(memberId, foreignWorkspaceId).compat()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this workspace',
    });
  });

  it('refuses an outsider even when the workspace exists', async () => {
    await expect(caller(outsiderId, workspaceId).compat()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('returns NOT_FOUND for an unknown workspace', async () => {
    await expect(caller(memberId, unknownWorkspaceId).compat()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workspace not found',
    });
  });

  it('refuses a membership that has been soft-deleted', async () => {
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(workspaceMembers.userId, memberId), eq(workspaceMembers.workspaceId, workspaceId)),
      );

    await expect(caller(memberId, workspaceId).compat()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('puts the member role and workspace slug on the context and reaches wsMemberProcedure', async () => {
    await expect(caller(memberId, workspaceId).compat()).resolves.toEqual({
      workspaceId,
      workspaceRole: 'member',
      workspaceSlug: 'acme',
    });

    await expect(caller(memberId, workspaceId).member()).resolves.toBe('member-ok');
  });
});

describe('wsProcedure — resolves membership itself', () => {
  it('refuses a foreign workspace id', async () => {
    // The gap WS-1 left: `wsProcedure` used to prove only that an id was
    // supplied. A router composing it directly was reachable with any id.
    await expect(caller(memberId, foreignWorkspaceId).ws()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this workspace',
    });
  });

  it('refuses an outsider and an unknown workspace', async () => {
    await expect(caller(outsiderId, workspaceId).ws()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(caller(memberId, unknownWorkspaceId).ws()).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('passes a member and gets the resolved role on the context', async () => {
    await expect(caller(memberId, workspaceId).ws()).resolves.toEqual({
      workspaceId,
      workspaceRole: 'member',
      workspaceSlug: 'acme',
    });
  });

  it('still refuses a viewer through wsMemberProcedure', async () => {
    // `wsProcedure` admits a viewer (membership is proven), but the member
    // gate built on top of it must reject the write-level role.
    await expect(caller(viewerId, workspaceId).ws()).resolves.toMatchObject({
      workspaceRole: 'viewer',
    });

    await expect(caller(viewerId, workspaceId).member()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Requires member role or higher',
    });
  });
});

describe('cloudWorkspaceAuth — I4 personal mode', () => {
  it('passes a request with no workspace header through unchanged', async () => {
    vi.mocked(getServerDB).mockClear();

    await expect(caller(memberId).compat()).resolves.toEqual({
      workspaceId: undefined,
      workspaceRole: undefined,
      workspaceSlug: undefined,
    });

    // No header means no workspace lookup at all.
    expect(getServerDB).not.toHaveBeenCalled();
  });

  it('leaves requireWorkspaceRoleWhenScoped inert without a workspace', async () => {
    await expect(caller(memberId).whenScopedAdmin()).resolves.toBe('scoped-ok');
  });

  it('enforces requireWorkspaceRoleWhenScoped once a workspace is in scope', async () => {
    await expect(caller(memberId, workspaceId).whenScopedAdmin()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Requires admin role or higher',
    });
  });
});

describe('role gates', () => {
  it('orders viewer < member < admin < owner', async () => {
    await expect(caller(memberId, workspaceId).owner()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Requires owner role or higher',
    });

    await expect(caller(adminId, workspaceId).admin()).resolves.toBe('admin-ok');
    await expect(caller(adminId, workspaceId).owner()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Requires owner role or higher',
    });

    await expect(caller(ownerId, workspaceId).owner()).resolves.toBe('owner-ok');
    await expect(caller(ownerId, workspaceId).admin()).resolves.toBe('admin-ok');
  });

  it('refuses requireWorkspaceRole when the context carries no role', async () => {
    // A scoped procedure that skipped `cloudWorkspaceAuth` has a workspace id
    // but no verified role; the gate must refuse rather than pass.
    const unscoped = router({
      requireAdmin: wsCompatProcedure.use(requireWorkspaceRole('admin')).query(() => 'role-ok'),
    });

    await expect(
      unscoped.createCaller({ userId: memberId, workspaceId: undefined } as never).requireAdmin(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Requires admin role or higher' });
  });
});
