'use client';

import { useClientDataSWR } from '@/libs/swr';
import { scopedLambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspaceId } from './useActiveWorkspaceId';
import type { WorkspaceMemberApiRow, WorkspaceMemberWithProfile } from './workspaceMemberIdentity';
import { memberSnapshots, toWorkspaceMemberWithProfile } from './workspaceMemberIdentity';

export interface FetchWorkspaceMembersOptions {
  /** Skip the request while false, keeping hook order stable. */
  enabled?: boolean;
  includeDeleted?: boolean;
}

/**
 * Identity-level data: one directory per workspace, not scoped by any other
 * resource. `useClientDataSWR` appends the active workspace id to this key, so
 * two workspaces keep independent caches and a switch never shows the previous
 * roster.
 */
const WORKSPACE_MEMBERS_SWR_KEY = 'workspaceMember.list';

const EMPTY_MEMBERS: WorkspaceMemberWithProfile[] = [];

/**
 * Loads the active workspace's member roster from `workspaceMember.list`.
 *
 * Personal mode has no roster, so the SWR key is `null` and no request is
 * issued (CONTEXT.md I4). `enabled: false` defers the request until the host
 * surface actually needs the directory (e.g. a profile card opening).
 *
 * Manual check (WS-10): with a workspace active, opening the task assignee
 * picker on `/member-identity/task/task_ws10_demo` listed the three real
 * members and showed the nicknamed member as "Ali (Ops)", not their account
 * name; the same page in personal mode issued no `workspaceMember.list`
 * request. Covered by `__tests__/workspaceMembers.test.tsx`.
 */
export const useFetchWorkspaceMembers = (options: FetchWorkspaceMembersOptions = {}) => {
  const { enabled = true, includeDeleted = false } = options;
  const workspaceId = useActiveWorkspaceId();

  const key = workspaceId && enabled ? [WORKSPACE_MEMBERS_SWR_KEY, { includeDeleted }] : null;

  const { data, isLoading } = useClientDataSWR(key, async () => {
    if (!workspaceId) return EMPTY_MEMBERS;

    // Pin the client to the workspace the key was built for instead of relying
    // on the ambient request header: the roster is identity data for exactly
    // this workspace, and a switch must never read an in-flight stale answer.
    // The explicit scope also keeps the hook working before the ambient
    // `X-Workspace-Id` injection (WS-4) is present.
    const rows = await scopedLambdaClient(workspaceId).workspaceMember.list.query({
      includeDeleted,
    });
    const members = ((rows ?? []) as WorkspaceMemberApiRow[]).map(toWorkspaceMemberWithProfile);

    // Keep the imperative snapshot on the active roster; a deleted-inclusive
    // read is a settings view and must not feed tool executors.
    if (!includeDeleted) memberSnapshots.set(workspaceId, members);

    return members;
  });

  return {
    data: (data as WorkspaceMemberWithProfile[] | undefined) ?? EMPTY_MEMBERS,
    isLoading,
  };
};
