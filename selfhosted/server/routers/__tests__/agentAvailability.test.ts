// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { agents, users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { agentAvailabilityRouter } from '@/server/routers/lambda/agentAvailability';

// `cloudWorkspaceAuth` and `AgentAvailabilityService` both resolve their database
// through `getServerDB`; point that at the real (PGlite) test database so the
// membership check exercised here is the production one, not a stand-in.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const memberId = 'av-member';
const outsiderId = 'av-outsider';
const personalId = 'av-personal';

const workspaceId = 'av-workspace';
const foreignWorkspaceId = 'av-foreign-workspace';

const sharedAgentId = 'av-shared-agent';
const foreignAgentId = 'av-foreign-agent';
const personalAgentId = 'av-personal-agent';

/**
 * `workspaceId: undefined` is personal mode — that is exactly what the tRPC
 * context holds when no `X-Workspace-Id` header is sent (CONTEXT.md I4).
 */
const caller = (userId: string, workspace?: string) =>
  agentAvailabilityRouter.createCaller({ userId, workspaceId: workspace } as never);

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(agents);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: memberId }, { id: outsiderId }, { id: personalId }]);

  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Acme', primaryOwnerId: memberId, slug: 'av-acme' },
    {
      id: foreignWorkspaceId,
      name: 'Foreign',
      primaryOwnerId: outsiderId,
      slug: 'av-foreign',
    },
  ]);

  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: memberId, workspaceId },
    { role: 'owner', userId: outsiderId, workspaceId: foreignWorkspaceId },
  ]);

  await serverDB.insert(agents).values([
    // Shared (public) agent in the caller's workspace — any member may read its routing.
    {
      id: sharedAgentId,
      title: 'Shared Agent',
      userId: memberId,
      visibility: 'public',
      workspaceId,
    },
    // The other workspace's agent: the row the leak used to expose.
    {
      id: foreignAgentId,
      title: 'Foreign Agent',
      userId: outsiderId,
      visibility: 'public',
      workspaceId: foreignWorkspaceId,
    },
    // A plain personal agent, for the personal-mode regression check.
    { id: personalAgentId, title: 'Personal Agent', userId: personalId },
  ]);
});

describe('agentAvailabilityRouter.getAvailability — workspace scope', () => {
  it('refuses a foreign workspace id with FORBIDDEN', async () => {
    // The caller belongs to `workspaceId` only, and supplies `foreignWorkspaceId`.
    // Before `cloudWorkspaceAuth` backed this procedure the header alone was
    // trusted, so this read returned the other workspace's routing state.
    await expect(
      caller(memberId, foreignWorkspaceId).getAvailability({ agentIds: [foreignAgentId] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses the foreign scope before the service runs, not after it finds nothing', async () => {
    // An empty id list makes the service return `{}` without touching the
    // database, so a passing "not found" would hide a missing gate. The refusal
    // here can only come from the membership check that precedes the service.
    await expect(
      caller(memberId, foreignWorkspaceId).getAvailability({ agentIds: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an unknown workspace id with NOT_FOUND rather than leaking routing state', async () => {
    await expect(
      caller(memberId, 'av-no-such-workspace').getAvailability({ agentIds: [sharedAgentId] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('still answers a member of the workspace with real availability data', async () => {
    const result = await caller(memberId, workspaceId).getAvailability({
      agentIds: [sharedAgentId],
    });

    expect(result).toHaveProperty(sharedAgentId);
    expect(result[sharedAgentId]).toMatchObject({ activeJobs: 0, status: 'online' });
  });

  it('keeps the other workspace agents absent from a member answer', async () => {
    const result = await caller(memberId, workspaceId).getAvailability({
      agentIds: [sharedAgentId, foreignAgentId],
    });

    expect(Object.keys(result)).toEqual([sharedAgentId]);
  });
});

describe('agentAvailabilityRouter.getAvailability — personal mode', () => {
  it('answers without a workspace header exactly as before', async () => {
    // No `X-Workspace-Id`: the middleware passes through unchanged and the
    // service reads the caller's personal pool (CONTEXT.md I4).
    const result = await caller(personalId).getAvailability({
      agentIds: [personalAgentId],
    });

    expect(result).toHaveProperty(personalAgentId);
    expect(result[personalAgentId]).toMatchObject({ activeJobs: 0, status: 'online' });
  });

  it('does not pick up workspace agents in personal mode', async () => {
    const result = await caller(personalId).getAvailability({
      agentIds: [personalAgentId, sharedAgentId],
    });

    expect(Object.keys(result)).toEqual([personalAgentId]);
  });
});
