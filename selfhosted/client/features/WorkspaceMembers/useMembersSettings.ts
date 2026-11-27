'use client';

import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import type { WorkspaceMemberWithProfile } from '@/business/client/hooks/useWorkspaceMembers';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { scopedLambdaClient } from '@/libs/trpc/client';

import type { AssignableRole } from './const';

/** One reusable invite link exactly as `workspaceMember.listInviteLinks` returns it. */
export interface WorkspaceInviteLink {
  createdAt: Date | string;
  expiresAt: Date | string | null;
  id: string;
  role: string;
  token: string;
  /** Absolute `/invite/<token>` URL the owner copies themselves (link-only invites). */
  url: string;
}

const INVITE_LINKS_SWR_KEY = 'workspaceMember.listInviteLinks';
const MEMBERS_SWR_KEY = 'workspaceMember.list';

/**
 * Everything the members settings page reads and writes.
 *
 * The roster comes from the shared identity hook (WS-10), so a member reads the
 * same nickname-first shape here as in pickers and task fields. Invite links are
 * page-local data; both caches are revalidated after every write rather than
 * patched optimistically, because the server owns ordering, expiry and the
 * last-owner refusal.
 */
export const useMembersSettings = () => {
  const workspaceId = useActiveWorkspaceId();
  const { data: members, isLoading: membersLoading } = useFetchWorkspaceMembers();

  const invitesKey = workspaceId ? [INVITE_LINKS_SWR_KEY] : null;
  const {
    data: invitations,
    error: invitationsError,
    isLoading: invitationsLoading,
  } = useClientDataSWR<WorkspaceInviteLink[]>(invitesKey, async () => {
    if (!workspaceId) return [];

    return (await scopedLambdaClient(
      workspaceId,
    ).workspaceMember.listInviteLinks.query()) as WorkspaceInviteLink[];
  });

  const refreshInvitations = useCallback(async () => {
    await mutate([INVITE_LINKS_SWR_KEY]);
  }, []);

  const refreshMembers = useCallback(async () => {
    await mutate([MEMBERS_SWR_KEY, { includeDeleted: false }]);
  }, []);

  const createInviteLink = useCallback(
    async (role: AssignableRole) => {
      if (!workspaceId) return;

      const created = (await scopedLambdaClient(
        workspaceId,
      ).workspaceMember.createInviteLink.mutate({
        role,
      })) as WorkspaceInviteLink;
      await refreshInvitations();

      // Returned so the page can copy the fresh link immediately: creating one
      // is only useful once it reaches the clipboard.
      return created;
    },
    [workspaceId, refreshInvitations],
  );

  const revokeInviteLink = useCallback(
    async (id: string) => {
      if (!workspaceId) return;

      await scopedLambdaClient(workspaceId).workspaceMember.revokeInviteLink.mutate({ id });
      await refreshInvitations();
    },
    [workspaceId, refreshInvitations],
  );

  const updateMemberRole = useCallback(
    async (userId: string, role: AssignableRole) => {
      if (!workspaceId) return;

      await scopedLambdaClient(workspaceId).workspaceMember.updateRole.mutate({ role, userId });
      await refreshMembers();
    },
    [workspaceId, refreshMembers],
  );

  const removeMember = useCallback(
    async (userId: string) => {
      if (!workspaceId) return;

      await scopedLambdaClient(workspaceId).workspaceMember.removeMember.mutate({ userId });
      await refreshMembers();
    },
    [workspaceId, refreshMembers],
  );

  return {
    createInviteLink,
    invitations: invitations ?? [],
    invitationsError,
    invitationsLoading,
    members: members as WorkspaceMemberWithProfile[],
    membersLoading,
    refreshInvitations,
    removeMember,
    revokeInviteLink,
    updateMemberRole,
  };
};

export type MembersSettings = ReturnType<typeof useMembersSettings>;
