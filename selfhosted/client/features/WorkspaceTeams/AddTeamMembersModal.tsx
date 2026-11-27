'use client';

import { Avatar, Checkbox, Empty, Flexbox, Modal, SearchBar, Text } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';

import { getWorkspaceMemberEmail, getWorkspaceMemberName } from './memberDisplay';
import { isTeamApiError, TEAM_MEMBER_NOT_IN_WORKSPACE } from './types';

interface AddTeamMembersModalProps {
  existingUserIds: string[];
  onCancel: () => void;
  onSubmit: (userIds: string[]) => Promise<void>;
  teamName: string;
}

/**
 * Picks new team members from the active workspace's directory only. The
 * candidates exclude current team members, and the server repeats the
 * workspace-membership filter before writing, so this list is a convenience
 * rather than the authority.
 */
const AddTeamMembersModal = memo<AddTeamMembersModalProps>(
  ({ existingUserIds, onCancel, onSubmit, teamName }) => {
    const { t } = useTranslation(['setting', 'common']);
    const members = useWorkspaceMembers();

    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    const existing = useMemo(() => new Set(existingUserIds), [existingUserIds]);

    const candidates = useMemo(() => {
      const keyword = query.trim().toLowerCase();

      return members.filter((member) => {
        if (member.deletedAt || existing.has(member.userId)) return false;
        if (!keyword) return true;

        const name = getWorkspaceMemberName(member).toLowerCase();
        const email = getWorkspaceMemberEmail(member)?.toLowerCase() ?? '';
        return name.includes(keyword) || email.includes(keyword) || member.userId.includes(keyword);
      });
    }, [existing, members, query]);

    const toggle = (userId: string) => {
      setSelected((current) =>
        current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
      );
      setSubmitError('');
    };

    const handleSubmit = async () => {
      if (selected.length === 0 || submitting) return;

      setSubmitting(true);
      setSubmitError('');
      try {
        await onSubmit(selected);
      } catch (error) {
        setSubmitError(
          isTeamApiError(error, TEAM_MEMBER_NOT_IN_WORKSPACE)
            ? t('workspace.teams.errors.notWorkspaceMember')
            : t('workspace.teams.errors.generic'),
        );
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <Modal
        open
        confirmLoading={submitting}
        okButtonProps={{ disabled: selected.length === 0 }}
        okText={t('workspace.teams.members.addSubmit')}
        title={t('workspace.teams.members.addTitle', { name: teamName })}
        width={460}
        onCancel={onCancel}
        onOk={handleSubmit}
      >
        <Flexbox gap={12}>
          <SearchBar
            allowClear
            placeholder={t('workspace.teams.members.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {candidates.length === 0 ? (
            <Empty
              description={t('workspace.teams.members.noCandidates')}
              style={{ paddingBlock: 24 }}
            />
          ) : (
            <Flexbox gap={2} style={{ maxHeight: 320, overflowY: 'auto' }}>
              {candidates.map((member) => {
                const checked = selected.includes(member.userId);
                const name = getWorkspaceMemberName(member);
                const email = getWorkspaceMemberEmail(member);

                return (
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={10}
                    key={member.userId}
                    role={'button'}
                    tabIndex={0}
                    style={{
                      borderRadius: 8,
                      cursor: 'pointer',
                      paddingBlock: 8,
                      paddingInline: 8,
                    }}
                    onClick={() => toggle(member.userId)}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={() => toggle(member.userId)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <Avatar
                      avatar={member.user?.avatar || name}
                      shape={'circle'}
                      size={28}
                      title={name}
                    />
                    <Flexbox gap={0} style={{ minWidth: 0 }}>
                      <Text ellipsis>{name}</Text>
                      {email && (
                        <Text ellipsis fontSize={12} type={'secondary'}>
                          {email}
                        </Text>
                      )}
                    </Flexbox>
                  </Flexbox>
                );
              })}
            </Flexbox>
          )}

          {submitError && (
            <Text role={'alert'} type={'danger'}>
              {submitError}
            </Text>
          )}
        </Flexbox>
      </Modal>
    );
  },
);

AddTeamMembersModal.displayName = 'AddTeamMembersModal';

export default AddTeamMembersModal;
