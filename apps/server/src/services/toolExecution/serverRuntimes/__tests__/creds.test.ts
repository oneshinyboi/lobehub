import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketService } from '@/server/services/market';
import { createSandboxService, getSandboxProviderKind } from '@/server/services/sandbox';

import { type ToolExecutionContext } from '../../types';
import { credsRuntime, ServerCredsService } from '../creds';

const { getMember, resolveSandboxSessionConfig } = vi.hoisted(() => ({
  getMember: vi.fn(),
  resolveSandboxSessionConfig: vi.fn(),
}));

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: vi.fn(),
  getSandboxProviderKind: vi.fn(() => 'market'),
  MarketSandboxProvider: vi.fn(function (this: any) {
    this.callTool = vi.fn(async () => ({ result: {}, success: true }));
  }),
  resolveSandboxSessionConfig,
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn().mockImplementation(function () {
    return { getMember };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(),
}));

describe('credsRuntime', () => {
  const serverDB = {} as NonNullable<ToolExecutionContext['serverDB']>;

  beforeEach(() => {
    vi.clearAllMocks();
    getMember.mockResolvedValue({ role: 'member' });
    resolveSandboxSessionConfig.mockResolvedValue({
      claim: null,
      drive: 'personal',
      mode: 'ephemeral',
    });
  });

  it('signs verified workspace context into the Market trusted-client identity', async () => {
    await credsRuntime.factory({
      serverDB,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(getMember).toHaveBeenCalledWith('workspace-1', 'user-1');
    expect(MarketService).toHaveBeenCalledWith({
      userInfo: expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' }),
    });
  });

  it('rejects workspace context without an active membership', async () => {
    getMember.mockResolvedValue(undefined);

    await expect(
      credsRuntime.factory({
        serverDB,
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('Workspace membership is required for workspace Creds execution');
    expect(MarketService).not.toHaveBeenCalled();
  });

  it('fails closed when workspace membership cannot be queried', async () => {
    await expect(
      credsRuntime.factory({
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('serverDB is required for workspace Creds execution');
    expect(getMember).not.toHaveBeenCalled();
    expect(MarketService).not.toHaveBeenCalled();
  });

  it('keeps personal runtime identity outside a workspace', async () => {
    await credsRuntime.factory({
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(getMember).not.toHaveBeenCalled();
    expect(MarketService).toHaveBeenCalledWith({
      userInfo: expect.objectContaining({ userId: 'user-1', workspaceId: undefined }),
    });
  });

  it('rejects runtime creation without a user identity', async () => {
    await expect(credsRuntime.factory({ toolManifestMap: {} })).rejects.toThrow(
      'userId is required for Creds execution',
    );
  });

  // `lobe-creds` is already absent from `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`,
  // so this runtime should never even be constructed for a share visitor —
  // this is the belt-and-braces backstop in case that allowlist gate is ever
  // bypassed: the sandbox write path must refuse on its own too, since
  // `~/.creds/env` must never receive the creator's decrypted credentials
  // inside a sandbox a visitor's model can run arbitrary shell commands in.
  it('refuses to write credentials into the sandbox for a share-visitor run', async () => {
    vi.mocked(MarketService).mockImplementation(function () {
      return {
        market: {
          creds: {
            inject: vi.fn().mockResolvedValue({
              credentials: { env: { FOO: 'bar' } },
            }),
          },
        },
      } as any;
    });

    const runtime = await credsRuntime.factory({
      agentShareVisitor: { agentId: 'agent-1' } as any,
      serverDB,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await (runtime as any).injectCredsToSandbox({ keys: ['FOO'] });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('unavailable in shared conversations');
  });

  describe('injectCredsToSandbox', () => {
    const mockInject = () => {
      const inject = vi.fn().mockResolvedValue({ credentials: { env: {} }, success: true });
      vi.mocked(MarketService).mockImplementation(function () {
        return { market: { creds: { inject } } } as any;
      });
      return inject;
    };

    // Regression: inject only sent keys/sandbox/topicId/userId, so a topic on a
    // persistent environment or a drive had its credentials written into a
    // throwaway sandbox, which the next persistent tool call then replaced.
    it.each([
      ['persistent', 'inst-1'],
      ['drive', undefined],
    ] as const)('routes injection to the topic %s sandbox', async (mode, environment) => {
      resolveSandboxSessionConfig.mockResolvedValue({
        claim: { key: 'u-user-1' },
        drive: 'personal',
        environment,
        mode,
      });
      const inject = mockInject();

      const runtime = await credsRuntime.factory({
        serverDB,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });
      const result = await (runtime as any).injectCredsToSandbox({ keys: ['FOO'] });

      expect(result.success).toBe(true);
      expect(inject).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: ['FOO'],
          sandboxInstanceId: environment,
          sandboxMode: mode,
          topicId: 'topic-1',
        }),
      );
    });

    // A device-routed run executes commands on the device, so an injection
    // would report success while no command could ever read the values.
    it('refuses when the run is routed to a device', async () => {
      const inject = mockInject();

      const runtime = await credsRuntime.factory({
        activeDeviceId: 'device-1',
        executionPlan: { deviceId: 'device-1', kind: 'device', target: 'device' },
        serverDB,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });
      const result = await (runtime as any).injectCredsToSandbox({ keys: ['FOO'] });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('SandboxUnreachable');
      expect(inject).not.toHaveBeenCalled();
    });

    // In auto mode the Cloud Sandbox tool still reaches the sandbox even with a
    // device routed, so refusing on "target is not sandbox" would block it.
    it('allows injection in auto mode with a device routed', async () => {
      const inject = mockInject();

      const runtime = await credsRuntime.factory({
        activeDeviceId: 'device-1',
        executionPlan: { deviceId: 'device-1', kind: 'device', target: 'auto' },
        serverDB,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });
      const result = await (runtime as any).injectCredsToSandbox({ keys: ['FOO'] });

      expect(result.success).toBe(true);
      expect(inject).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ServerCredsService.injectCreds', () => {
  const buildMarketService = (inject = vi.fn()) =>
    ({ market: { creds: { inject } } }) as unknown as MarketService;

  // Regression test: an earlier version of this method took the
  // `credentials.env` map back from market's `/inject-creds` response and
  // wrote it into the sandbox a second time. But that response is already
  // masked for safe display (market itself writes the *real* values into
  // ~/.creds/env server-side when `sandbox` is true) — so the second write
  // appended a masked `export` line after market's real one, and since
  // re-sourcing the file applies `export`s in file order, the masked line
  // silently shadowed the real credential for every later command. The fix
  // is to only forward market's response, never re-write it — this test
  // locks that in by asserting `market.creds.inject` is the only call made
  // and its result is returned untouched.
  it("forwards market.creds.inject's result without writing it into the sandbox again", async () => {
    const injectResult = {
      credentials: { env: { DC_CLI_TOKEN: '8f******vZ' } },
      notFound: [],
      success: true,
    };
    const inject = vi.fn().mockResolvedValue(injectResult);
    const service = new ServerCredsService(buildMarketService(inject), {
      workspaceId: 'workspace-1',
    });

    const result = await service.injectCreds({
      keys: ['dc-cli-token'],
      sandbox: true,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(inject).toHaveBeenCalledTimes(1);
    expect(inject).toHaveBeenCalledWith({
      keys: ['dc-cli-token'],
      sandbox: true,
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(result).toEqual({
      ...injectResult,
      envVarsByKey: { 'dc-cli-token': ['DC_CLI_TOKEN'] },
    });
  });

  it('maps each key to its own variables and merges ~/.creds/env after injecting', async () => {
    const inject = vi.fn().mockImplementation(async ({ keys }: { keys: string[] }) => {
      const byKey: Record<string, Record<string, string>> = {
        'deepseek': { DEEPSEEK_API_KEY: 'sk******ab' },
        'lobehub-database': {
          CLOUD_DATABASE_URL: 'po******db',
          LOBEHUB_DATABASE_URL: 'po******db',
          MARKET_DATABASE_URL: 'po******db',
        },
      };
      return {
        credentials: { env: Object.assign({}, ...keys.map((key) => byKey[key])) },
        notFound: [],
        success: true,
      };
    });
    const callTool = vi.fn().mockResolvedValue({ result: {}, success: true });
    const service = new ServerCredsService(buildMarketService(inject), {
      sandboxProvider: { callTool },
    });

    const result = await service.injectCreds({
      keys: ['lobehub-database', 'deepseek'],
      sandbox: true,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(result.envVarsByKey).toEqual({
      'deepseek': ['DEEPSEEK_API_KEY'],
      'lobehub-database': ['CLOUD_DATABASE_URL', 'LOBEHUB_DATABASE_URL', 'MARKET_DATABASE_URL'],
    });
    // Only the first call writes into the sandbox; the per-key lookups don't.
    expect(inject.mock.calls.map(([req]) => [req.keys, req.sandbox])).toEqual([
      [['lobehub-database', 'deepseek'], true],
      [['lobehub-database'], false],
      [['deepseek'], false],
    ]);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('runCommand', {
      command: expect.stringContaining('~/.creds/.env.ledger'),
    });
    for (const value of ['sk******ab', 'po******db']) {
      expect(JSON.stringify(callTool.mock.calls)).not.toContain(value);
    }
  });

  it('still returns the injection when merging ~/.creds/env fails', async () => {
    const inject = vi.fn().mockResolvedValue({
      credentials: { env: { DEEPSEEK_API_KEY: 'sk******ab' } },
      notFound: [],
      success: true,
    });
    const callTool = vi.fn().mockRejectedValue(new Error('sandbox down'));
    const service = new ServerCredsService(buildMarketService(inject), {
      sandboxProvider: { callTool },
    });

    const result = await service.injectCreds({
      keys: ['deepseek'],
      sandbox: true,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(result.envVarsByKey).toEqual({ deepseek: ['DEEPSEEK_API_KEY'] });
  });
});

describe('ServerCredsService.injectCreds (onlyboxes)', () => {
  const buildMarketService = (creds: Record<string, unknown>) =>
    ({ market: { creds } }) as unknown as MarketService;

  const buildWriter = () => ({ writeCredentials: vi.fn(async () => {}) });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSandboxProviderKind).mockReturnValue('onlyboxes');
  });

  // Market's `inject` only ever returns MASKED values (it writes the real ones
  // into its own sandbox). The only decrypting read is `creds.get(decrypt:true)`,
  // so the Onlyboxes path must resolve plaintext itself and hand it to the
  // sandbox writer — never trust `inject`'s masked preview.
  it('decrypts KV creds, writes the real values into the sandbox, and returns a masked env', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [{ id: 14346, key: 'Openrouter', type: 'kv-env' }],
    });
    const get = vi.fn().mockResolvedValue({
      plaintext: { OPENROUTER_API_KEY: 'sk-or-real-key', OPENROUTER_MANAGEMENT_KEY: 'sk-or-mgmt' },
    });
    const writer = buildWriter();
    const service = new ServerCredsService(buildMarketService({ get, list }), {
      sandboxService: writer as never,
    });

    const result = await service.injectCreds({
      keys: ['Openrouter'],
      sandbox: true,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(get).toHaveBeenCalledWith(14346, { decrypt: true });
    expect(writer.writeCredentials).toHaveBeenCalledWith({
      env: { OPENROUTER_API_KEY: 'sk-or-real-key', OPENROUTER_MANAGEMENT_KEY: 'sk-or-mgmt' },
      files: [],
    });
    // The model never sees the real values.
    expect(result.credentials?.env).toEqual({
      OPENROUTER_API_KEY: 'sk******ey',
      OPENROUTER_MANAGEMENT_KEY: 'sk******mt',
    });
    expect(result.success).toBe(true);
  });

  it('reports keys missing from the credential store and skips the write', async () => {
    const list = vi.fn().mockResolvedValue({ data: [] });
    const get = vi.fn();
    const writer = buildWriter();
    const service = new ServerCredsService(buildMarketService({ get, list }), {
      sandboxService: writer as never,
    });

    const result = await service.injectCreds({
      keys: ['missing'],
      sandbox: true,
      topicId: 't',
      userId: 'u',
    });

    expect(result.notFound).toEqual(['missing']);
    expect(get).not.toHaveBeenCalled();
    expect(writer.writeCredentials).not.toHaveBeenCalled();
  });

  it('marks non-KV, non-file creds unsupported in the sandbox and never decrypts them', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        { id: 1, key: 'gh', type: 'oauth' },
        { id: 2, key: 'hdr', type: 'kv-header' },
      ],
    });
    const get = vi.fn();
    const writer = buildWriter();
    const service = new ServerCredsService(buildMarketService({ get, list }), {
      sandboxService: writer as never,
    });

    const result = await service.injectCreds({
      keys: ['gh', 'hdr'],
      sandbox: true,
      topicId: 't',
      userId: 'u',
    });

    expect(get).not.toHaveBeenCalled();
    expect(writer.writeCredentials).not.toHaveBeenCalled();
    expect(result.unsupportedInSandbox).toEqual(['gh', 'hdr']);
  });

  it('refuses a share-visitor run before touching market or the sandbox', async () => {
    const list = vi.fn();
    const writer = buildWriter();
    const service = new ServerCredsService(buildMarketService({ list }), {
      isShareVisitor: true,
      sandboxService: writer as never,
    });

    await expect(
      service.injectCreds({ keys: ['x'], sandbox: true, topicId: 't', userId: 'u' }),
    ).rejects.toThrow('unavailable in shared conversations');
    expect(list).not.toHaveBeenCalled();
    expect(writer.writeCredentials).not.toHaveBeenCalled();
  });

  it('throws when no sandbox writer is wired for the onlyboxes provider', async () => {
    vi.mocked(getSandboxProviderKind).mockReturnValue('onlyboxes');
    const list = vi.fn();
    const service = new ServerCredsService(buildMarketService({ list }));

    await expect(
      service.injectCreds({ keys: ['a'], sandbox: true, topicId: 't', userId: 'u' }),
    ).rejects.toThrow('Sandbox credential writer is not configured');
  });
});

describe('credsRuntime.factory (onlyboxes)', () => {
  const serverDB = {} as NonNullable<ToolExecutionContext['serverDB']>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSandboxProviderKind).mockReturnValue('onlyboxes');
  });

  it('wires a sandbox service into the creds service and writes decrypted creds', async () => {
    const writeCredentials = vi.fn(async () => {});
    vi.mocked(createSandboxService).mockReturnValue({ writeCredentials } as never);

    const list = vi.fn().mockResolvedValue({
      data: [{ id: 1, key: 'Openrouter', type: 'kv-env' }],
    });
    const get = vi.fn().mockResolvedValue({ plaintext: { OPENROUTER_API_KEY: 'sk-or-real-key' } });
    vi.mocked(MarketService).mockImplementation(function () {
      return { market: { creds: { get, list } } } as never;
    });

    const runtime = await credsRuntime.factory({
      serverDB,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await (runtime as any).injectCredsToSandbox({ keys: ['Openrouter'] });

    expect(createSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'topic-1', userId: 'user-1' }),
    );
    expect(writeCredentials).toHaveBeenCalledWith({
      env: { OPENROUTER_API_KEY: 'sk-or-real-key' },
      files: [],
    });
    // v2.3.4 redacts every env value to `******` in the tool state — Market's
    // partial mask keeps the first/last two characters, which upstream no
    // longer exposes. The real value still lands in the sandbox (asserted
    // above via `writeCredentials`).
    expect(result.state.credentials.env).toEqual({ OPENROUTER_API_KEY: '******' });
  });
});
