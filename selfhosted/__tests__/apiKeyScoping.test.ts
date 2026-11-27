// @vitest-environment node
import { API_KEY_PREFIX } from '@lobechat/utils/apiKey';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceRouter } from '@/business/server/lambda-routers/workspace';
import { workspaceUsageRouter } from '@/business/server/lambda-routers/workspaceUsage';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { createLambdaContext } from '@/libs/trpc/lambda/context';

/**
 * Check 5 of the WS-6 phase gate — API-key scoping.
 *
 * A workspace-scoped API key is bound to its own workspace. Replaying it with
 * another workspace's `X-Workspace-Id` must not authenticate the request at
 * all, so the workspace routers behind it cannot reach that other workspace.
 * A personal key must not reach workspace data either.
 */

const { mockFindByKey, mockGetSession } = vi.hoisted(() => ({
  mockFindByKey: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: { api: { getSession: mockGetSession } } }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

vi.mock('@/database/models/apiKey', () => {
  // `validateApiKey` constructs the model to stamp `lastUsedAt`; a plain
  // function keeps `new ApiKeyModel(...)` returning the stub object.
  const FakeApiKeyModel = function () {
    return { updateLastUsed: () => Promise.resolve() };
  };
  Object.assign(FakeApiKeyModel, { findByKey: mockFindByKey });
  return { ApiKeyModel: FakeApiKeyModel };
});

vi.mock('@/envs/auth', () => ({
  LOBE_CHAT_AUTH_HEADER: 'X-lobe-chat-auth',
  LOBE_CHAT_OIDC_AUTH_HEADER: 'Oidc-Auth',
  authEnv: { ENABLE_OIDC: false },
}));

vi.mock('@/libs/observability/traceparent', () => ({ extractTraceContext: vi.fn() }));

vi.mock('@/libs/oidc-provider/jwt', () => ({ validateOIDCJWT: vi.fn() }));

vi.mock('@/libs/oidc-provider/access-control', () => ({
  assertOIDCUserActive: vi.fn(),
  isOIDCUserInactiveError: vi.fn(),
}));

vi.mock('@/utils/apiKey', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, isApiKeyExpired: () => false };
});

const serverDB: LobeChatDatabase = await getTestDB();

const issuerId = 'apikey-issuer';
const ownerXId = 'apikey-owner-x';
const workspaceX = 'apikey-workspace-x';
const workspaceY = 'apikey-workspace-y';

const apiKey = `${API_KEY_PREFIX}${'a'.repeat(16)}`;

const keyRecord = (workspaceId: null | string) => ({
  enabled: true,
  expiresAt: null,
  id: 'apikey-record',
  key: 'encrypted',
  keyHash: 'hash',
  name: 'Isolation key',
  scopes: null,
  userId: issuerId,
  workspaceId,
});

const request = (headers: Record<string, string>) =>
  createLambdaContext(new NextRequest('https://chat.selfhosted.test/trpc/lambda', { headers }));

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: issuerId }, { id: ownerXId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceX, name: 'X', primaryOwnerId: ownerXId, slug: 'apikey-x' },
    { id: workspaceY, name: 'Y', primaryOwnerId: issuerId, slug: 'apikey-y' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerXId, workspaceId: workspaceX },
    { role: 'owner', userId: issuerId, workspaceId: workspaceY },
  ]);

  mockFindByKey.mockReset();
  mockGetSession.mockReset();
});

describe('check 5 — workspace-scoped API key', () => {
  it('rejects a key replayed against another workspace and leaves no way in', async () => {
    mockFindByKey.mockResolvedValue(keyRecord(workspaceY));

    const context = await request({
      'X-API-Key': apiKey,
      'X-Workspace-Id': workspaceX,
    });

    // The request is not authenticated as the issuer at all.
    expect(context.userId).toBeNull();
    expect(context.workspaceId).toBeUndefined();
    expect(mockGetSession).not.toHaveBeenCalled();

    // Nothing behind the context can read the other workspace.
    await expect(workspaceRouter.createCaller(context as never).getById()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(
      workspaceUsageRouter.createCaller(context as never).getCurrentUsage(),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('binds the key to its own workspace when the header matches', async () => {
    mockFindByKey.mockResolvedValue(keyRecord(workspaceY));

    const context = await request({
      'X-API-Key': apiKey,
      'X-Workspace-Id': workspaceY,
    });

    expect(context.userId).toBe(issuerId);
    expect(context.workspaceId).toBe(workspaceY);

    await expect(
      workspaceUsageRouter.createCaller(context as never).getCurrentUsage(),
    ).resolves.toMatchObject({ remainingBalance: 0 });
  });

  it('binds the key to its own workspace even without a header', async () => {
    mockFindByKey.mockResolvedValue(keyRecord(workspaceY));

    const context = await request({ 'X-API-Key': apiKey });

    expect(context.userId).toBe(issuerId);
    // It can never be aimed at X: the key's workspace wins.
    expect(context.workspaceId).toBe(workspaceY);
  });

  it('refuses a key whose issuer is no longer a member of its workspace', async () => {
    mockFindByKey.mockResolvedValue(keyRecord(workspaceY));

    await serverDB
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.userId, issuerId), eq(workspaceMembers.workspaceId, workspaceY)),
      );

    const context = await request({ 'X-API-Key': apiKey });

    expect(context.userId).toBeNull();
    expect(context.workspaceId).toBeUndefined();
  });
});

describe('check 5 — personal API key', () => {
  it('cannot request workspace data', async () => {
    mockFindByKey.mockResolvedValue(keyRecord(null));

    const context = await request({
      'X-API-Key': apiKey,
      'X-Workspace-Id': workspaceX,
    });

    expect(context.userId).toBeNull();
    expect(context.workspaceId).toBeUndefined();

    await expect(workspaceRouter.createCaller(context as never).getById()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('still works in personal mode', async () => {
    mockFindByKey.mockResolvedValue(keyRecord(null));

    const context = await request({ 'X-API-Key': apiKey });

    expect(context.userId).toBe(issuerId);
    expect(context.workspaceId).toBeUndefined();
  });
});
