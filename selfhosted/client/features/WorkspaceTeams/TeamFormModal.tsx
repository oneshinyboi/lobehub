'use client';

import type { WorkspaceTeamItem } from '@lobechat/database/schemas';
import { Flexbox, Input, Modal, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DUPLICATE_TEAM_IDENTIFIER,
  isTeamApiError,
  TEAM_IDENTIFIER_PATTERN,
  type TeamFormValues,
} from './types';

interface TeamFormModalProps {
  onCancel: () => void;
  onSubmit: (values: TeamFormValues) => Promise<void>;
  /** Present when editing; absent when creating. */
  team?: WorkspaceTeamItem;
}

/**
 * Create/edit form for a team. The server normalizes and validates identifiers,
 * but the form keeps an invalid value from being sent at all, and renders a
 * taken identifier next to the field the user must change.
 */
const TeamFormModal = memo<TeamFormModalProps>(({ onCancel, onSubmit, team }) => {
  const { t } = useTranslation(['setting', 'common']);

  const [name, setName] = useState(team?.name ?? '');
  const [identifier, setIdentifier] = useState(team?.identifier ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [identifierError, setIdentifierError] = useState('');
  const [submitError, setSubmitError] = useState('');

  const trimmedName = name.trim();
  const trimmedIdentifier = identifier.trim();
  const identifierInvalid =
    trimmedIdentifier.length > 0 && !TEAM_IDENTIFIER_PATTERN.test(trimmedIdentifier);

  const handleSubmit = async () => {
    if (!trimmedName || identifierInvalid || submitting) return;

    setIdentifierError('');
    setSubmitError('');
    setSubmitting(true);
    try {
      await onSubmit({
        description: description.trim() || undefined,
        identifier: trimmedIdentifier || undefined,
        name: trimmedName,
      });
    } catch (error) {
      if (isTeamApiError(error, DUPLICATE_TEAM_IDENTIFIER)) {
        setIdentifierError(t('workspace.teams.errors.identifierTaken'));
      } else {
        setSubmitError(t('workspace.teams.errors.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      confirmLoading={submitting}
      okButtonProps={{ disabled: !trimmedName || identifierInvalid }}
      okText={team ? t('save', { ns: 'common' }) : t('workspace.teams.create.submit')}
      title={team ? t('workspace.teams.general.title') : t('workspace.teams.create.title')}
      width={480}
      onCancel={onCancel}
      onOk={handleSubmit}
    >
      <Flexbox gap={16}>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('workspace.teams.fields.name')}
          </Text>
          <Input
            autoFocus
            maxLength={255}
            placeholder={t('workspace.teams.fields.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Flexbox>

        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('workspace.teams.fields.identifier')}
          </Text>
          <Input
            aria-invalid={identifierInvalid || Boolean(identifierError)}
            maxLength={7}
            placeholder={t('workspace.teams.fields.identifierPlaceholder')}
            style={identifierInvalid || identifierError ? { borderColor: cssVar.colorError } : {}}
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
              setIdentifierError('');
            }}
          />
          <Text fontSize={12} type={'secondary'}>
            {t('workspace.teams.fields.identifierHint')}
          </Text>
          {(identifierInvalid || identifierError) && (
            <Text fontSize={12} type={'danger'}>
              {identifierInvalid ? t('workspace.teams.errors.identifierInvalid') : identifierError}
            </Text>
          )}
        </Flexbox>

        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('workspace.teams.fields.description')}
          </Text>
          <TextArea
            maxLength={1000}
            placeholder={t('workspace.teams.fields.descriptionPlaceholder')}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Text fontSize={12} type={'secondary'}>
            {t('workspace.teams.fields.descriptionHint')}
          </Text>
        </Flexbox>

        {submitError && (
          <Text role={'alert'} type={'danger'}>
            {submitError}
          </Text>
        )}
      </Flexbox>
    </Modal>
  );
});

TeamFormModal.displayName = 'WorkspaceTeamFormModal';

export default TeamFormModal;
