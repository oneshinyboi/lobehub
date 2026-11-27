import { getActiveWorkspaceId } from './useActiveWorkspaceId';
import { useFetchWorkspaceMembers } from './useFetchWorkspaceMembers';
import type { WorkspaceMemberWithProfile } from './workspaceMemberIdentity';
import { memberSnapshots } from './workspaceMemberIdentity';

export type {
  WorkspaceMemberApiRow,
  WorkspaceMemberUserProfile,
  WorkspaceMemberWithProfile,
} from './workspaceMemberIdentity';

/**
 * The active workspace's members, enriched with their profiles and with the
 * name each member goes by in this workspace (nickname first). Personal mode
 * returns an empty list and issues no request.
 */
export const useWorkspaceMembers = (): WorkspaceMemberWithProfile[] =>
  useFetchWorkspaceMembers().data;

/**
 * Non-hook snapshot of the same list, for imperative callers such as the task
 * tool executor. Populated by `useFetchWorkspaceMembers` when a workspace
 * roster lands; personal mode always reads empty.
 */
export const getWorkspaceMembers = (): WorkspaceMemberWithProfile[] => {
  const workspaceId = getActiveWorkspaceId();
  return workspaceId ? (memberSnapshots.get(workspaceId) ?? []) : [];
};
