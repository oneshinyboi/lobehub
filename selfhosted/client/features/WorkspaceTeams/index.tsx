'use client';

import type { WorkspaceTeamItem } from '@lobechat/database/schemas';
import {
  ActionIcon,
  Avatar,
  Button,
  Empty,
  Flexbox,
  SearchBar,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import dayjs from 'dayjs';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { createWorkspaceLambdaClient } from '@/libs/trpc/client';

import DeleteTeamModal from './DeleteTeamModal';
import TeamFormModal from './TeamFormModal';
import type { TeamFormValues, WorkspaceTeamSummary } from './types';
import { useWorkspaceTeamDetail, useWorkspaceTeamList } from './useWorkspaceTeams';
import WorkspaceTeamDetailView from './WorkspaceTeamDetail';

const NAME_COL_WIDTH = { flex: 1, minWidth: 0 } as const;
const MEMBERS_COL_WIDTH = 92;
const CREATED_COL_WIDTH = 110;
const ACTIONS_COL_WIDTH = 72;

const rowHoverStyle = {
  backgroundColor: 'transparent',
  borderRadius: cssVar.borderRadius,
  cursor: 'pointer',
  transition: 'background 0.15s ease',
} as const;

interface TeamRowProps {
  blockedReason?: string;
  canManage: boolean;
  onDelete: (team: WorkspaceTeamSummary) => void;
  onEdit: (team: WorkspaceTeamSummary) => void;
  onOpen: (team: WorkspaceTeamSummary) => void;
  team: WorkspaceTeamSummary;
}

const TeamRow = memo<TeamRowProps>(
  ({ blockedReason, canManage, onDelete, onEdit, onOpen, team }) => {
    const { t } = useTranslation('setting');
    const manageTitle = canManage ? undefined : blockedReason;

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={12}
        role={'button'}
        style={rowHoverStyle}
        tabIndex={0}
        onClick={() => onOpen(team)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(team);
          }
        }}
      >
        <Flexbox horizontal align={'center'} gap={10} style={NAME_COL_WIDTH}>
          <Avatar avatar={team.avatar || team.name} shape={'square'} size={28} title={team.name} />
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {team.name}
            </Text>
            <Tag>{team.identifier}</Tag>
          </Flexbox>
        </Flexbox>
        <Text
          fontSize={12}
          style={{ flex: 'none', textAlign: 'end', width: MEMBERS_COL_WIDTH }}
          type={'secondary'}
        >
          {t('workspace.teams.members.description', { count: team.memberCount })}
        </Text>
        <Text
          fontSize={12}
          style={{ flex: 'none', textAlign: 'end', width: CREATED_COL_WIDTH }}
          type={'secondary'}
        >
          {dayjs(team.createdAt).format('YYYY-MM-DD')}
        </Text>
        <Flexbox
          horizontal
          align={'center'}
          gap={4}
          justify={'flex-end'}
          style={{ flex: 'none', width: ACTIONS_COL_WIDTH }}
          onClick={(event) => event.stopPropagation()}
        >
          <ActionIcon
            aria-label={t('edit', { ns: 'common' })}
            disabled={!canManage}
            icon={Pencil}
            size={'small'}
            title={manageTitle}
            onClick={() => onEdit(team)}
          />
          <ActionIcon
            aria-label={t('workspace.teams.delete.button')}
            disabled={!canManage}
            icon={Trash2}
            size={'small'}
            title={manageTitle}
            onClick={() => onDelete(team)}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

TeamRow.displayName = 'WorkspaceTeamRow';

const TeamTableHeader = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox horizontal align={'center'} gap={12} paddingInline={4} style={{ paddingBlock: 4 }}>
      <Text fontSize={12} style={NAME_COL_WIDTH} type={'secondary'}>
        {t('workspace.teams.columns.name')}
      </Text>
      <Text
        fontSize={12}
        style={{ flex: 'none', textAlign: 'end', width: MEMBERS_COL_WIDTH }}
        type={'secondary'}
      >
        {t('workspace.teams.columns.members')}
      </Text>
      <Text
        fontSize={12}
        style={{ flex: 'none', textAlign: 'end', width: CREATED_COL_WIDTH }}
        type={'secondary'}
      >
        {t('workspace.teams.columns.createdAt')}
      </Text>
      <span style={{ flex: 'none', width: ACTIONS_COL_WIDTH }} />
    </Flexbox>
  );
});

TeamTableHeader.displayName = 'WorkspaceTeamTableHeader';

type FormState = { mode: 'create' } | { mode: 'edit'; team: WorkspaceTeamItem };

/**
 * Workspace Settings → Teams. One component serves both routes: without a
 * `teamId` it renders the team list, with one it renders that team's detail.
 * Reads are open to every workspace member; every write control is gated on
 * `manage_settings` (admin/owner) while the server enforces the same rule.
 */
const WorkspaceTeams = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { teamId } = useParams<{ teamId?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const workspaceId = useActiveWorkspaceId();
  const workspaceMembers = useWorkspaceMembers();
  const { allowed: canManage, reason: blockedReason } = usePermission('manage_settings');

  const {
    error: listError,
    isLoading: listLoading,
    refresh: refreshList,
    teams,
  } = useWorkspaceTeamList(workspaceId);
  const {
    error: detailError,
    isLoading: detailLoading,
    refresh: refreshDetail,
    team,
  } = useWorkspaceTeamDetail(workspaceId, teamId);

  const [query, setQuery] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceTeamItem | null>(null);

  const filteredTeams = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return teams;

    return teams.filter(
      (item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.identifier.toLowerCase().includes(keyword),
    );
  }, [query, teams]);

  const client = () => {
    if (!workspaceId) throw new Error('A workspace is required to manage teams');

    return createWorkspaceLambdaClient(workspaceId);
  };

  const handleCreate = async (values: TeamFormValues) => {
    const created = await client().workspaceTeam.create.mutate(values);
    toast.success(t('workspace.teams.create.success'));
    setForm(null);
    await refreshList();
    navigate(`/settings/teams/${created.id}`);
  };

  const handleUpdate = async (values: TeamFormValues) => {
    if (!form || form.mode !== 'edit') return;

    await client().workspaceTeam.update.mutate({ id: form.team.id, ...values });
    toast.success(t('workspace.teams.general.saveSuccess'));
    setForm(null);
    await Promise.all([
      refreshList(),
      teamId === form.team.id ? refreshDetail() : Promise.resolve(),
    ]);
  };

  const handleDelete = async () => {
    if (!deleting) return;

    const deletedId = deleting.id;
    await client().workspaceTeam.delete.mutate({ id: deletedId });
    toast.success(t('workspace.teams.delete.success'));
    setDeleting(null);
    await refreshList();
    if (teamId === deletedId) navigate('/settings/teams');
  };

  const handleAddMembers = async (userIds: string[]) => {
    if (!team) return;

    await client().workspaceTeam.addMembers.mutate({ id: team.id, userIds });
    await Promise.all([refreshDetail(), refreshList()]);
  };

  const handleRemoveMember = async (userId: string) => {
    if (!team) return;

    await client().workspaceTeam.removeMember.mutate({ id: team.id, userId });
    await Promise.all([refreshDetail(), refreshList()]);
  };

  const openTeam = (target: WorkspaceTeamItem) => navigate(`/settings/teams/${target.id}`);

  const renderList = () => {
    if (listLoading) return <SkeletonList rows={4} />;

    if (listError) {
      return (
        <Empty description={t('workspace.teams.errors.generic')} style={{ paddingBlock: 40 }} />
      );
    }

    if (teams.length === 0) {
      return <Empty description={t('workspace.teams.empty')} style={{ paddingBlock: 40 }} />;
    }

    if (filteredTeams.length === 0) {
      return <Empty description={t('workspace.teams.noMatch')} style={{ paddingBlock: 40 }} />;
    }

    return (
      <Flexbox gap={2}>
        <TeamTableHeader />
        {filteredTeams.map((item) => (
          <TeamRow
            blockedReason={blockedReason}
            canManage={canManage}
            key={item.id}
            team={item}
            onDelete={setDeleting}
            onEdit={(target) => setForm({ mode: 'edit', team: target })}
            onOpen={openTeam}
          />
        ))}
      </Flexbox>
    );
  };

  const createButton = (
    <Button
      disabled={!canManage}
      icon={Plus}
      title={canManage ? undefined : blockedReason}
      type={'primary'}
      onClick={() => setForm({ mode: 'create' })}
    >
      {t('workspace.teams.create.button')}
    </Button>
  );

  return (
    <Flexbox gap={16}>
      {teamId ? (
        detailLoading ? (
          <SkeletonList rows={4} />
        ) : detailError || !team ? (
          <Flexbox gap={12} style={{ paddingBlock: 40 }}>
            <Empty description={t('workspace.teams.notFound')} />
            <Flexbox justify={'center'}>
              <Button onClick={() => navigate('/settings/teams')}>
                {t('workspace.teams.backToList')}
              </Button>
            </Flexbox>
          </Flexbox>
        ) : (
          <WorkspaceTeamDetailView
            blockedReason={blockedReason}
            canManage={canManage}
            team={team}
            workspaceMembers={workspaceMembers}
            onAddMembers={handleAddMembers}
            onBack={() => navigate('/settings/teams')}
            onDelete={() => setDeleting(team)}
            onEdit={() => setForm({ mode: 'edit', team })}
            onRemoveMember={handleRemoveMember}
          />
        )
      ) : (
        <>
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <SearchBar
              allowClear
              placeholder={t('workspace.teams.searchPlaceholder')}
              style={{ maxWidth: 280 }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {createButton}
          </Flexbox>
          {renderList()}
        </>
      )}

      {form && (
        <TeamFormModal
          team={form.mode === 'edit' ? form.team : undefined}
          onCancel={() => setForm(null)}
          onSubmit={form.mode === 'edit' ? handleUpdate : handleCreate}
        />
      )}

      {deleting && (
        <DeleteTeamModal
          team={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </Flexbox>
  );
});

WorkspaceTeams.displayName = 'WorkspaceTeams';

export default WorkspaceTeams;
