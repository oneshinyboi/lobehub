import type { WorkspaceItem } from '@lobechat/database/schemas';
import { create } from 'zustand';

/**
 * A workspace row as the client sees it: the stored record plus the caller's
 * membership role and the cloud billing tags. `plan` / `lockedOut` stay absent
 * here (billing is out of scope for the self-hosted build), but the fields are
 * kept on the type so cloud-shaped call sites keep compiling.
 */
export interface WorkspaceListItem extends WorkspaceItem {
  lockedOut?: boolean;
  plan?: 'business' | 'free' | 'pro';
  role?: null | string;
}

/**
 * The last workspace the user explicitly switched to. URL is the source of
 * truth for the *current* context; this key is only the boot-time hint that
 * restores a workspace when the landing URL carries no slug. Silent switches
 * (URL reconciliation) never write it.
 */
const ACTIVE_WORKSPACE_STORAGE_KEY = 'lobehub:active-workspace-id';

const hasLocalStorage = () => typeof localStorage !== 'undefined';

export const readPersistedActiveWorkspaceId = (): null | string => {
  if (!hasLocalStorage()) return null;
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * Persist (or clear) the user's explicit workspace choice. `null` means
 * personal mode — the key is removed rather than written as an empty string.
 */
export const persistActiveWorkspaceId = (workspaceId: null | string): void => {
  if (!hasLocalStorage()) return;
  try {
    if (workspaceId) localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
    else localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode / quota) — the in-memory store
    // still drives the current session.
  }
};

export interface WorkspaceStoreState {
  activeWorkspaceId: null | string;
  /**
   * Apply a fresh list from the server. Reconciles the active selection:
   *
   * - an active workspace the caller is no longer a member of is dropped, so a
   *   stale id can never be sent as `X-Workspace-Id`;
   * - on the very first application, a persisted explicit choice is restored
   *   only if it is still in the list;
   * - an empty list always leaves personal mode untouched (I4).
   */
  applyWorkspaces: (workspaces: WorkspaceListItem[]) => void;
  /** True once a list has been applied; gates the one-time persisted restore. */
  isWorkspaceListLoaded: boolean;
  /** True until the first `workspace.list` answer (success or error) lands. */
  isWorkspaceLoading: boolean;
  resetWorkspaces: () => void;
  setActiveWorkspaceId: (workspaceId: null | string) => void;
  /** Mark the first list fetch as settled without touching its contents. */
  settleWorkspaceLoading: () => void;
  /** Start (or stop) waiting on the first list fetch. */
  setWorkspaceLoading: (loading: boolean) => void;
  workspaces: WorkspaceListItem[];
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  activeWorkspaceId: null,
  isWorkspaceLoading: true,
  isWorkspaceListLoaded: false,
  workspaces: [],

  applyWorkspaces: (workspaces) => {
    const state = get();
    let activeWorkspaceId = state.activeWorkspaceId;

    if (activeWorkspaceId && !workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
      activeWorkspaceId = null;
      persistActiveWorkspaceId(null);
    }

    // Restoring a persisted choice is a boot-time reconciliation, not a user
    // action: it runs exactly once, and only for a workspace the caller is
    // still a member of.
    if (!state.isWorkspaceListLoaded && !activeWorkspaceId) {
      const persisted = readPersistedActiveWorkspaceId();
      if (persisted) {
        if (workspaces.some((workspace) => workspace.id === persisted))
          activeWorkspaceId = persisted;
        // A stale stored choice must not survive the first reconciliation —
        // otherwise every boot retries a workspace the caller has left.
        else persistActiveWorkspaceId(null);
      }
    }

    set({
      activeWorkspaceId,
      isWorkspaceListLoaded: true,
      isWorkspaceLoading: false,
      workspaces,
    });
  },

  resetWorkspaces: () =>
    set({
      activeWorkspaceId: null,
      isWorkspaceListLoaded: false,
      isWorkspaceLoading: true,
      workspaces: [],
    }),

  setActiveWorkspaceId: (workspaceId) => set({ activeWorkspaceId: workspaceId }),

  settleWorkspaceLoading: () => set({ isWorkspaceLoading: false }),

  setWorkspaceLoading: (loading) => set({ isWorkspaceLoading: loading }),
}));

/** Non-React store access for imperative call sites and service layers. */
export const getWorkspaceStoreState = () => useWorkspaceStore.getState();
