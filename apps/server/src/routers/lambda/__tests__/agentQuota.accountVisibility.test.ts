// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

// Every quota procedure is composed on `wsCompatProcedure`, so a
// workspace-scoped caller resolves a membership before the route body runs.
// Stub that lookup: this file asserts account visibility, not the gate.
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return { findById: vi.fn(async (id: string) => ({ id, slug: 'ws-1' })) };
  }),
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(function () {
    return { getMember: vi.fn(async () => ({ role: 'owner' })) };
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: {} }));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(function () {
    return {
      findByDeviceId: vi.fn(async (id: string) => (id === 'gateway-a' ? { id: 'row-a' } : null)),
      findWorkspaceDeviceById: vi.fn(),
    };
  }),
}));

/** The caller sees `acc-visible`; `acc-hidden` is another member's private account. */
const findById = vi.fn(async (id: string) => (id === 'acc-visible' ? { id } : null));
const upsertBinding = vi.fn();
const pinBinding = vi.fn();
const listByAccount = vi.fn(async () => []);
vi.mock('@/database/models/agentQuota', () => ({
  AgentAccountBindingModel: vi.fn(function () {
    return { pin: pinBinding, upsert: upsertBinding };
  }),
  AgentProviderAccountModel: vi.fn(function () {
    return { findById };
  }),
  AgentQuotaWindowModel: vi.fn(function () {
    return { listByAccount };
  }),
}));

const service = {
  listActiveRuns: vi.fn(async () => []),
  listLatestReadings: vi.fn(async () => []),
  listSnapshotSeries: vi.fn(async () => []),
  listUsageTurns: vi.fn(async () => []),
  setDeviceAccount: vi.fn(),
};
vi.mock('@/server/services/agentQuota', () => ({
  AccountNotSignedInOnDeviceError: class extends Error {},
  AgentQuotaService: vi.fn(function () {
    return service;
  }),
}));

const { agentQuotaRouter } = await import('../agentQuota');

const caller = () =>
  agentQuotaRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' } as any);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agentQuota account visibility on id-addressed procedures', () => {
  const calls = (accountId: string) => ({
    bindAccount: () => caller().bindAccount({ accountId, agentId: 'agt-1' }),
    getLatestReadings: () => caller().getLatestReadings({ accountId }),
    getWindows: () => caller().getWindows({ accountId }),
    listActiveRuns: () => caller().listActiveRuns({ accountId }),
    listSnapshots: () => caller().listSnapshots({ accountId }),
    listUsageTurns: () => caller().listUsageTurns({ accountId }),
    setDeviceAccount: () =>
      caller().setDeviceAccount({ accountId, agentId: 'agt-1', deviceId: 'gateway-a' }),
    switchAccount: () => caller().switchAccount({ accountId, agentId: 'agt-1' }),
  });

  it.each(Object.keys(calls('')))('%s refuses an account the caller cannot see', async (name) => {
    const call = calls('acc-hidden')[name as keyof ReturnType<typeof calls>];
    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(findById).toHaveBeenCalledWith('acc-hidden');
    for (const fn of [...Object.values(service), upsertBinding, pinBinding, listByAccount])
      expect(fn).not.toHaveBeenCalled();
  });

  it.each(Object.keys(calls('')))('%s serves an account the caller can see', async (name) => {
    const call = calls('acc-visible')[name as keyof ReturnType<typeof calls>];
    await call();
  });

  it('lets a device go back to Auto without naming an account', async () => {
    await caller().setDeviceAccount({ accountId: null, agentId: 'agt-1', deviceId: 'gateway-a' });
    expect(findById).not.toHaveBeenCalled();
    expect(service.setDeviceAccount).toHaveBeenCalledWith('agt-1', 'row-a', null);
  });
});
