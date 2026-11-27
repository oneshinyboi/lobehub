// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { agentProviderAccounts, users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { agentQuotaRouter } from '@/server/routers/lambda/agentQuota';

// `cloudWorkspaceAuth` resolves its database through `getServerDB`; point that at
// the real (PGlite) test database so the membership check exercised here is the
// production one, not a stand-in.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

// The router imports the gateway singleton; nothing in this file calls it.
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: {} }));

const serverDB: LobeChatDatabase = await getTestDB();

const memberId = 'quota-member';
const outsiderId = 'quota-outsider';
const personalId = 'quota-personal';

const workspaceId = 'quota-workspace';
const foreignWorkspaceId = 'quota-foreign-workspace';
const unknownWorkspaceId = 'quota-no-such-workspace';

const sharedAccountId = '11111111-1111-4111-8111-111111111111';
const foreignAccountId = '22222222-2222-4222-8222-222222222222';
const personalAccountId = '33333333-3333-4333-8333-333333333333';

/**
 * `workspaceId: undefined` is personal mode — exactly what the tRPC context
 * holds when no `X-Workspace-Id` header is sent (CONTEXT.md I4).
 */
const caller = (userId: string, workspace?: string) =>
  agentQuotaRouter.createCaller({ userId, workspaceId: workspace } as never);

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(agentProviderAccounts);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: memberId }, { id: outsiderId }, { id: personalId }]);

  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Acme', primaryOwnerId: memberId, slug: 'quota-acme' },
    {
      id: foreignWorkspaceId,
      name: 'Foreign',
      primaryOwnerId: outsiderId,
      slug: 'quota-foreign',
    },
  ]);

  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: memberId, workspaceId },
    { role: 'owner', userId: outsiderId, workspaceId: foreignWorkspaceId },
  ]);

  await serverDB.insert(agentProviderAccounts).values([
    // Public account in the caller's workspace — every member may see and draw on it.
    {
      id: sharedAccountId,
      label: 'Team Claude',
      provider: 'claude-code',
      userId: memberId,
      visibility: 'public',
      workspaceId,
    },
    // The other workspace's account: the row an unvalidated `X-Workspace-Id`
    // used to expose through `buildWorkspaceWhere`'s plain `workspace_id = $1`.
    {
      id: foreignAccountId,
      label: 'Foreign Claude',
      provider: 'claude-code',
      userId: outsiderId,
      visibility: 'public',
      workspaceId: foreignWorkspaceId,
    },
    // A plain personal account, for the personal-mode regression check.
    {
      id: personalAccountId,
      label: 'My Claude',
      provider: 'claude-code',
      userId: personalId,
    },
  ]);
});

describe('agentQuotaRouter — a foreign workspace id is refused', () => {
  it('refuses listAccounts instead of returning the other workspace accounts', async () => {
    // The caller belongs to `workspaceId` only and supplies `foreignWorkspaceId`.
    // Before the procedure was built on `wsCompatProcedure` the header alone was
    // trusted and this read returned the foreign workspace's accounts.
    await expect(caller(memberId, foreignWorkspaceId).listAccounts()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses an id-addressed account read inside a foreign workspace', async () => {
    await expect(
      caller(memberId, foreignWorkspaceId).getLatestReadings({ accountId: foreignAccountId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a write into a foreign workspace', async () => {
    // The gate runs before any model is constructed, so writes cannot slip
    // through on a scope a read would have been refused on.
    await expect(
      caller(memberId, foreignWorkspaceId).createAccount({ provider: 'codex' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an unknown workspace id with NOT_FOUND rather than an empty answer', async () => {
    await expect(caller(memberId, unknownWorkspaceId).listAccounts()).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('agentQuotaRouter — a member still gets the quota payload', () => {
  it('answers listAccounts with the workspace rows, unchanged in shape', async () => {
    const accounts = await caller(memberId, workspaceId).listAccounts();

    expect(accounts.map(({ id }) => id)).toEqual([sharedAccountId]);
    expect(accounts[0]).toMatchObject({
      label: 'Team Claude',
      provider: 'claude-code',
      visibility: 'public',
      workspaceId,
    });
    // Credentials never leave the server, as before.
    expect(accounts[0]).not.toHaveProperty('credentials');
  });

  it('does not widen a member answer to the other workspace', async () => {
    const accounts = await caller(memberId, workspaceId).listAccounts();

    expect(accounts.map(({ id }) => id)).not.toContain(foreignAccountId);
  });
});

describe('agentQuotaRouter — personal mode is unchanged (I4)', () => {
  it('answers without a workspace header exactly as before', async () => {
    const accounts = await caller(personalId).listAccounts();

    expect(accounts.map(({ id }) => id)).toEqual([personalAccountId]);
    expect(accounts[0]).toMatchObject({ label: 'My Claude', provider: 'claude-code' });
  });

  it('does not pick up workspace accounts in personal mode', async () => {
    const accounts = await caller(personalId).listAccounts();

    expect(accounts.map(({ id }) => id)).not.toContain(sharedAccountId);
    expect(accounts.map(({ id }) => id)).not.toContain(foreignAccountId);
  });
});
