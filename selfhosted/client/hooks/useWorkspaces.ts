'use client';

import { useEffect } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import type { WorkspaceListItem } from '../store/workspace';
import { useWorkspaceStore } from '../store/workspace';

export type { WorkspaceListItem } from '../store/workspace';

/** Separate from scoped data: the membership list is identity-level, not workspace-level. */
const WORKSPACE_LIST_SWR_KEY = 'workspace.list';

/**
 * The caller's workspaces, fetched once per user and mirrored into the
 * workspace store. Every call site shares the same SWR key, so many components
 * can mount this without extra requests.
 *
 * The list is keyed by user id so an account switch in the same tab can never
 * read the previous user's cache entry. Personal mode owns no workspace; an
 * empty answer simply leaves the store's active workspace untouched (I4).
 */
export const useWorkspaces = (): WorkspaceListItem[] => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const applyWorkspaces = useWorkspaceStore((state) => state.applyWorkspaces);
  const settleWorkspaceLoading = useWorkspaceStore((state) => state.settleWorkspaceLoading);
  const setWorkspaceLoading = useWorkspaceStore((state) => state.setWorkspaceLoading);

  const { data, error } = useClientDataSWR(
    userId ? [WORKSPACE_LIST_SWR_KEY, userId] : null,
    () => lambdaClient.workspace.list.query() as Promise<WorkspaceListItem[]>,
  );

  useEffect(() => {
    if (data) {
      applyWorkspaces(data);
      return;
    }
    // No identity means there is nothing to wait for — personal mode renders
    // immediately instead of blocking on a list that will never arrive.
    if (error || !userId) {
      settleWorkspaceLoading();
      return;
    }
    // First list answer still in flight. Don't flip back to loading for a
    // background refetch (e.g. the SWR key changes on a workspace switch) —
    // the store already holds a valid list in that case.
    if (!useWorkspaceStore.getState().isWorkspaceListLoaded) setWorkspaceLoading(true);
  }, [applyWorkspaces, data, error, setWorkspaceLoading, settleWorkspaceLoading, userId]);

  return workspaces;
};
