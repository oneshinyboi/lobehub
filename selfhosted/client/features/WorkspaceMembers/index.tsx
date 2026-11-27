'use client';

import {
  ActionIcon,
  Alert,
  Button,
  confirmModal,
  copyToClipboard,
  cssVar,
  Empty,
  Flexbox,
  Select,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import { Copy, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkspaceMemberWithProfile } from '@/business/client/hooks/useWorkspaceMembers';
import UserAvatar from '@/components/UserAvatar';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { usePermission } from '@/hooks/usePermission';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { getWorkspaceMemberName } from '@/utils/workspaceMemberName';

import { ASSIGNABLE_ROLES, type AssignableRole } from './const';
import { isWorkspaceMemberErrorCode, WORKSPACE_MEMBER_ERROR } from './errors';
import { useMembersSettings, type WorkspaceInviteLink } from './useMembersSettings';

const DATE_FORMAT = 'YYYY-MM-DD';

const rowStyle = {
  alignItems: 'center',
  borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
  display: 'flex',
  gap: 12,
  minWidth: 0,
  paddingBlock: 10,
} as const;

const growStyle = { flex: 1, minWidth: 0 } as const;

const roleLabel = (t: TFunction<'setting'>, role: string) =>
  String(
    t(`workspace.member.roles.${role}`, {
      defaultValue: role.charAt(0).toUpperCase() + role.slice(1),
    }),
  );

const formatDate = (value: Date | string | null | undefined) =>
  value ? dayjs(value).format(DATE_FORMAT) : '—';

/**
 * Turn a server refusal into copy the page can render.
 *
 * The last-owner case is the important one: the page does not pre-disable the
 * control, it attempts the write and explains the server's refusal. Any other
 * error keeps the server's message, which is already user-facing.
 */
const describeError = (error: unknown, t: TFunction<'setting'>): string => {
  const message = error instanceof Error ? error.message : '';

  if (isWorkspaceMemberErrorCode(message)) {
    if (message === WORKSPACE_MEMBER_ERROR.LAST_OWNER) {
      return String(
        t('workspace.members.errors.lastOwner', {
          defaultValue:
            'The workspace must keep at least one owner. Transfer ownership before changing or removing this member.',
        }),
      );
    }

    if (message === WORKSPACE_MEMBER_ERROR.MEMBER_NOT_FOUND) {
      return String(
        t('workspace.members.notFound', {
          defaultValue: 'This member does not exist or has left the workspace',
        }),
      );
    }
  }

  return (
    message ||
    String(
      t('workspace.members.actionFailed', {
        defaultValue: 'Something went wrong. Please try again.',
      }),
    )
  );
};

interface MemberRowProps {
  busy: boolean;
  canManage: boolean;
  isCurrentUser: boolean;
  member: WorkspaceMemberWithProfile;
  onRemove: (member: WorkspaceMemberWithProfile) => void;
  onRoleChange: (member: WorkspaceMemberWithProfile, role: AssignableRole) => void;
}

const MemberRow = memo<MemberRowProps>(
  ({ busy, canManage, isCurrentUser, member, onRemove, onRoleChange }) => {
    const { t } = useTranslation('setting');
    const name = getWorkspaceMemberName(member);
    const email = member.user?.email || '—';
    const roleControlLabel = String(
      t('workspace.member.manageAccessModal.title', {
        defaultValue: 'Change role for {{username}}',
        username: name,
      }),
    );

    // `owner` is shown only as the current value; it is never assignable here.
    const roleOptions = useMemo(() => {
      const assignable = ASSIGNABLE_ROLES.map((role) => ({
        label: roleLabel(t, role),
        value: role as string,
      }));

      if (member.role !== 'owner') return assignable;

      return [{ disabled: true, label: roleLabel(t, 'owner'), value: 'owner' }, ...assignable];
    }, [member.role, t]);

    const removeLabel = String(
      t('workspace.member.remove', { defaultValue: 'Remove from Workspace' }),
    );

    return (
      <div style={rowStyle}>
        <UserAvatar avatar={member.user?.avatar} name={name} size={36} />

        <div style={growStyle}>
          <Flexbox horizontal align={'center'} gap={6}>
            <Text ellipsis weight={500}>
              {name}
            </Text>
            {isCurrentUser && (
              <Tag size={'small'}>
                {t('workspace.member.profileCard.you', { defaultValue: 'You' })}
              </Tag>
            )}
          </Flexbox>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {email}
          </Text>
        </div>

        {canManage ? (
          <Select
            aria-label={roleControlLabel}
            disabled={busy}
            options={roleOptions}
            size={'small'}
            style={{ width: 132 }}
            value={member.role}
            onChange={(value) => {
              if (typeof value === 'string' && value !== member.role) {
                onRoleChange(member, value as AssignableRole);
              }
            }}
          />
        ) : (
          <Tag>{roleLabel(t, member.role)}</Tag>
        )}

        <Text fontSize={12} style={{ width: 104 }} type={'secondary'}>
          {String(t('workspace.member.profileCard.joined', { defaultValue: 'Joined' }))}{' '}
          {formatDate(member.joinedAt)}
        </Text>

        {canManage && (
          <ActionIcon
            aria-label={removeLabel}
            disabled={busy}
            icon={Trash2}
            title={removeLabel}
            onClick={() => onRemove(member)}
          />
        )}
      </div>
    );
  },
);

MemberRow.displayName = 'WorkspaceMemberRow';

interface InviteLinkRowProps {
  busy: boolean;
  canManage: boolean;
  invitation: WorkspaceInviteLink;
  onCopy: (invitation: WorkspaceInviteLink) => void;
  onRevoke: (invitation: WorkspaceInviteLink) => void;
}

const InviteLinkRow = memo<InviteLinkRowProps>(
  ({ busy, canManage, invitation, onCopy, onRevoke }) => {
    const { t } = useTranslation('setting');

    const expires = invitation.expiresAt
      ? String(
          t('workspace.members.inviteLink.expiresOn', {
            date: formatDate(invitation.expiresAt),
            defaultValue: 'Expires {{date}}',
          }),
        )
      : String(t('workspace.members.inviteLink.neverExpires', { defaultValue: 'Never expires' }));

    return (
      <div style={rowStyle}>
        <div style={growStyle}>
          <Text>
            {String(
              t('workspace.members.inviteLink.roleLabel', {
                defaultValue: 'Joins as',
              }),
            )}
            : {roleLabel(t, invitation.role)}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {expires}
          </Text>
        </div>

        <Button icon={<Copy size={14} />} size={'small'} onClick={() => onCopy(invitation)}>
          {t('workspace.members.inviteLink.copy', { defaultValue: 'Copy link' })}
        </Button>

        {canManage && (
          <Button danger disabled={busy} size={'small'} onClick={() => onRevoke(invitation)}>
            {t('workspace.members.inviteLink.revoke', { defaultValue: 'Revoke link' })}
          </Button>
        )}
      </div>
    );
  },
);

InviteLinkRow.displayName = 'WorkspaceInviteLinkRow';

/**
 * Workspace Settings → Members.
 *
 * The settings shell owns the page header and padding, so this component only
 * renders the two lists and their controls. Destructive controls are hidden for
 * callers without `manage_settings`; the server enforces the same gate again.
 */
const WorkspaceMembers = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canManage } = usePermission('manage_settings');
  const currentUserId = useUserStore(userProfileSelectors.userId);

  const {
    createInviteLink,
    invitations,
    invitationsError,
    invitationsLoading,
    members,
    membersLoading,
    refreshInvitations,
    removeMember,
    revokeInviteLink,
    updateMemberRole,
  } = useMembersSettings();

  const [inviteRole, setInviteRole] = useState<AssignableRole>('member');
  const [actionError, setActionError] = useState<null | string>(null);
  const [busyId, setBusyId] = useState<null | string>(null);

  const run = useCallback(
    async (id: string, task: () => Promise<unknown>, success?: string) => {
      setActionError(null);
      setBusyId(id);

      try {
        await task();
        if (success) toast.success(success);
      } catch (error) {
        setActionError(describeError(error, t));
      } finally {
        setBusyId(null);
      }
    },
    [t],
  );

  const handleCreateInvite = useCallback(async () => {
    setActionError(null);
    setBusyId('create');

    try {
      const link = await createInviteLink(inviteRole);
      if (link) await copyToClipboard(link.url);
      toast.success(
        String(
          t('workspace.members.inviteLink.created', {
            defaultValue: 'Invite link created and copied',
          }),
        ),
      );
    } catch (error) {
      setActionError(describeError(error, t));
    } finally {
      setBusyId(null);
    }
  }, [createInviteLink, inviteRole, t]);

  const handleCopyInvite = useCallback(
    async (invitation: WorkspaceInviteLink) => {
      try {
        await copyToClipboard(invitation.url);
        toast.success(
          String(t('workspace.members.inviteLink.copied', { defaultValue: 'Invite link copied' })),
        );
      } catch {
        toast.error(
          String(
            t('workspace.members.inviteLink.copyFailed', {
              defaultValue: "Couldn't copy the link. Select it and copy it manually.",
            }),
          ),
        );
      }
    },
    [t],
  );

  const handleRoleChange = useCallback(
    (member: WorkspaceMemberWithProfile, role: AssignableRole) => {
      void run(
        `role:${member.userId}`,
        () => updateMemberRole(member.userId, role),
        String(t('workspace.member.manageAccessModal.success', { defaultValue: 'Access updated' })),
      );
    },
    [run, t, updateMemberRole],
  );

  const handleRemove = useCallback(
    (member: WorkspaceMemberWithProfile) => {
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('workspace.member.removeConfirm.content', {
          defaultValue:
            'You are about to remove the following member from the workspace, are you sure you want to continue?',
        }),
        okButtonProps: { danger: true },
        okText: t('workspace.member.removeConfirm.confirm', { defaultValue: 'Confirm' }),
        onOk: () =>
          run(
            `remove:${member.userId}`,
            () => removeMember(member.userId),
            String(
              t('workspace.member.removeSuccess', {
                defaultValue: 'Member removed from workspace successfully.',
              }),
            ),
          ),
        title: t('workspace.member.removeConfirm.title', {
          defaultValue: 'Remove Workspace Member',
        }),
      });
    },
    [removeMember, run, t],
  );

  const handleRevoke = useCallback(
    (invitation: WorkspaceInviteLink) => {
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('workspace.members.inviteLink.revokeConfirm.content', {
          defaultValue:
            'The link stops working at once. Members who already joined through it stay.',
        }),
        okButtonProps: { danger: true },
        okText: t('workspace.members.inviteLink.revoke', { defaultValue: 'Revoke link' }),
        onOk: () =>
          run(
            `revoke:${invitation.id}`,
            () => revokeInviteLink(invitation.id),
            String(
              t('workspace.members.inviteLink.revoked', { defaultValue: 'Invite link revoked' }),
            ),
          ),
        title: t('workspace.members.inviteLink.revokeConfirm.title', {
          defaultValue: 'Revoke this invite link?',
        }),
      });
    },
    [revokeInviteLink, run, t],
  );

  const inviteRoleOptions = useMemo(
    () => ASSIGNABLE_ROLES.map((role) => ({ label: roleLabel(t, role), value: role })),
    [t],
  );

  if (membersLoading && members.length === 0) {
    return <SkeletonList rows={4} />;
  }

  return (
    <Flexbox gap={28}>
      {actionError && (
        <Alert
          closable
          showIcon
          title={actionError}
          type={'error'}
          onClose={() => setActionError(null)}
        />
      )}

      <Flexbox gap={12}>
        <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'} wrap={'wrap'}>
          <Flexbox flex={1} gap={4} style={{ minWidth: 220 }}>
            <Text strong fontSize={16}>
              {t('workspace.members.inviteLink.title', { defaultValue: 'Invite link' })}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('workspace.members.inviteLink.description', {
                defaultValue:
                  'Anyone with the link can sign in and join with the chosen role until it expires or you revoke it.',
              })}
            </Text>
          </Flexbox>

          {canManage && (
            <Flexbox horizontal align={'center'} gap={8}>
              <Select
                disabled={busyId === 'create'}
                options={inviteRoleOptions}
                size={'small'}
                style={{ width: 120 }}
                value={inviteRole}
                aria-label={String(
                  t('workspace.members.inviteLink.roleLabel', {
                    defaultValue: 'Joins as',
                  }),
                )}
                onChange={(value) => {
                  if (typeof value === 'string') setInviteRole(value as AssignableRole);
                }}
              />
              <Button
                loading={busyId === 'create'}
                size={'small'}
                type={'primary'}
                onClick={handleCreateInvite}
              >
                {t('workspace.members.inviteLink.create')}
              </Button>
            </Flexbox>
          )}
        </Flexbox>

        {invitationsError ? (
          <Alert
            showIcon
            type={'error'}
            action={{
              label: t('workspace.members.inviteLink.retry', { defaultValue: 'Retry' }),
              onClick: () => void refreshInvitations(),
            }}
            title={t('workspace.members.inviteLink.loadFailed', {
              defaultValue: "Couldn't load invite links.",
            })}
          />
        ) : invitationsLoading && invitations.length === 0 ? (
          <SkeletonList rows={2} />
        ) : invitations.length === 0 ? (
          <Empty
            style={{ paddingBlock: 24 }}
            description={t('workspace.members.inviteLink.emptyHint', {
              defaultValue: 'Create a link and share it. Anyone who opens it can sign in and join.',
            })}
          />
        ) : (
          <Flexbox>
            {invitations.map((invitation) => (
              <InviteLinkRow
                busy={busyId === `revoke:${invitation.id}`}
                canManage={canManage}
                invitation={invitation}
                key={invitation.id}
                onCopy={handleCopyInvite}
                onRevoke={handleRevoke}
              />
            ))}
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox gap={12}>
        <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'} wrap={'wrap'}>
          <Flexbox flex={1} gap={4} style={{ minWidth: 220 }}>
            <Text strong fontSize={16}>
              {t('workspace.members.tabs.members', { defaultValue: 'Members' })}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('workspace.members.subtitle', {
                defaultValue: 'Manage workspace members and invitations',
              })}
            </Text>
          </Flexbox>
          <Text type={'secondary'}>
            {t('workspace.members.totalCount', {
              count: members.length,
              defaultValue: '{{count}} members',
            })}
          </Text>
        </Flexbox>

        {members.length === 0 ? (
          <Empty
            description={t('workspace.members.empty', { defaultValue: 'No members yet' })}
            style={{ paddingBlock: 24 }}
          />
        ) : (
          <Flexbox>
            {members.map((member) => (
              <MemberRow
                busy={busyId === `role:${member.userId}` || busyId === `remove:${member.userId}`}
                canManage={canManage}
                isCurrentUser={member.userId === currentUserId}
                key={member.userId}
                member={member}
                onRemove={handleRemove}
                onRoleChange={handleRoleChange}
              />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

WorkspaceMembers.displayName = 'WorkspaceMembers';

export default WorkspaceMembers;
