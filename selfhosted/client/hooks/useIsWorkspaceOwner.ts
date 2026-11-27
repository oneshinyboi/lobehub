'use client';

import { useWorkspaceStore } from '../store/workspace';

/**
 * Whether the caller is the Owner of the active workspace.
 *
 * Personal mode has exactly one member (the signed-in user), so it keeps the
 * open-source default of full ownership. Inside a workspace the active
 * membership role decides: `admin` does *not* count as owner (CONTEXT.md D4).
 *
 * While the list is still loading with a selected workspace there is no role
 * yet; returning `false` is the safe answer, and `useIsWorkspaceLoading()`
 * lets call sites hold their rendering until the role is known.
 */
export const useIsWorkspaceOwner = (): boolean =>
  useWorkspaceStore((state) => {
    const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    if (!active) return true;
    return active.role === 'owner';
  });
