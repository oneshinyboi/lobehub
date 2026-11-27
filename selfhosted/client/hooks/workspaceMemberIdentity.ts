import type { WorkspaceMemberItem } from '@lobechat/database/schemas';

export interface WorkspaceMemberUserProfile {
  avatar?: string | null;
  email?: string | null;
  fullName?: string | null;
  username?: string | null;
}

/**
 * Membership row enriched with the member's display profile. `user.fullName`
 * is already resolved to the name the member goes by in this workspace (their
 * nickname when they set one), so imperative callers that only read `user`
 * still label people the same way the UI does.
 */
export type WorkspaceMemberWithProfile = WorkspaceMemberItem & {
  user?: WorkspaceMemberUserProfile | null;
};

/**
 * The row shape `workspaceMember.list` answers with: the membership record
 * plus the public profile columns of the member. Declared locally instead of
 * imported from the server so a client bundle never reaches into server code.
 */
export interface WorkspaceMemberApiRow extends WorkspaceMemberItem {
  user?: WorkspaceMemberUserProfile | null;
}

/**
 * Apply workspace nickname precedence exactly once, at the boundary between
 * the API and every consumer. Inside a workspace a nickname replaces the
 * account name (`src/utils/workspaceMemberName.ts`); putting the resolved name
 * in `user.fullName` keeps callers that don't import that util — such as the
 * task tool executor — from showing the account name instead.
 */
export const toWorkspaceMemberWithProfile = (
  member: WorkspaceMemberApiRow,
): WorkspaceMemberWithProfile => {
  const nickname = member.config?.nickname?.trim() || undefined;
  const user = member.user;

  if (!user) {
    return {
      ...member,
      user: nickname ? { avatar: null, email: null, fullName: nickname, username: null } : null,
    };
  }

  return {
    ...member,
    user: { ...user, fullName: nickname ?? user.fullName ?? null },
  };
};

/**
 * `workspaceId → last fetched roster`, shared with the imperative
 * `getWorkspaceMembers` getter. Keyed per workspace so switching context can
 * never read another workspace's list.
 */
export const memberSnapshots = new Map<string, WorkspaceMemberWithProfile[]>();
