import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TRPCClientError } from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceMemberWithProfile } from '@/business/client/hooks/useWorkspaceMembers';
import { useUserStore } from '@/store/user';

import { WORKSPACE_MEMBER_ERROR } from './errors';
import WorkspaceMembers from './index';
import type { MembersSettings } from './useMembersSettings';

const settings = vi.hoisted(
  () =>
    ({
      createInviteLink: vi.fn(),
      invitations: [],
      invitationsError: undefined,
      invitationsLoading: false,
      members: [],
      membersLoading: false,
      refreshInvitations: vi.fn(),
      removeMember: vi.fn(),
      revokeInviteLink: vi.fn(),
      updateMemberRole: vi.fn(),
    }) as unknown as MembersSettings,
);

const permission = vi.hoisted(() => ({ allowed: true }));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: permission.allowed, reason: undefined }),
}));

vi.mock('./useMembersSettings', () => ({
  useMembersSettings: () => settings,
}));

const member = (overrides: Partial<WorkspaceMemberWithProfile> = {}): WorkspaceMemberWithProfile =>
  ({
    config: {},
    deletedAt: null,
    joinedAt: new Date('2026-01-02T00:00:00.000Z'),
    responsibilities: null,
    role: 'member',
    title: null,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    userId: 'member-1',
    workspaceId: 'ws-1',
    user: {
      avatar: null,
      email: 'mike@example.com',
      fullName: 'Mike Member',
      username: 'mike',
    },
    ...overrides,
  }) as WorkspaceMemberWithProfile;

const owner = () =>
  member({
    role: 'owner',
    user: {
      avatar: null,
      email: 'zoe@example.com',
      fullName: 'Zoe Owner',
      username: 'zoe',
    },
    userId: 'owner-1',
  });

const invite = () => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-08T00:00:00.000Z'),
  id: 'invite-1',
  role: 'member',
  token: 'tok_123',
  url: 'http://localhost/invite/tok_123',
});

beforeEach(() => {
  vi.clearAllMocks();
  permission.allowed = true;

  const mutable = settings as unknown as {
    invitations: ReturnType<typeof invite>[];
    members: WorkspaceMemberWithProfile[];
  };
  mutable.invitations = [];
  mutable.members = [];
  settings.invitationsLoading = false;
  settings.membersLoading = false;
  settings.invitationsError = undefined;

  vi.mocked(settings.createInviteLink).mockResolvedValue(undefined as never);
  vi.mocked(settings.removeMember).mockResolvedValue(undefined);
  vi.mocked(settings.revokeInviteLink).mockResolvedValue(undefined);
  vi.mocked(settings.updateMemberRole).mockResolvedValue(undefined);
  vi.mocked(settings.refreshInvitations).mockResolvedValue(undefined);

  useUserStore.setState({ user: { id: 'owner-1' } } as never);
});

describe('WorkspaceMembers page', () => {
  it('renders the empty state for a workspace with no members or invite links', () => {
    render(<WorkspaceMembers />);

    expect(screen.getByText('No members yet')).toBeInTheDocument();
    expect(
      screen.getByText('Create a link and share it. Anyone who opens it can sign in and join.'),
    ).toBeInTheDocument();
  });

  it('gives a plain member a read-only list with no destructive controls', () => {
    permission.allowed = false;
    (settings as unknown as { members: WorkspaceMemberWithProfile[] }).members = [owner()];
    (settings as unknown as { invitations: ReturnType<typeof invite>[] }).invitations = [invite()];

    render(<WorkspaceMembers />);

    // Role is a label, not a control; nothing to change or remove.
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from Workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create invite link' })).not.toBeInTheDocument();
  });

  it('surfaces the server refusal when the last owner is demoted', async () => {
    vi.mocked(settings.updateMemberRole).mockRejectedValue(
      new TRPCClientError(WORKSPACE_MEMBER_ERROR.LAST_OWNER),
    );
    (settings as unknown as { members: WorkspaceMemberWithProfile[] }).members = [owner()];

    const user = userEvent.setup();
    render(<WorkspaceMembers />);

    const roleControl = screen
      .getAllByRole('combobox')
      .find((control) => control.textContent?.includes('Owner'));
    await user.click(roleControl!);

    await user.click(await screen.findByRole('option', { name: 'Viewer' }));

    expect(
      await screen.findByText(
        'The workspace must keep at least one owner. Transfer ownership before changing or removing this member.',
      ),
    ).toBeInTheDocument();
    expect(settings.updateMemberRole).toHaveBeenCalledWith('owner-1', 'viewer');
  });
});
