// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { authedProcedure, router } from '@/libs/trpc/lambda';

import {
  hasMinWorkspaceRole,
  withAllRbacPermissions,
  withAnyRbacPermission,
  withRbacPermission,
  withScopedPermission,
  workspaceRoleHasPermission,
} from '../permissions';

const testRouter = router({
  all: authedProcedure
    .use(withAllRbacPermissions(['agent:read', 'agent:create']))
    .query(() => 'ok'),
  any: authedProcedure
    .use(withAnyRbacPermission(['workspace:billing_manage', 'agent:create']))
    .query(() => 'ok'),
  manage: authedProcedure.use(withRbacPermission('workspace:settings_update')).query(() => 'ok'),
  scope: authedProcedure.use(withScopedPermission('agent:update')).query(() => 'ok'),
});

const caller = (ctx: Record<string, unknown>) =>
  testRouter.createCaller({ userId: 'user-1', ...ctx } as never);

const workspaceCaller = (workspaceRole: string) => caller({ workspaceId: 'ws-1', workspaceRole });

describe('workspaceRoleHasPermission', () => {
  it('expands the membership role through the D4 matrix', () => {
    expect(workspaceRoleHasPermission('viewer', 'agent:update')).toBe(false);
    expect(workspaceRoleHasPermission('member', 'agent:update')).toBe(true);
    expect(workspaceRoleHasPermission('admin', 'workspace:settings_update')).toBe(true);
    expect(workspaceRoleHasPermission('member', 'workspace:settings_update')).toBe(false);
    expect(workspaceRoleHasPermission('admin', 'workspace:billing_manage')).toBe(false);
    expect(workspaceRoleHasPermission('owner', 'workspace:billing_manage')).toBe(true);
  });

  it('accepts any granted scope for a bare action code', () => {
    // `agent:update` is `:owner` for Member, `:all` for Admin.
    expect(workspaceRoleHasPermission('member', 'agent:update')).toBe(true);
    expect(workspaceRoleHasPermission('admin', 'agent:update')).toBe(true);
    // `topic:update:all` is Owner-only; Admin curates agents, not topics.
    expect(workspaceRoleHasPermission('owner', 'topic:update:all')).toBe(true);
    expect(workspaceRoleHasPermission('admin', 'topic:update:all')).toBe(false);
  });

  it('grants nothing to an unknown or missing role', () => {
    expect(workspaceRoleHasPermission(undefined, 'agent:read')).toBe(false);
    expect(workspaceRoleHasPermission('super_admin', 'agent:read')).toBe(false);
  });
});

describe('hasMinWorkspaceRole', () => {
  it('follows the viewer < member < admin < owner order', () => {
    expect(hasMinWorkspaceRole('viewer', 'member')).toBe(false);
    expect(hasMinWorkspaceRole('member', 'admin')).toBe(false);
    expect(hasMinWorkspaceRole('admin', 'admin')).toBe(true);
    expect(hasMinWorkspaceRole('owner', 'owner')).toBe(true);
  });
});

describe('tRPC permission middleware', () => {
  it('passes personal requests through untouched (I4)', async () => {
    const personal = caller({});

    await expect(personal.manage()).resolves.toBe('ok');
    await expect(personal.scope()).resolves.toBe('ok');
    await expect(personal.all()).resolves.toBe('ok');
    await expect(personal.any()).resolves.toBe('ok');
  });

  it('blocks a member from a manage_settings gate and allows an admin', async () => {
    await expect(workspaceCaller('member').manage()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(workspaceCaller('viewer').manage()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(workspaceCaller('admin').manage()).resolves.toBe('ok');
    await expect(workspaceCaller('owner').manage()).resolves.toBe('ok');
  });

  it('lets a member through the scoped agent:update gate but not a viewer', async () => {
    await expect(workspaceCaller('viewer').scope()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(workspaceCaller('member').scope()).resolves.toBe('ok');
    await expect(workspaceCaller('admin').scope()).resolves.toBe('ok');
  });

  it('honours any/all code combinations', async () => {
    await expect(workspaceCaller('member').any()).resolves.toBe('ok');
    await expect(workspaceCaller('viewer').any()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(workspaceCaller('member').all()).resolves.toBe('ok');
    await expect(workspaceCaller('viewer').all()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
