'use client';

import { useWorkspaceStore } from '../store/workspace';

/**
 * Imperative read for service/store code that runs outside React. The workspace
 * id is the value sent as `X-Workspace-Id`; `null` is personal mode.
 */
export const getActiveWorkspaceId = (): null | string =>
  useWorkspaceStore.getState().activeWorkspaceId;

export const useActiveWorkspaceId = (): null | string =>
  useWorkspaceStore((state) => state.activeWorkspaceId);
