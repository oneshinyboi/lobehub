'use client';

import { useMemo } from 'react';

import { useWorkspaceMembers } from './useWorkspaceMembers';

/**
 * userId → display profile for the members of the active workspace.
 *
 * Personal mode (no active workspace) is an empty map and issues no request,
 * so a home surface that resolves a topic's triggerer through it simply renders
 * no author — degrading to the personal inbox with no extra branching.
 *
 * A workspace topic already carries `userId` (its creator / triggerer); this is
 * the client-side lookup that turns that id into a face and a name.
 */
export interface WorkspaceMemberProfile {
  avatar?: string | null;
  fullName?: string | null;
  username?: string | null;
}

const EMPTY: ReadonlyMap<string, WorkspaceMemberProfile> = new Map();

export const useWorkspaceMemberProfiles = (): ReadonlyMap<string, WorkspaceMemberProfile> => {
  const members = useWorkspaceMembers();

  return useMemo(() => {
    if (members.length === 0) return EMPTY;

    const profiles = new Map<string, WorkspaceMemberProfile>();
    for (const member of members) {
      // `user.fullName` already carries the workspace nickname when one is set
      // (see `toWorkspaceMemberWithProfile`), so every label here follows the
      // same nickname → account name precedence as the member directory.
      if (member.deletedAt || !member.user) continue;

      profiles.set(member.userId, {
        avatar: member.user.avatar ?? null,
        fullName: member.user.fullName ?? null,
        username: member.user.username ?? null,
      });
    }

    return profiles;
  }, [members]);
};
