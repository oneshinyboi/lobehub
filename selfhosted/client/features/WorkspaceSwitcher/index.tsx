'use client';

import { Avatar, Divider, Flexbox, Icon, List, type ListItem, Text } from '@lobehub/ui';
import { Check, CircleUserRound, Plus } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceAvatar from '@/components/WorkspaceAvatar';

import { useActiveWorkspaceId } from '../../hooks/useActiveWorkspaceId';
import { useIsWorkspaceLoading } from '../../hooks/useIsWorkspaceLoading';
import { useSwitchWorkspace } from '../../hooks/useSwitchWorkspace';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { openCreateWorkspaceModal } from './CreateWorkspaceModal';

const PERSONAL_KEY = '__personal__';
const CREATE_KEY = '__create__';

export interface UserPanelWorkspaceSectionProps {
  /** Called after a switch (or create) starts, so the host popover can close. */
  onSwitch?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
  owner: 'Owner',
  viewer: 'Viewer',
};

/**
 * Workspace switcher in the user panel: personal entry, one row per workspace
 * with the caller's role, and an entry point to create a workspace.
 *
 * The section is not mounted until the panel is signed in, so it renders from
 * first paint and never toggles between `null` and content — the personal and
 * create rows are known before the list resolves, and only the workspace rows
 * fill in afterwards. That keeps the panel from jumping while `workspace.list`
 * is in flight; there is no separate empty/loading skeleton to replace.
 *
 * A caller with zero workspaces still sees the personal row and the create
 * entry — no workspace rows, and no dead end.
 */
const UserPanelWorkspaceSection = memo<UserPanelWorkspaceSectionProps>(({ onSwitch }) => {
  const { t } = useTranslation('common');
  const workspaces = useWorkspaces();
  const activeWorkspaceId = useActiveWorkspaceId();
  const isLoading = useIsWorkspaceLoading();
  const { switchWorkspace, switchToPersonal } = useSwitchWorkspace();

  const workspaceItems = useMemo<ListItem[]>(() => {
    return workspaces.map((workspace) => {
      const role = workspace.role ? (ROLE_LABELS[workspace.role] ?? workspace.role) : null;
      const active = workspace.id === activeWorkspaceId;

      return {
        avatar: <WorkspaceAvatar avatar={workspace.avatar} name={workspace.name} size={32} />,
        // `description` is the List slot that renders below the label in a
        // smaller secondary style, which is where a membership role belongs.
        description: role
          ? t(`workspace.role.${workspace.role}`, { defaultValue: role })
          : undefined,
        extra: active ? <Icon icon={Check} size={16} /> : undefined,
        key: workspace.id,
        label: (
          <Text ellipsis style={{ maxWidth: 180 }}>
            {workspace.name}
          </Text>
        ),
        onClick: () => {
          void switchWorkspace(workspace.id);
          onSwitch?.();
        },
      } satisfies ListItem;
    });
  }, [activeWorkspaceId, onSwitch, switchWorkspace, t, workspaces]);

  const items = useMemo<ListItem[]>(() => {
    const personalItem: ListItem = {
      avatar: <Avatar avatar={<Icon icon={CircleUserRound} size={16} />} size={32} />,
      description: t('workspace.scope.personalHint', { defaultValue: 'Only you' }),
      extra: activeWorkspaceId === null ? <Icon icon={Check} size={16} /> : undefined,
      key: PERSONAL_KEY,
      label: (
        <Text ellipsis style={{ maxWidth: 180 }}>
          {t('workspace.scope.personal', { defaultValue: 'Personal' })}
        </Text>
      ),
      onClick: () => {
        void switchToPersonal();
        onSwitch?.();
      },
    };

    const createItem: ListItem = {
      icon: Plus,
      key: CREATE_KEY,
      label: t('workspace.create.entry', { defaultValue: 'Create workspace' }),
      onClick: () => openCreateWorkspaceModal({ onCreated: onSwitch }),
    };

    // Keep the two always-known rows in place while the list resolves: the
    // section then has a stable height and the menu below never jumps.
    return [personalItem, ...workspaceItems, createItem];
  }, [activeWorkspaceId, onSwitch, switchToPersonal, t, workspaceItems]);

  return (
    <Flexbox paddingBlock={4}>
      <Divider />
      <List
        compact
        activeKey={activeWorkspaceId ?? PERSONAL_KEY}
        aria-busy={isLoading || undefined}
        items={items}
        styles={{ item: { marginInline: 4 } }}
      />
    </Flexbox>
  );
});

UserPanelWorkspaceSection.displayName = 'UserPanelWorkspaceSection';

export default UserPanelWorkspaceSection;
