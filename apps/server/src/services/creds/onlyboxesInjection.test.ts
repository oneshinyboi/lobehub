import { describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';
import type { SandboxService } from '@/server/services/sandbox';

import { injectCredsIntoOnlyboxesSandbox } from './onlyboxesInjection';

const buildMarketService = (creds: Record<string, unknown>) =>
  ({ market: { creds } }) as unknown as MarketService;

const buildSandboxService = () =>
  ({ writeCredentials: vi.fn(async () => {}) }) as unknown as SandboxService & {
    writeCredentials: ReturnType<typeof vi.fn>;
  };

describe('injectCredsIntoOnlyboxesSandbox', () => {
  it('decrypts KV creds, writes the real values, and returns a masked env', async () => {
    const list = vi.fn(async () => ({ data: [{ id: 1, key: 'Openrouter', type: 'kv-env' }] }));
    const get = vi.fn(async () => ({ plaintext: { OPENROUTER_API_KEY: 'sk-or-real-key' } }));
    const sandboxService = buildSandboxService();

    const result = await injectCredsIntoOnlyboxesSandbox({
      keys: ['Openrouter'],
      marketService: buildMarketService({ get, list }),
      sandboxService,
    });

    expect(get).toHaveBeenCalledWith(1, { decrypt: true });
    expect(sandboxService.writeCredentials).toHaveBeenCalledWith({
      env: { OPENROUTER_API_KEY: 'sk-or-real-key' },
    });
    expect(result.credentials.env).toEqual({ OPENROUTER_API_KEY: 'sk******ey' });
    expect(result.success).toBe(true);
  });

  it('reads the workspace organization creds when a workspaceId is given', async () => {
    const personalList = vi.fn();
    const orgList = vi.fn(async () => ({ data: [{ id: 9, key: 'ws', type: 'kv-env' }] }));
    const orgGet = vi.fn(async () => ({ plaintext: { WS: 'secret' } }));
    const marketService = {
      market: {
        creds: { get: vi.fn(), list: personalList },
        organizations: { creds: vi.fn(() => ({ get: orgGet, list: orgList })) },
      },
    } as unknown as MarketService;
    const sandboxService = buildSandboxService();

    await injectCredsIntoOnlyboxesSandbox({
      keys: ['ws'],
      marketService,
      sandboxService,
      workspaceId: 'workspace-1',
    });

    expect(orgList).toHaveBeenCalledTimes(1);
    expect(personalList).not.toHaveBeenCalled();
    expect(sandboxService.writeCredentials).toHaveBeenCalledWith({ env: { WS: 'secret' } });
  });

  it('marks non-KV creds unsupported, never decrypts them, and skips the write', async () => {
    const list = vi.fn(async () => ({
      data: [
        { id: 1, key: 'gh', type: 'oauth' },
        { id: 2, key: 'hdr', type: 'kv-header' },
      ],
    }));
    const get = vi.fn();
    const sandboxService = buildSandboxService();

    const result = await injectCredsIntoOnlyboxesSandbox({
      keys: ['gh', 'hdr'],
      marketService: buildMarketService({ get, list }),
      sandboxService,
    });

    expect(get).not.toHaveBeenCalled();
    expect(sandboxService.writeCredentials).not.toHaveBeenCalled();
    expect(result.unsupportedInSandbox).toEqual(['gh', 'hdr']);
  });

  it('reports keys missing from the store as notFound', async () => {
    const list = vi.fn(async () => ({ data: [] }));
    const sandboxService = buildSandboxService();

    const result = await injectCredsIntoOnlyboxesSandbox({
      keys: ['missing'],
      marketService: buildMarketService({ get: vi.fn(), list }),
      sandboxService,
    });

    expect(result.notFound).toEqual(['missing']);
    expect(result.success).toBe(false);
    expect(sandboxService.writeCredentials).not.toHaveBeenCalled();
  });
});
