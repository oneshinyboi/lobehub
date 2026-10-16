import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';
import type { SandboxService } from '@/server/services/sandbox';

import { injectCredsIntoOnlyboxesSandbox } from './onlyboxesInjection';

const base64 = (value: string) => Buffer.from(value).toString('base64');

const buildMarketService = (creds: Record<string, unknown>) =>
  ({ market: { creds } }) as unknown as MarketService;

const buildSandboxService = () =>
  ({ writeCredentials: vi.fn(async () => {}) }) as unknown as SandboxService & {
    writeCredentials: ReturnType<typeof vi.fn>;
  };

const baseParams = { topicId: 'topic-1', userId: 'user-1' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('injectCredsIntoOnlyboxesSandbox', () => {
  it('decrypts KV creds, writes the real values, and returns a masked env', async () => {
    const list = vi.fn(async () => ({ data: [{ id: 1, key: 'Openrouter', type: 'kv-env' }] }));
    const get = vi.fn(async () => ({ plaintext: { OPENROUTER_API_KEY: 'sk-or-real-key' } }));
    const sandboxService = buildSandboxService();

    const result = await injectCredsIntoOnlyboxesSandbox({
      ...baseParams,
      keys: ['Openrouter'],
      marketService: buildMarketService({ get, list }),
      sandboxService,
    });

    expect(get).toHaveBeenCalledWith(1, { decrypt: true });
    expect(sandboxService.writeCredentials).toHaveBeenCalledWith({
      env: { OPENROUTER_API_KEY: 'sk-or-real-key' },
      files: [],
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
      ...baseParams,
      keys: ['ws'],
      marketService,
      sandboxService,
      workspaceId: 'workspace-1',
    });

    expect(orgList).toHaveBeenCalledTimes(1);
    expect(personalList).not.toHaveBeenCalled();
    expect(sandboxService.writeCredentials).toHaveBeenCalledWith({
      env: { WS: 'secret' },
      files: [],
    });
  });

  it('fetches file creds, writes them to the documented path, and exports the path env var', async () => {
    const list = vi.fn(async () => ({ data: [{ id: 5, key: 'gcp-sa', type: 'file' }] }));
    const get = vi.fn(async () => ({
      fileName: 'credentials.json',
      fileUrl: 'https://files.example.com/credentials.json',
    }));
    const inject = vi.fn(async () => ({
      credentials: { files: [{ envName: 'GOOGLE_APPLICATION_CREDENTIALS', key: 'gcp-sa' }] },
    }));
    const fetchMock = vi.fn(async () => new Response('{"a":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const sandboxService = buildSandboxService();

    const result = await injectCredsIntoOnlyboxesSandbox({
      ...baseParams,
      keys: ['gcp-sa'],
      marketService: buildMarketService({ get, inject, list }),
      sandboxService,
    });

    expect(fetchMock).toHaveBeenCalledWith('https://files.example.com/credentials.json');
    expect(sandboxService.writeCredentials).toHaveBeenCalledWith({
      env: {},
      files: [
        {
          contentBase64: base64('{"a":1}'),
          envName: 'GOOGLE_APPLICATION_CREDENTIALS',
          path: '~/.creds/files/gcp-sa/credentials.json',
        },
      ],
    });
    // The path env var is surfaced unmasked so the model can use it.
    expect(result.credentials.env).toEqual({
      GOOGLE_APPLICATION_CREDENTIALS: '~/.creds/files/gcp-sa/credentials.json',
    });
    expect(result.credentials.files).toEqual([
      {
        filename: 'credentials.json',
        key: 'gcp-sa',
        path: '~/.creds/files/gcp-sa/credentials.json',
      },
    ]);
  });

  it('marks a file cred unsupported when its content cannot be fetched', async () => {
    const list = vi.fn(async () => ({ data: [{ id: 5, key: 'gcp-sa', type: 'file' }] }));
    const get = vi.fn(async () => ({
      fileName: 'credentials.json',
      fileUrl: 'https://files.example.com/credentials.json',
    }));
    const inject = vi.fn(async () => ({ credentials: { files: [] } }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 403 })),
    );
    const sandboxService = buildSandboxService();

    const result = await injectCredsIntoOnlyboxesSandbox({
      ...baseParams,
      keys: ['gcp-sa'],
      marketService: buildMarketService({ get, inject, list }),
      sandboxService,
    });

    expect(result.unsupportedInSandbox).toEqual(['gcp-sa']);
    expect(sandboxService.writeCredentials).not.toHaveBeenCalled();
  });

  it('marks non-KV, non-file creds unsupported, never decrypts them, and skips the write', async () => {
    const list = vi.fn(async () => ({
      data: [
        { id: 1, key: 'gh', type: 'oauth' },
        { id: 2, key: 'hdr', type: 'kv-header' },
      ],
    }));
    const get = vi.fn();
    const sandboxService = buildSandboxService();

    const result = await injectCredsIntoOnlyboxesSandbox({
      ...baseParams,
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
      ...baseParams,
      keys: ['missing'],
      marketService: buildMarketService({ get: vi.fn(), list }),
      sandboxService,
    });

    expect(result.notFound).toEqual(['missing']);
    expect(result.success).toBe(false);
    expect(sandboxService.writeCredentials).not.toHaveBeenCalled();
  });
});
