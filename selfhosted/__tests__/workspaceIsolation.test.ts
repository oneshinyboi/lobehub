// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceRouter } from '@/business/server/lambda-routers/workspace';
import { workspaceAuditLogRouter } from '@/business/server/lambda-routers/workspaceAuditLog';
import { workspaceMemberRouter } from '@/business/server/lambda-routers/workspaceMember';
import { workspaceTeamRouter } from '@/business/server/lambda-routers/workspaceTeam';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { agents, users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { agentRouter } from '@/server/routers/lambda/agent';
import { documentCommentRouter } from '@/server/routers/lambda/documentComment';
import { documentLikeRouter } from '@/server/routers/lambda/documentLike';
import { topicCommentRouter } from '@/server/routers/lambda/topicComment';

/**
 * Checks 1, 3 and 4 of the WS-6 phase gate.
 *
 * - Check 1 (personal isolation): with no `X-Workspace-Id`, a caller reads only
 *   `workspace_id IS NULL` rows of their own.
 * - Check 3 (non-member denial): a valid workspace the caller is not in is
 *   refused with FORBIDDEN, not an empty result.
 * - Check 4 (member access): a member reads workspace rows, while a private row
 *   owned by another member stays invisible.
 *
 * The data goes through the real routers and the real PGlite database; the
 * scoping predicate is the production `buildWorkspaceWhere`.
 */

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerA = 'iso-owner-a';
const memberB = 'iso-member-b';
const memberC = 'iso-member-c';
const ownerD = 'iso-owner-d';
const outsiderE = 'iso-outsider-e';

const workspaceX = 'iso-workspace-x';
const workspaceY = 'iso-workspace-y';

const agentCaller = (userId: string, workspace?: string) =>
  agentRouter.createCaller({ userId, workspaceId: workspace } as never);

const visibleAgentIds = async (userId: string, workspace?: string) =>
  (await agentCaller(userId, workspace).queryAgents()).map((agent) => agent.id).sort();

const seedAgent = async (params: {
  id: string;
  userId: string;
  visibility?: 'private' | 'public';
  workspaceId?: string;
}) => {
  await serverDB.insert(agents).values({
    avatar: 'avatar',
    backgroundColor: '#000',
    description: params.id,
    id: params.id,
    title: params.id,
    userId: params.userId,
    virtual: false,
    visibility: params.visibility ?? 'public',
    workspaceId: params.workspaceId ?? null,
  });
};

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(agents);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([{ id: ownerA }, { id: memberB }, { id: memberC }, { id: ownerD }, { id: outsiderE }]);

  await serverDB.insert(workspaces).values([
    { id: workspaceX, name: 'X', primaryOwnerId: ownerA, slug: 'iso-x' },
    { id: workspaceY, name: 'Y', primaryOwnerId: ownerD, slug: 'iso-y' },
  ]);

  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerA, workspaceId: workspaceX },
    { role: 'member', userId: memberB, workspaceId: workspaceX },
    { role: 'member', userId: memberC, workspaceId: workspaceX },
    { role: 'owner', userId: ownerD, workspaceId: workspaceY },
  ]);

  await seedAgent({ id: 'personal-a', userId: ownerA });
  await seedAgent({ id: 'personal-b', userId: memberB });
  await seedAgent({ id: 'x-public-a', userId: ownerA, workspaceId: workspaceX });
  await seedAgent({ id: 'x-public-b', userId: memberB, workspaceId: workspaceX });
  await seedAgent({
    id: 'x-private-a',
    userId: ownerA,
    visibility: 'private',
    workspaceId: workspaceX,
  });
  await seedAgent({
    id: 'x-private-b',
    userId: memberB,
    visibility: 'private',
    workspaceId: workspaceX,
  });
  await seedAgent({ id: 'y-public-d', userId: ownerD, workspaceId: workspaceY });
});

describe('check 1 — personal isolation', () => {
  it('reads only the caller’s own workspace_id IS NULL rows', async () => {
    const ids = await visibleAgentIds(ownerA);

    expect(ids).toEqual(['personal-a']);
    // Neither another user's personal row nor any workspace row leaks in.
    expect(ids).not.toContain('personal-b');
    expect(ids).not.toContain('x-public-a');
    expect(ids).not.toContain('x-public-b');
    expect(ids).not.toContain('y-public-d');
  });

  it('keeps personal mode working without a workspace header (not an error)', async () => {
    await expect(agentCaller(ownerA).queryAgents()).resolves.toBeInstanceOf(Array);
    expect(await visibleAgentIds(memberB)).toEqual(['personal-b']);
  });

  it('switches to the workspace scope only when the header names a workspace', async () => {
    const personal = await visibleAgentIds(ownerA);
    const scoped = await visibleAgentIds(ownerA, workspaceX);

    expect(personal).not.toContain('x-public-a');
    expect(scoped).toContain('x-public-a');
    expect(scoped).not.toContain('personal-a');
  });
});

describe('check 4 — member access', () => {
  it('shows a member the workspace rows that are public', async () => {
    const ids = await visibleAgentIds(memberC, workspaceX);

    expect(ids).toContain('x-public-a');
    expect(ids).toContain('x-public-b');
  });

  it('keeps another member’s private row invisible', async () => {
    const ids = await visibleAgentIds(memberC, workspaceX);

    // `x-private-b` belongs to memberB and `x-private-a` to ownerA; memberC may
    // see neither, while each owner still sees their own private row.
    expect(ids).not.toContain('x-private-b');
    expect(ids).not.toContain('x-private-a');

    expect(await visibleAgentIds(memberB, workspaceX)).toContain('x-private-b');
    expect(await visibleAgentIds(ownerA, workspaceX)).toContain('x-private-a');
  });

  it('never shows workspace Y rows inside workspace X', async () => {
    expect(await visibleAgentIds(memberC, workspaceX)).not.toContain('y-public-d');
  });

  it('serves the workspace and its roster to a member', async () => {
    const memberCaller = workspaceMemberRouter.createCaller({
      userId: memberC,
      workspaceId: workspaceX,
    } as never);

    const members = await memberCaller.list();
    expect(members.map((member) => member.userId).sort()).toEqual(
      [memberB, memberC, ownerA].sort(),
    );

    await expect(
      workspaceRouter.createCaller({ userId: memberC, workspaceId: workspaceX } as never).getById(),
    ).resolves.toMatchObject({ id: workspaceX, slug: 'iso-x' });

    await expect(
      workspaceTeamRouter
        .createCaller({ userId: memberC, workspaceId: workspaceX } as never)
        .list(),
    ).resolves.toEqual([]);
  });
});

/**
 * The same call, aimed at a workspace the caller cannot address. Check 3 uses a
 * stranger (no membership anywhere) and check 2's sibling uses a member of a
 * *different* workspace; both must be FORBIDDEN rather than an empty result.
 */
const denialMatrix = [
  {
    call: (userId: string, workspace: string) =>
      workspaceRouter.createCaller({ userId, workspaceId: workspace } as never).getById(),
    name: 'workspace.getById',
  },
  {
    call: (userId: string, workspace: string) =>
      workspaceRouter.createCaller({ userId, workspaceId: workspace } as never).getSettings(),
    name: 'workspace.getSettings',
  },
  {
    call: (userId: string, workspace: string) =>
      workspaceRouter.createCaller({ userId, workspaceId: workspace } as never).getMyStatistics(),
    name: 'workspace.getMyStatistics',
  },
  {
    call: (userId: string, workspace: string) =>
      workspaceMemberRouter.createCaller({ userId, workspaceId: workspace } as never).list(),
    name: 'workspaceMember.list',
  },
  {
    call: (userId: string, workspace: string) =>
      workspaceTeamRouter.createCaller({ userId, workspaceId: workspace } as never).list(),
    name: 'workspaceTeam.list',
  },
  {
    call: (userId: string, workspace: string) =>
      workspaceAuditLogRouter.createCaller({ userId, workspaceId: workspace } as never).list(),
    name: 'workspaceAuditLog.list',
  },
  {
    call: (userId: string, workspace: string) =>
      documentCommentRouter
        .createCaller({ userId, workspaceId: workspace } as never)
        .listThreads({ documentId: 'doc-1' }),
    name: 'documentComment.listThreads',
  },
  {
    call: (userId: string, workspace: string) =>
      documentLikeRouter
        .createCaller({ userId, workspaceId: workspace } as never)
        .summary({ documentId: 'doc-1' }),
    name: 'documentLike.summary',
  },
  {
    call: (userId: string, workspace: string) =>
      topicCommentRouter
        .createCaller({ userId, workspaceId: workspace } as never)
        .listThreads({ topicId: 'topic-1' }),
    name: 'topicComment.listThreads',
  },
];

describe.each([
  { label: 'check 3 — non-member (stranger) denial', userId: outsiderE, workspace: workspaceX },
  { label: 'check 2 — cross-workspace denial', userId: ownerA, workspace: workspaceY },
])('$label', ({ userId, workspace }) => {
  it.each(denialMatrix)('$name refuses with FORBIDDEN, not an empty result', async ({ call }) => {
    await expect(call(userId, workspace)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this workspace',
    });
  });
});
