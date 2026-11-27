'use client';

import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';

import { persistActiveWorkspaceId, useWorkspaceStore } from '../store/workspace';

export interface SwitchWorkspaceActions {
  switchToPersonal: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
}

/**
 * `explicit` switches are a user choice: they persist the selection (so the
 * next boot can restore it) and navigate the URL to the chosen scope.
 * `silent` switches only align the store with external state (the URL), and
 * must not attach either side effect.
 */
const useSwitch = (mode: 'explicit' | 'silent'): SwitchWorkspaceActions => {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);

  const switchWorkspace = useCallback(
    async (id: string) => {
      setActiveWorkspaceId(id);

      if (mode !== 'explicit') return;

      persistActiveWorkspaceId(id);
      const workspace = workspaces.find((item) => item.id === id);
      if (workspace) navigate(`/${workspace.slug}`);
    },
    [mode, navigate, setActiveWorkspaceId, workspaces],
  );

  const switchToPersonal = useCallback(async () => {
    setActiveWorkspaceId(null);

    if (mode !== 'explicit') return;

    persistActiveWorkspaceId(null);
    navigate('/');
  }, [mode, navigate, setActiveWorkspaceId]);

  return useMemo(
    () => ({ switchToPersonal, switchWorkspace }),
    [switchToPersonal, switchWorkspace],
  );
};

/**
 * Workspace switch invoked from imperative call sites that represent an
 * explicit user choice (e.g. switcher click, wizard landing, accept-invite,
 * post-leave redirect).
 */
export const useSwitchWorkspace = (): SwitchWorkspaceActions => useSwitch('explicit');

/**
 * Workspace switch invoked from passive reconciliation sources (e.g. URL sync)
 * where the active workspace is being aligned with external state rather than
 * chosen by the user.
 */
export const useSilentSwitchWorkspace = (): SwitchWorkspaceActions => useSwitch('silent');
