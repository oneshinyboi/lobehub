// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WORKSPACE_TEAM_DUPLICATE_IDENTIFIER,
  WORKSPACE_TEAM_MEMBER_NOT_IN_WORKSPACE,
  workspaceTeamRouter,
} from '@/business/server/lambda-routers/workspaceTeam';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import {
  users,
  workspaceMembers,
  workspaces,
  workspaceTeamMembers,
  workspaceTeams,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

// The router resolves its database through `getServerDB`; point that at the
// real (PGlite) test database so the procedures run against the real model.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'wt-router-owner';
const adminId = 'wt-router-admin';
const memberId = 'wt-router-member';
const outsiderId = 'wt-router-outsider';

const workspaceId = 'wt-router-workspace';
const otherWorkspaceId = 'wt-router-other-workspace';

const caller = (userId: string, workspace = workspaceId) =>
  workspaceTeamRouter.createCaller({ userId, workspaceId: workspace } as never);

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([{ id: ownerId }, { id: adminId }, { id: memberId }, { id: outsiderId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Acme', primaryOwnerId: ownerId, slug: 'wt-router-acme' },
    {
      id: otherWorkspaceId,
      name: 'Other',
      primaryOwnerId: outsiderId,
      slug: 'wt-router-other',
    },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'admin', userId: adminId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
    { role: 'owner', userId: outsiderId, workspaceId: otherWorkspaceId },
  ]);
});

afterEach(() => {
  vi.mocked(getServerDB).mockClear();
});

describe('workspaceTeamRouter — reads', () => {
  it('lets a plain member list and open a team', async () => {
    const created = await caller(ownerId).create({ identifier: 'ENG', name: 'Engineering' });

    const list = await caller(memberId).list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, memberCount: 0, name: 'Engineering' });

    const detail = await caller(memberId).getById({ id: created.id });
    expect(detail).toMatchObject({ id: created.id, identifier: 'ENG', members: [] });
  });

  it('does not resolve a team through another workspace', async () => {
    const created = await caller(ownerId).create({ identifier: 'ENG', name: 'Engineering' });

    await expect(
      caller(outsiderId, otherWorkspaceId).getById({ id: created.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Team not found' });
  });

  it('answers NOT_FOUND for an unknown team id', async () => {
    await expect(caller(memberId).getById({ id: 'does-not-exist' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('workspaceTeamRouter — create / update / delete', () => {
  it('creates a team with an identifier derived from its name', async () => {
    const team = await caller(ownerId).create({ name: 'Customer Support' });

    expect(team).toMatchObject({ identifier: 'CS', name: 'Customer Support', workspaceId });
  });

  it('creates a team with two members and counts them', async () => {
    const team = await caller(ownerId).create({
      identifier: 'ENG',
      memberUserIds: [ownerId, memberId],
      name: 'Engineering',
    });

    const detail = await caller(ownerId).getById({ id: team.id });
    expect(detail.memberCount).toBe(2);
    expect(detail.members.map((member) => member.userId).sort()).toEqual(
      [memberId, ownerId].sort(),
    );
  });

  it('rejects an initial member who is not in the workspace, creating nothing', async () => {
    await expect(
      caller(ownerId).create({
        identifier: 'ENG',
        memberUserIds: [memberId, outsiderId],
        name: 'Engineering',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: WORKSPACE_TEAM_MEMBER_NOT_IN_WORKSPACE,
    });

    await expect(caller(ownerId).list()).resolves.toEqual([]);
  });

  it('lets an admin run the full create / update / delete flow', async () => {
    const team = await caller(adminId).create({ identifier: 'OPS', name: 'Operations' });
    expect(team).toMatchObject({ identifier: 'OPS', name: 'Operations' });

    const updated = await caller(adminId).update({
      description: 'Builds the product',
      id: team.id,
      name: 'Product Engineering',
    });
    expect(updated).toMatchObject({
      description: 'Builds the product',
      name: 'Product Engineering',
    });

    await caller(adminId).delete({ id: team.id });
    await expect(caller(adminId).list()).resolves.toEqual([]);
  });

  it('deletes the team and its team memberships but keeps the workspace members', async () => {
    const team = await caller(ownerId).create({
      identifier: 'ENG',
      memberUserIds: [ownerId, memberId],
      name: 'Engineering',
    });

    await caller(ownerId).delete({ id: team.id });

    expect(await serverDB.select().from(workspaceTeams)).toEqual([]);
    expect(await serverDB.select().from(workspaceTeamMembers)).toEqual([]);

    // Team membership is not workspace membership: both people are still here.
    const members = await serverDB
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    expect(members.map((row) => row.userId).sort()).toEqual([adminId, memberId, ownerId].sort());
  });
});

describe('workspaceTeamRouter — identifier uniqueness', () => {
  it('answers a duplicate identifier with a field code, not a server error', async () => {
    await caller(ownerId).create({ identifier: 'ENG', name: 'Engineering' });

    await expect(
      caller(ownerId).create({ identifier: 'eng', name: 'Also engineering' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: WORKSPACE_TEAM_DUPLICATE_IDENTIFIER,
    });

    await expect(caller(ownerId).list()).resolves.toHaveLength(1);
  });

  it('rejects an update that collides with another team', async () => {
    await caller(ownerId).create({ identifier: 'ENG', name: 'Engineering' });
    const ops = await caller(ownerId).create({ identifier: 'OPS', name: 'Operations' });

    await expect(caller(ownerId).update({ id: ops.id, identifier: 'ENG' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: WORKSPACE_TEAM_DUPLICATE_IDENTIFIER,
    });

    // Re-submitting a team's own identifier is not a collision.
    await expect(caller(ownerId).update({ id: ops.id, identifier: 'OPS' })).resolves.toMatchObject({
      identifier: 'OPS',
    });
  });
});

describe('workspaceTeamRouter — addMembers / removeMember', () => {
  it('is idempotent and returns only the newly added ids', async () => {
    const team = await caller(ownerId).create({ identifier: 'ENG', name: 'Engineering' });

    const added = await caller(ownerId).addMembers({
      id: team.id,
      userIds: [adminId, memberId, adminId],
    });
    expect([...added].sort()).toEqual([adminId, memberId].sort());

    await expect(caller(ownerId).addMembers({ id: team.id, userIds: [adminId] })).resolves.toEqual(
      [],
    );

    expect((await caller(ownerId).getById({ id: team.id })).memberCount).toBe(2);
  });

  it('rejects a batch naming a non-member and adds nobody', async () => {
    const team = await caller(ownerId).create({ identifier: 'ENG', name: 'Engineering' });

    await expect(
      caller(ownerId).addMembers({ id: team.id, userIds: [memberId, outsiderId] }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: WORKSPACE_TEAM_MEMBER_NOT_IN_WORKSPACE,
    });

    expect((await caller(ownerId).getById({ id: team.id })).members).toEqual([]);
  });

  it('removes a team member without touching workspace membership', async () => {
    const team = await caller(ownerId).create({
      identifier: 'ENG',
      memberUserIds: [memberId],
      name: 'Engineering',
    });

    await expect(caller(ownerId).removeMember({ id: team.id, userId: memberId })).resolves.toBe(
      true,
    );
    expect((await caller(ownerId).getById({ id: team.id })).members).toEqual([]);

    const stillMember = await serverDB
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    expect(stillMember.map((row) => row.userId)).toContain(memberId);
  });
});

describe('workspaceTeamRouter — role gates', () => {
  it('refuses a plain member creating a team', async () => {
    await expect(
      caller(memberId).create({ identifier: 'ENG', name: 'Engineering' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(caller(ownerId).list()).resolves.toEqual([]);
  });

  it('refuses a plain member deleting a team', async () => {
    const team = await caller(ownerId).create({ identifier: 'ENG', name: 'Engineering' });

    await expect(caller(memberId).delete({ id: team.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(caller(ownerId).getById({ id: team.id })).resolves.toMatchObject({
      id: team.id,
    });
  });

  it('refuses a plain member adding or removing members', async () => {
    const team = await caller(ownerId).create({
      identifier: 'ENG',
      memberUserIds: [adminId],
      name: 'Engineering',
    });

    await expect(
      caller(memberId).addMembers({ id: team.id, userIds: [memberId] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller(memberId).removeMember({ id: team.id, userId: adminId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
