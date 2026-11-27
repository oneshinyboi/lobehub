'use client';

import { useWorkspaceStore } from '../store/workspace';

/** Whether the caller belongs to at least one workspace. */
export const useHasWorkspace = (): boolean =>
  useWorkspaceStore((state) => state.workspaces.length > 0);
