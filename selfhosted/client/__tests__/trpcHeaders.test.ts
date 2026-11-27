/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBusinessTrpcHeaders } from '@/business/client/trpc-headers';
import {
  persistActiveWorkspaceId,
  useWorkspaceStore,
  type WorkspaceListItem,
} from '@/selfhosted/client/store/workspace';

const workspace = (id: string, slug: string): WorkspaceListItem =>
  ({ id, name: slug, role: 'member', slug }) as WorkspaceListItem;

const resetStore = () =>
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    isWorkspaceListLoaded: false,
    isWorkspaceLoading: false,
    workspaces: [],
  });

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getBusinessTrpcHeaders', () => {
  it('returns no headers in personal mode', async () => {
    await expect(getBusinessTrpcHeaders()).resolves.toEqual({});
  });

  it('returns exactly one header naming the active workspace', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' });

    const headers = await getBusinessTrpcHeaders();

    expect(headers).toEqual({ 'X-Workspace-Id': 'ws-1' });
    expect(Object.keys(headers)).toHaveLength(1);
  });

  it('restores the persisted workspace on boot and scopes requests to it', async () => {
    persistActiveWorkspaceId('ws-2');

    useWorkspaceStore
      .getState()
      .applyWorkspaces([workspace('ws-1', 'team-a'), workspace('ws-2', 'team-b')]);

    await expect(getBusinessTrpcHeaders()).resolves.toEqual({ 'X-Workspace-Id': 'ws-2' });
  });

  it('drops the header immediately when the workspace is cleared', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-2' });

    await expect(getBusinessTrpcHeaders()).resolves.toEqual({ 'X-Workspace-Id': 'ws-2' });

    useWorkspaceStore.getState().setActiveWorkspaceId(null);

    await expect(getBusinessTrpcHeaders()).resolves.toEqual({});
  });

  it('resolves without a network call', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' });
    const fetch = vi.fn(() => {
      throw new Error('getBusinessTrpcHeaders must not hit the network');
    });
    vi.stubGlobal('fetch', fetch);

    await expect(getBusinessTrpcHeaders()).resolves.toEqual({ 'X-Workspace-Id': 'ws-1' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never throws, degrading to personal mode when the store is unavailable', async () => {
    vi.spyOn(useWorkspaceStore, 'getState').mockImplementation(() => {
      throw new Error('store unavailable');
    });

    await expect(getBusinessTrpcHeaders()).resolves.toEqual({});
  });
});
