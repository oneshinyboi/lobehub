'use client';

import type { WorkspaceListItem } from '../store/workspace';
import { useWorkspaceStore } from '../store/workspace';

export type { WorkspaceListItem } from '../store/workspace';

/**
 * The workspace the app is currently operating in, or `null` in personal mode.
 *
 * Derived from the workspace store rather than fetched: the list is owned by
 * `useWorkspaces` (mounted by the route metadata bridge), so every consumer
 * sees the same selection without issuing its own request.
 */
export const useActiveWorkspace = (): null | WorkspaceListItem =>
  useWorkspaceStore(
    (state) =>
      state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null,
  );
