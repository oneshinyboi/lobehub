'use client';

import type { WorkspaceTeamItem } from '@lobechat/database/schemas';
import { Flexbox, Modal, Text } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface DeleteTeamModalProps {
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  team: WorkspaceTeamItem;
}

/** Destructive confirm; the warning names the team so a mis-click is recoverable. */
const DeleteTeamModal = memo<DeleteTeamModalProps>(({ onCancel, onConfirm, team }) => {
  const { t } = useTranslation(['setting', 'common']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (loading) return;

    setLoading(true);
    setError('');
    try {
      await onConfirm();
    } catch {
      setError(t('workspace.teams.errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      confirmLoading={loading}
      okButtonProps={{ danger: true }}
      okText={t('workspace.teams.delete.confirm.ok')}
      title={t('workspace.teams.delete.confirm.title')}
      width={440}
      onCancel={onCancel}
      onOk={handleConfirm}
    >
      <Flexbox gap={8}>
        <Text>{t('workspace.teams.delete.confirm.content', { name: team.name })}</Text>
        {error && (
          <Text role={'alert'} type={'danger'}>
            {error}
          </Text>
        )}
      </Flexbox>
    </Modal>
  );
});

DeleteTeamModal.displayName = 'DeleteTeamModal';

export default DeleteTeamModal;
