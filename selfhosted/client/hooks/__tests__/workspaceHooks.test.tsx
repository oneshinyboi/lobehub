/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  persistActiveWorkspaceId,
  readPersistedActiveWorkspaceId,
  useWorkspaceStore,
  type WorkspaceListItem,
} from '../../store/workspace';
import { useActiveWorkspace } from '../useActiveWorkspace';
import { getActiveWorkspaceId, useActiveWorkspaceId } from '../useActiveWorkspaceId';
import { getActiveWorkspaceSlug, useActiveWorkspaceSlug } from '../useActiveWorkspaceSlug';
import { useHasActiveWorkspace } from '../useHasActiveWorkspace';
import { useHasWorkspace } from '../useHasWorkspace';
import { useIsWorkspaceLoading } from '../useIsWorkspaceLoading';
import { useIsWorkspaceOwner } from '../useIsWorkspaceOwner';
import { useIsWorkspaceViewer } from '../useIsWorkspaceViewer';
import { useSilentSwitchWorkspace, useSwitchWorkspace } from '../useSwitchWorkspace';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));

const workspace = (role: string, id = 'ws-1', slug = 'team'): WorkspaceListItem =>
  ({ id, name: 'Team', role, slug }) as WorkspaceListItem;

const resetStore = () => {
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    isWorkspaceListLoaded: false,
    isWorkspaceLoading: false,
    workspaces: [],
  });
};

beforeEach(() => {
  localStorage.clear();
  navigateMock.mockReset();
  resetStore();
});

describe('useIsWorkspaceOwner', () => {
  it('is false for a member and true for the owner of the active workspace', () => {
    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('member')]));
    act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-1'));

    const { result } = renderHook(() => useIsWorkspaceOwner());
    expect(result.current).toBe(false);

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('owner')]));
    expect(result.current).toBe(true);

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('admin')]));
    expect(result.current).toBe(false);
  });

  it('keeps the open-source default in personal mode', () => {
    const { result } = renderHook(() => useIsWorkspaceOwner());
    expect(result.current).toBe(true);
  });
});

describe('useIsWorkspaceViewer', () => {
  it('only reports the viewer role', () => {
    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('member')]));
    act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-1'));

    const { result } = renderHook(() => useIsWorkspaceViewer());
    expect(result.current).toBe(false);

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('viewer')]));
    expect(result.current).toBe(true);
  });
});

describe('empty workspace list', () => {
  it('leaves personal mode untouched and never restores a stale selection', () => {
    persistActiveWorkspaceId('ws-gone');

    act(() => useWorkspaceStore.getState().applyWorkspaces([]));

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBeNull();
    expect(state.workspaces).toEqual([]);
    expect(state.isWorkspaceListLoaded).toBe(true);
    expect(state.isWorkspaceLoading).toBe(false);
    expect(readPersistedActiveWorkspaceId()).toBeNull();

    const { result } = renderHook(() => ({
      active: useActiveWorkspace(),
      hasActive: useHasActiveWorkspace(),
      hasWorkspace: useHasWorkspace(),
      loading: useIsWorkspaceLoading(),
    }));

    expect(result.current).toEqual({
      active: null,
      hasActive: false,
      hasWorkspace: false,
      loading: false,
    });
  });

  it('drops an active workspace the caller is no longer a member of', () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-gone', isWorkspaceLoading: false });

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('member', 'ws-1')]));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });
});

describe('workspace selection', () => {
  it('restores a persisted choice only when it is still one of the memberships', () => {
    persistActiveWorkspaceId('ws-1');

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('member')]));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    expect(getActiveWorkspaceId()).toBe('ws-1');
    expect(getActiveWorkspaceSlug()).toBe('team');
  });

  it('exposes the active workspace to React and imperative callers', () => {
    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('member')]));
    act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-1'));

    const { result } = renderHook(() => ({
      active: useActiveWorkspace(),
      id: useActiveWorkspaceId(),
      slug: useActiveWorkspaceSlug(),
    }));

    expect(result.current.active?.id).toBe('ws-1');
    expect(result.current.id).toBe('ws-1');
    expect(result.current.slug).toBe('team');
    expect(getActiveWorkspaceId()).toBe('ws-1');
    expect(getActiveWorkspaceSlug()).toBe('team');
  });
});

describe('useSwitchWorkspace', () => {
  it('persists and navigates on an explicit user choice', async () => {
    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('member')]));

    const { result } = renderHook(() => useSwitchWorkspace());
    await act(async () => result.current.switchWorkspace('ws-1'));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    expect(readPersistedActiveWorkspaceId()).toBe('ws-1');
    expect(navigateMock).toHaveBeenCalledWith('/team');

    await act(async () => result.current.switchToPersonal());

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    expect(readPersistedActiveWorkspaceId()).toBeNull();
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('attaches no user-intent side effects on a silent switch', async () => {
    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('member')]));

    const { result } = renderHook(() => useSilentSwitchWorkspace());
    await act(async () => result.current.switchWorkspace('ws-1'));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    expect(readPersistedActiveWorkspaceId()).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();

    await act(async () => result.current.switchToPersonal());

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
