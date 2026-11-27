'use client';

import { useWorkspaceStore } from '../store/workspace';

/** Whether the app is currently scoped to a workspace (not personal mode). */
export const useHasActiveWorkspace = (): boolean =>
  useWorkspaceStore((state) => !!state.activeWorkspaceId);
