'use client';

import { useWorkspaceStore } from '../store/workspace';

/**
 * Whether the caller is a read-only Viewer of the active workspace
 * (CONTEXT.md D4 role order: viewer < member < admin < owner).
 */
export const useIsWorkspaceViewer = (): boolean =>
  useWorkspaceStore((state) => {
    const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    return active?.role === 'viewer';
  });
