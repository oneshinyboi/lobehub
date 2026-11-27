/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWorkspaceStore, type WorkspaceListItem } from '../store/workspace';
import { hasMinWorkspaceRole, usePermission } from '../usePermission';

const workspace = (role: string, id = 'ws-1'): WorkspaceListItem =>
  ({ id, name: 'Team', role, slug: 'team' }) as WorkspaceListItem;

const resetStore = () =>
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    isWorkspaceListLoaded: false,
    isWorkspaceLoading: false,
    workspaces: [],
  });

const enterWorkspace = (role: string) => {
  act(() => useWorkspaceStore.getState().applyWorkspaces([workspace(role)]));
  act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-1'));
};

beforeEach(resetStore);

describe('usePermission in personal mode', () => {
  it('stays permissive for every action when no workspace is active (I4)', () => {
    for (const action of [
      'create_content',
      'edit_own_content',
      'edit_others_content',
      'manage_provider_key',
      'manage_settings',
      'view_billing',
    ]) {
      const { result } = renderHook(() => usePermission(action));

      expect(result.current).toEqual({ allowed: true, reason: undefined });
    }
  });

  it('never consults a workspace role that happens to be in the list', () => {
    // A loaded list without a selection is personal mode: the caller is not
    // operating inside the workspace, so nothing is gated.
    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('viewer')]));

    const { result } = renderHook(() => usePermission('manage_settings'));

    expect(result.current).toEqual({ allowed: true, reason: undefined });
  });
});

describe('usePermission inside a workspace', () => {
  it('blocks a member from manage_settings and returns a localised reason', () => {
    enterWorkspace('member');

    const { result } = renderHook(() => usePermission('manage_settings'));

    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe('workspace.permission.requiresAdmin');
    expect(typeof result.current.reason).toBe('string');
  });

  it('allows an admin and the owner to manage_settings', () => {
    enterWorkspace('admin');

    const admin = renderHook(() => usePermission('manage_settings'));
    expect(admin.result.current).toEqual({ allowed: true, reason: undefined });

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('owner')]));
    expect(admin.result.current).toEqual({ allowed: true, reason: undefined });
  });

  it('keeps content writes out of a viewer and open to a member', () => {
    enterWorkspace('viewer');

    const viewerCreate = renderHook(() => usePermission('create_content'));
    expect(viewerCreate.result.current).toEqual({
      allowed: false,
      reason: 'workspace.permission.requiresMember',
    });

    const viewerEdit = renderHook(() => usePermission('edit_own_content'));
    expect(viewerEdit.result.current.allowed).toBe(false);

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('member')]));

    const memberCreate = renderHook(() => usePermission('create_content'));
    expect(memberCreate.result.current).toEqual({ allowed: true, reason: undefined });

    const memberEdit = renderHook(() => usePermission('edit_own_content'));
    expect(memberEdit.result.current).toEqual({ allowed: true, reason: undefined });
  });

  it('reserves editing other members content for the owner', () => {
    enterWorkspace('member');

    const member = renderHook(() => usePermission('edit_others_content'));
    expect(member.result.current).toEqual({
      allowed: false,
      reason: 'workspace.permission.requiresOwner',
    });

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('admin')]));
    const admin = renderHook(() => usePermission('edit_others_content'));
    expect(admin.result.current.allowed).toBe(false);

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('owner')]));
    const owner = renderHook(() => usePermission('edit_others_content'));
    expect(owner.result.current).toEqual({ allowed: true, reason: undefined });
  });

  it('gates shared provider keys and billing visibility at admin', () => {
    enterWorkspace('member');

    const memberProvider = renderHook(() => usePermission('manage_provider_key'));
    expect(memberProvider.result.current).toEqual({
      allowed: false,
      reason: 'workspace.permission.requiresAdmin',
    });

    const memberBilling = renderHook(() => usePermission('view_billing'));
    expect(memberBilling.result.current.allowed).toBe(false);

    act(() => useWorkspaceStore.getState().applyWorkspaces([workspace('admin')]));

    const adminProvider = renderHook(() => usePermission('manage_provider_key'));
    expect(adminProvider.result.current.allowed).toBe(true);

    const adminBilling = renderHook(() => usePermission('view_billing'));
    expect(adminBilling.result.current.allowed).toBe(true);
  });

  it('stays permissive for action codes the overlay does not map yet', () => {
    enterWorkspace('viewer');

    const { result } = renderHook(() => usePermission('future_action'));

    expect(result.current).toEqual({ allowed: true, reason: undefined });
  });

  it('blocks while a workspace is selected but its role has not loaded yet', () => {
    // URL sync can select a workspace before `workspace.list` answers. Denying
    // until the role is known is the safe half-state; AdminOnly paints a
    // loading screen instead of a 403 in that window.
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' });

    const { result } = renderHook(() => usePermission('manage_settings'));

    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe('workspace.permission.requiresAdmin');
  });
});

describe('hasMinWorkspaceRole', () => {
  it('follows the viewer < member < admin < owner order', () => {
    expect(hasMinWorkspaceRole('viewer', 'member')).toBe(false);
    expect(hasMinWorkspaceRole('member', 'member')).toBe(true);
    expect(hasMinWorkspaceRole('member', 'admin')).toBe(false);
    expect(hasMinWorkspaceRole('admin', 'admin')).toBe(true);
    expect(hasMinWorkspaceRole('admin', 'owner')).toBe(false);
    expect(hasMinWorkspaceRole('owner', 'owner')).toBe(true);
    expect(hasMinWorkspaceRole('owner', 'viewer')).toBe(true);
  });

  it('does not grant anything to an unknown or missing role', () => {
    expect(hasMinWorkspaceRole(undefined, 'viewer')).toBe(false);
    expect(hasMinWorkspaceRole(null, 'viewer')).toBe(false);
    expect(hasMinWorkspaceRole('super_admin', 'viewer')).toBe(false);
  });
});
