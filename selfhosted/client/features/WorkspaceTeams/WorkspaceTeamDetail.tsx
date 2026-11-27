'use client';

import { ActionIcon, Avatar, Button, Empty, Flexbox, Modal, Tag, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { ArrowLeft, Pencil, Plus, Trash2, UserMinus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkspaceMemberWithProfile } from '@/business/client/hooks/useWorkspaceMembers';

import AddTeamMembersModal from './AddTeamMembersModal';
import { getWorkspaceMemberEmail, getWorkspaceMemberName } from './memberDisplay';
import type { WorkspaceTeamDetail, WorkspaceTeamMember } from './types';

interface WorkspaceTeamDetailViewProps {
  blockedReason?: string;
  canManage: boolean;
  onAddMembers: (userIds: string[]) => Promise<void>;
  onBack: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRemoveMember: (userId: string) => Promise<void>;
  team: WorkspaceTeamDetail;
  workspaceMembers: WorkspaceMemberWithProfile[];
}

const WorkspaceTeamDetailView = memo<WorkspaceTeamDetailViewProps>(
  ({
    blockedReason,
    canManage,
    onAddMembers,
    onBack,
    onDelete,
    onEdit,
    onRemoveMember,
    team,
    workspaceMembers,
  }) => {
    const { t } = useTranslation(['setting', 'common']);
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<WorkspaceTeamMember | null>(null);
    const [removeLoading, setRemoveLoading] = useState(false);
    const [removeError, setRemoveError] = useState('');

    const profiles = useMemo(
      () => new Map(workspaceMembers.map((member) => [member.userId, member])),
      [workspaceMembers],
    );

    const handleRemove = async () => {
      if (!removing || removeLoading) return;

      setRemoveLoading(true);
      setRemoveError('');
      try {
        await onRemoveMember(removing.userId);
        toast.success(t('workspace.teams.members.removeSuccess'));
        setRemoving(null);
      } catch {
        setRemoveError(t('workspace.teams.errors.generic'));
      } finally {
        setRemoveLoading(false);
      }
    };

    const manageTitle = canManage ? undefined : blockedReason;

    return (
      <Flexbox gap={20}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Button icon={ArrowLeft} type={'text'} onClick={onBack}>
            {t('workspace.teams.backToList')}
          </Button>
          <Flexbox horizontal gap={8}>
            <Button disabled={!canManage} icon={Pencil} title={manageTitle} onClick={onEdit}>
              {t('edit', { ns: 'common' })}
            </Button>
            <Button
              danger
              disabled={!canManage}
              icon={Trash2}
              title={manageTitle}
              onClick={onDelete}
            >
              {t('workspace.teams.delete.button')}
            </Button>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal align={'flex-start'} gap={16}>
          <Avatar avatar={team.avatar || team.name} shape={'square'} size={48} title={team.name} />
          <Flexbox gap={6} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={20} weight={600}>
                {team.name}
              </Text>
              <Tag>{team.identifier}</Tag>
            </Flexbox>
            <Text type={'secondary'}>
              {team.description || t('workspace.teams.overview.noDescription')}
            </Text>
          </Flexbox>
        </Flexbox>

        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={15} weight={600}>
                {t('workspace.teams.members.title')}
              </Text>
              <Text type={'secondary'}>
                {t('workspace.teams.members.description', { count: team.members.length })}
              </Text>
            </Flexbox>
            <Button
              disabled={!canManage}
              icon={Plus}
              size={'small'}
              title={manageTitle}
              onClick={() => setAdding(true)}
            >
              {t('workspace.teams.members.add')}
            </Button>
          </Flexbox>

          {team.members.length === 0 ? (
            <Empty description={t('workspace.teams.members.empty')} style={{ paddingBlock: 32 }} />
          ) : (
            <Flexbox>
              {team.members.map((member) => {
                const profile = profiles.get(member.userId);
                const name = getWorkspaceMemberName(profile) || member.userId;
                const email = getWorkspaceMemberEmail(profile);

                return (
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={12}
                    key={member.userId}
                    style={{
                      borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
                      paddingBlock: 10,
                      paddingInline: 4,
                    }}
                  >
                    <Avatar
                      avatar={profile?.user?.avatar || name}
                      shape={'circle'}
                      size={28}
                      title={name}
                    />
                    <Flexbox gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Text ellipsis>{name}</Text>
                      {email && (
                        <Text ellipsis fontSize={12} type={'secondary'}>
                          {email}
                        </Text>
                      )}
                    </Flexbox>
                    {member.role !== 'member' && (
                      <Tag>{member.role.charAt(0).toUpperCase() + member.role.slice(1)}</Tag>
                    )}
                    <ActionIcon
                      aria-label={t('workspace.teams.members.remove')}
                      disabled={!canManage}
                      icon={UserMinus}
                      size={'small'}
                      title={manageTitle || t('workspace.teams.members.remove')}
                      onClick={() => {
                        setRemoveError('');
                        setRemoving(member);
                      }}
                    />
                  </Flexbox>
                );
              })}
            </Flexbox>
          )}
        </Flexbox>

        {adding && (
          <AddTeamMembersModal
            existingUserIds={team.members.map((member) => member.userId)}
            teamName={team.name}
            onCancel={() => setAdding(false)}
            onSubmit={async (userIds) => {
              await onAddMembers(userIds);
              toast.success(t('workspace.teams.members.addSuccess', { count: userIds.length }));
              setAdding(false);
            }}
          />
        )}

        {removing && (
          <Modal
            open
            confirmLoading={removeLoading}
            okButtonProps={{ danger: true }}
            okText={t('workspace.teams.members.remove')}
            title={t('workspace.teams.members.removeConfirm.title')}
            width={420}
            onCancel={() => setRemoving(null)}
            onOk={handleRemove}
          >
            <Flexbox gap={8}>
              <Text>
                {t('workspace.teams.members.removeConfirm.content', {
                  member: getWorkspaceMemberName(profiles.get(removing.userId)) || removing.userId,
                  team: team.name,
                })}
              </Text>
              {removeError && (
                <Text role={'alert'} type={'danger'}>
                  {removeError}
                </Text>
              )}
            </Flexbox>
          </Modal>
        )}
      </Flexbox>
    );
  },
);

WorkspaceTeamDetailView.displayName = 'WorkspaceTeamDetailView';

export default WorkspaceTeamDetailView;
