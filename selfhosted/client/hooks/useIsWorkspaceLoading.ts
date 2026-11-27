'use client';

import { useWorkspaceStore } from '../store/workspace';

/**
 * True while the workspace list is unresolved. Consumers use it to avoid
 * painting a definitive empty/personal state (e.g. a 403 or 404) before the
 * caller's memberships are known.
 */
export const useIsWorkspaceLoading = (): boolean =>
  useWorkspaceStore((state) => state.isWorkspaceLoading);
