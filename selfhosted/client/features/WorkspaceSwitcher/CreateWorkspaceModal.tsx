'use client';

import { WORKSPACE_SLUG_MAX, WORKSPACE_SLUG_MIN } from '@lobechat/const';
import type { WorkspaceItem } from '@lobechat/database/schemas';
import {
  Button,
  createModal,
  cssVar,
  Flexbox,
  Icon,
  Input,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { lambdaClient } from '@/libs/trpc/client';

import { persistActiveWorkspaceId, useWorkspaceStore } from '../../store/workspace';
import { deriveWorkspaceSlug, isValidWorkspaceSlug, normalizeSlugInput } from './slug';

/** Long enough to keep typing from firing a request per keystroke. */
const AVAILABILITY_DEBOUNCE_MS = 350;

type Availability = 'available' | 'checking' | 'error' | 'idle' | 'taken';

export interface CreateWorkspaceModalProps {
  /** Called after the workspace is created and the caller has been switched into it. */
  onCreated?: () => void;
}

const TAKEN_SLUG_MESSAGE = 'Workspace slug is already taken';

/**
 * `name → derived slug (editable) → live availability → create → switch`.
 *
 * The created workspace is seeded into the workspace store before navigation:
 * `useWorkspaceUrlSync` resolves `/:slug` against that list, so a list fetched
 * before the create would otherwise show the workspace-not-found boundary for
 * one the caller has just made. The row is seeded with `role: 'owner'` — the
 * server inserts that membership in the same transaction, and the next list
 * fetch confirms it.
 */
const CreateWorkspaceModal = memo<CreateWorkspaceModalProps>(({ onCreated }) => {
  const { close } = useModalContext();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  // `null` means "follow the name"; a string is the user's explicit choice.
  const [slugOverride, setSlugOverride] = useState<null | string>(null);
  const [checkResult, setCheckResult] = useState<null | {
    slug: string;
    status: 'available' | 'error' | 'taken';
  }>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<null | string>(null);

  const slug = slugOverride ?? deriveWorkspaceSlug(name);
  const slugReady = isValidWorkspaceSlug(slug);
  // `checking` is derived, so changing the slug starts a fresh check without
  // an effect writing state during render.
  const availability: Availability = !slugReady
    ? 'idle'
    : checkResult?.slug === slug
      ? checkResult.status
      : 'checking';

  useEffect(() => {
    if (!slugReady) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { available } = await lambdaClient.workspace.checkSlugAvailable.query({ slug });
        if (!cancelled) setCheckResult({ slug, status: available ? 'available' : 'taken' });
      } catch {
        if (!cancelled) setCheckResult({ slug, status: 'error' });
      }
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, slugReady]);

  const handleCreate = useCallback(async () => {
    if (creating || !slugReady || availability !== 'available') return;

    setCreating(true);
    setCreateError(null);

    try {
      const workspace: WorkspaceItem = await lambdaClient.workspace.create.mutate({
        name: name.trim(),
        slug,
      });

      const store = useWorkspaceStore.getState();
      store.applyWorkspaces([
        ...store.workspaces.filter((item) => item.id !== workspace.id),
        { ...workspace, role: 'owner' },
      ]);
      store.setActiveWorkspaceId(workspace.id);
      persistActiveWorkspaceId(workspace.id);

      close();
      onCreated?.();
      navigate(`/${workspace.slug}`);
    } catch (error) {
      const taken = error instanceof TRPCClientError && error.message.includes(TAKEN_SLUG_MESSAGE);
      if (taken) setCheckResult({ slug, status: 'taken' });
      else
        setCreateError(
          t('workspace.create.error', {
            defaultValue: 'Could not create the workspace. Please try again.',
          }),
        );
      setCreating(false);
    }
  }, [availability, close, creating, name, navigate, onCreated, slug, slugReady]);

  const canCreate = Boolean(name.trim()) && slugReady && availability === 'available' && !creating;

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('workspace.create.nameLabel', { defaultValue: 'Name' })}
        </Text>
        <Input
          autoFocus
          maxLength={255}
          value={name}
          placeholder={t('workspace.create.namePlaceholder', {
            defaultValue: 'e.g. Design team',
          })}
          onChange={(event) => setName(event.target.value)}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('workspace.create.slugLabel', { defaultValue: 'Workspace URL' })}
        </Text>
        <Input
          placeholder={t('workspace.create.slugPlaceholder', { defaultValue: 'design-team' })}
          prefix={'/'}
          value={slug}
          onChange={(event) => {
            setCreateError(null);
            setSlugOverride(normalizeSlugInput(event.target.value));
          }}
        />
        <SlugStatus availability={availability} slug={slug} slugReady={slugReady} />
      </Flexbox>

      {createError && (
        <Text fontSize={12} style={{ color: cssVar.colorError }}>
          {createError}
        </Text>
      )}

      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={creating} onClick={() => close()}>
          {t('workspace.create.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          disabled={!canCreate}
          loading={creating}
          type={'primary'}
          onClick={() => void handleCreate()}
        >
          {t('workspace.create.submit', { defaultValue: 'Create workspace' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateWorkspaceModal.displayName = 'CreateWorkspaceModal';

const SlugStatus = memo<{
  availability: Availability;
  slug: string;
  slugReady: boolean;
}>(({ availability, slug, slugReady }) => {
  if (!slug) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('workspace.create.slugHint', {
          defaultValue: 'Lowercase letters, numbers and hyphens.',
        })}
      </Text>
    );
  }

  if (!slugReady) {
    return (
      <Text fontSize={12} style={{ color: cssVar.colorWarning }}>
        {t('workspace.create.slugInvalid', {
          defaultValue: 'Use {{min}}–{{max}} lowercase letters, numbers or hyphens.',
          min: WORKSPACE_SLUG_MIN,
          max: WORKSPACE_SLUG_MAX,
        })}
      </Text>
    );
  }

  if (availability === 'checking') {
    return (
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon spin icon={LoaderCircle} size={12} />
        <Text fontSize={12} type={'secondary'}>
          {t('workspace.create.slugChecking', { defaultValue: 'Checking availability…' })}
        </Text>
      </Flexbox>
    );
  }

  if (availability === 'taken') {
    return (
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon icon={CircleAlert} size={12} style={{ color: cssVar.colorError }} />
        <Text fontSize={12} style={{ color: cssVar.colorError }}>
          {t('workspace.create.slugTaken', {
            defaultValue: 'This URL is already taken.',
          })}
        </Text>
      </Flexbox>
    );
  }

  if (availability === 'error') {
    return (
      <Text fontSize={12} style={{ color: cssVar.colorWarning }}>
        {t('workspace.create.slugCheckFailed', {
          defaultValue: 'Could not check availability. Keep typing to retry.',
        })}
      </Text>
    );
  }

  if (availability === 'available') {
    return (
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon icon={CircleCheck} size={12} style={{ color: cssVar.colorSuccess }} />
        <Text fontSize={12} style={{ color: cssVar.colorSuccess }}>
          {t('workspace.create.slugAvailable', { defaultValue: 'This URL is available.' })}
        </Text>
      </Flexbox>
    );
  }

  return null;
});

SlugStatus.displayName = 'WorkspaceSlugStatus';

export const openCreateWorkspaceModal = (props: CreateWorkspaceModalProps = {}): ModalInstance =>
  createModal({
    content: <CreateWorkspaceModal {...props} />,
    footer: null,
    maskClosable: true,
    title: t('workspace.create.title', { defaultValue: 'Create workspace' }),
    width: 'min(90vw, 480px)',
  });

export default CreateWorkspaceModal;
