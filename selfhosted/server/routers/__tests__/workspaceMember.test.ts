// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceMemberRouter } from '@/business/server/lambda-routers/workspaceMember';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

// The router resolves its database through `getServerDB`; point that at the
// real (PGlite) test database so the procedures run against the real model.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'wm-owner';
const adminId = 'wm-admin';
const memberId = 'wm-member';
const deletedId = 'wm-deleted';
const outsiderId = 'wm-outsider';

const workspaceId = 'wm-workspace';
const otherWorkspaceId = 'wm-other-workspace';

const caller = (userId: string, workspace: null | string = workspaceId) =>
  workspaceMemberRouter.createCaller({ userId, workspaceId: workspace } as never);

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([
    { id: ownerId, email: 'zoe@example.com', fullName: 'Zoe Owner', username: 'zoe' },
    {
      avatar: 'admin-avatar.png',
      id: adminId,
      email: 'admin@example.com',
      fullName: 'Admin Account',
      username: 'admin',
    },
    { id: memberId, email: 'mike@example.com', fullName: 'Mike Member', username: 'mike' },
    { id: deletedId, email: 'gone@example.com', fullName: 'Gone Member', username: 'gone' },
    { id: outsiderId, email: 'out@example.com', fullName: 'Out Sider', username: 'out' },
  ]);

  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Acme', primaryOwnerId: ownerId, slug: 'wm-acme' },
    { id: otherWorkspaceId, name: 'Other', primaryOwnerId: outsiderId, slug: 'wm-other' },
  ]);

  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { config: { nickname: 'Ace' }, role: 'admin', userId: adminId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
    {
      deletedAt: new Date(),
      role: 'member',
      userId: deletedId,
      workspaceId,
    },
    { role: 'owner', userId: outsiderId, workspaceId: otherWorkspaceId },
  ]);
});

afterEach(() => {
  vi.mocked(getServerDB).mockClear();
});

describe('workspaceMemberRouter.list', () => {
  it('returns active members with their public profile and nickname config', async () => {
    const members = await caller(memberId).list();

    expect(members.map((member) => member.userId)).toEqual([adminId, memberId, ownerId]);

    const admin = members.find((member) => member.userId === adminId);
    expect(admin).toMatchObject({
      config: { nickname: 'Ace' },
      role: 'admin',
      user: {
        avatar: 'admin-avatar.png',
        email: 'admin@example.com',
        fullName: 'Admin Account',
        username: 'admin',
      },
    });

    expect(members.find((member) => member.userId === ownerId)?.user).toMatchObject({
      email: 'zoe@example.com',
      fullName: 'Zoe Owner',
      username: 'zoe',
    });
  });

  it('excludes removed members unless the settings view asks for them', async () => {
    const active = await caller(ownerId).list();
    expect(active.some((member) => member.userId === deletedId)).toBe(false);

    const all = await caller(ownerId).list({ includeDeleted: true });
    expect(all.some((member) => member.userId === deletedId)).toBe(true);
  });

  it('never leaks another workspace roster', async () => {
    const members = await caller(ownerId).list();
    expect(members.some((member) => member.userId === outsiderId)).toBe(false);
  });

  it('answers empty in personal mode', async () => {
    await expect(caller(ownerId, null).list()).resolves.toEqual([]);
  });

  it('refuses a workspace header from a non-member', async () => {
    await expect(caller(outsiderId).list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this workspace',
    });
  });
});
