'use client';

import { useWorkspaceStore } from '../store/workspace';

const selectActiveWorkspaceSlug = (state: {
  activeWorkspaceId: null | string;
  workspaces: { id: string; slug: string }[];
}): null | string =>
  state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)?.slug ?? null;

/**
 * Imperative read for path builders (`stableWorkspaceAwareNavigate`, store
 * actions). Returns `null` in personal mode, or while the list is still loading
 * — both cases are "do not prefix".
 */
export const getActiveWorkspaceSlug = (): null | string =>
  selectActiveWorkspaceSlug(useWorkspaceStore.getState());

export const useActiveWorkspaceSlug = (): null | string =>
  useWorkspaceStore(selectActiveWorkspaceSlug);
