/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getBusinessTrpcHeaders } from '@/business/client/trpc-headers';
import { useWorkspaceUrlSync } from '@/features/Workspace/useWorkspaceUrlSync';
import {
  persistActiveWorkspaceId,
  useWorkspaceStore,
  type WorkspaceListItem,
} from '@/selfhosted/client/store/workspace';

const workspace = (id: string, slug: string): WorkspaceListItem =>
  ({ id, name: slug, role: 'member', slug }) as WorkspaceListItem;

const workspaces = [workspace('ws-1', 'team-a'), workspace('ws-2', 'team-b')];

vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaces: () => useWorkspaceStore.getState().workspaces,
}));
vi.mock('@/business/client/hooks/useIsWorkspaceLoading', () => ({
  useIsWorkspaceLoading: () => false,
}));

const wrapper =
  (path: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    isWorkspaceListLoaded: false,
    isWorkspaceLoading: false,
    workspaces: [],
  });
});

describe('workspace scope persistence', () => {
  it('prefers the URL slug over the persisted workspace', async () => {
    persistActiveWorkspaceId('ws-2');
    useWorkspaceStore.getState().applyWorkspaces(workspaces);

    // Boot restored the persisted choice…
    await expect(getBusinessTrpcHeaders()).resolves.toEqual({ 'X-Workspace-Id': 'ws-2' });

    // …but the `/{slug}` route wins over it.
    renderHook(() => useWorkspaceUrlSync(), { wrapper: wrapper('/team-a/agent/inbox') });

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    await expect(getBusinessTrpcHeaders()).resolves.toEqual({ 'X-Workspace-Id': 'ws-1' });
  });
});
