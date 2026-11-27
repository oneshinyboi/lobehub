import type { WorkspaceMemberWithProfile } from '@/business/client/hooks/useWorkspaceMembers';

export const getWorkspaceMemberName = (member?: WorkspaceMemberWithProfile | null): string => {
  if (!member) return '';

  return member.user?.fullName?.trim() || member.user?.username?.trim() || member.userId;
};

export const getWorkspaceMemberEmail = (
  member?: WorkspaceMemberWithProfile | null,
): string | undefined => member?.user?.email?.trim() || undefined;
