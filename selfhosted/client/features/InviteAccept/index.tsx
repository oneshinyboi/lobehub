'use client';

import { Button, Center, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { TriangleAlert, UserPlus } from 'lucide-react';
import { memo, type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { INVITATION_ERROR } from './errors';
import { type InviteAcceptState, useAcceptInvitation } from './useAcceptInvitation';

const CARD_STYLE = { maxWidth: 440, textAlign: 'center' } as const;

/**
 * Standalone `/invite/:token` surface. It lives outside the main layout
 * because it must work for a signed-out visitor with no workspace context.
 *
 * - Signed out: offer sign-in with this exact link as `callbackUrl`, so the
 *   visitor returns here and the accept can run.
 * - Signed in: redeem the token once, then replace the history entry with the
 *   workspace home so Back does not re-submit the invitation.
 *
 * Every failure keeps distinct copy: an expired link, a revoked one, one that
 * another account already consumed, and one addressed to a different account
 * need different next steps.
 */
const InviteAccept = memo(() => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const isLogin = useUserStore(authSelectors.isLogin);
  const { acceptOnce, state } = useAcceptInvitation(token);

  useEffect(() => {
    if (isLogin !== true) return;

    acceptOnce();
  }, [acceptOnce, isLogin]);

  const invitePath = token ? `/invite/${encodeURIComponent(token)}` : '/invite';
  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(invitePath)}`;

  const renderCard = (
    icon: 'error' | 'invite',
    title: string,
    description: string,
    action?: ReactNode,
  ) => (
    <Center height={'100dvh'} padding={24}>
      <Flexbox align={'center'} gap={16} style={CARD_STYLE}>
        <Icon
          icon={icon === 'error' ? TriangleAlert : UserPlus}
          size={40}
          style={{ color: icon === 'error' ? cssVar.colorWarning : cssVar.colorPrimary }}
        />
        <Text as={'h1'} fontSize={20} weight={600}>
          {title}
        </Text>
        <Text type={'secondary'}>{description}</Text>
        {action}
      </Flexbox>
    </Center>
  );

  if (!token) {
    return renderCard(
      'error',
      t('inviteAccept.error.invalid.title', { defaultValue: 'This invitation link is not valid' }),
      t('inviteAccept.error.invalid.description', {
        defaultValue:
          'Check that you copied the whole link, or ask the workspace owner to send it again.',
      }),
      <Button type={'primary'} onClick={() => navigate('/')}>
        {t('inviteAccept.action.home', { defaultValue: 'Back to home' })}
      </Button>,
    );
  }

  // The user store settles after boot; wait instead of flashing the signed-out
  // card at a signed-in visitor.
  if (isLogin === undefined) return <Loading debugId={'InviteAccept'} />;

  if (isLogin === false) {
    return renderCard(
      'invite',
      t('inviteAccept.signIn.title', { defaultValue: 'You have been invited' }),
      t('inviteAccept.signIn.description', {
        defaultValue: 'Sign in or create an account to accept this workspace invitation.',
      }),
      <Button href={signInUrl} size={'large'} type={'primary'}>
        {t('inviteAccept.signIn.action', { defaultValue: 'Sign in to accept' })}
      </Button>,
    );
  }

  if (state.status === 'error') {
    const copy = errorCopy(state, (key, defaultValue) => t(key, { defaultValue }));

    return renderCard(
      'error',
      copy.title,
      copy.description,
      <Flexbox gap={8} style={{ width: '100%' }}>
        <Button type={'primary'} onClick={() => window.location.reload()}>
          {t('inviteAccept.action.retry', { defaultValue: 'Try again' })}
        </Button>
        <Button type={'text'} onClick={() => navigate('/')}>
          {t('inviteAccept.action.home', { defaultValue: 'Back to home' })}
        </Button>
      </Flexbox>,
    );
  }

  return renderCard(
    'invite',
    state.status === 'success'
      ? t('inviteAccept.success.title', { defaultValue: 'You have joined the workspace' })
      : t('inviteAccept.accepting.title', { defaultValue: 'Accepting your invitation…' }),
    state.status === 'success'
      ? t('inviteAccept.success.description', {
          defaultValue: 'Taking you to the workspace now.',
        })
      : t('inviteAccept.accepting.description', {
          defaultValue: 'This only takes a moment.',
        }),
  );
});

InviteAccept.displayName = 'InviteAccept';

type Translate = (key: string, defaultValue: string) => string;

/**
 * Copy for each refusal. The distinctions are the point of the surface, so
 * they are kept together instead of being buried in a ternary chain.
 */
const errorCopy = (
  state: InviteAcceptState,
  tr: Translate,
): { description: string; title: string } => {
  switch (state.code) {
    case INVITATION_ERROR.EXPIRED: {
      return {
        description: tr(
          'inviteAccept.error.expired.description',
          'Ask the workspace owner or an admin for a new invitation link.',
        ),
        title: tr('inviteAccept.error.expired.title', 'This invitation has expired'),
      };
    }
    case INVITATION_ERROR.REVOKED: {
      return {
        description: tr(
          'inviteAccept.error.revoked.description',
          'An owner or admin cancelled this link. Ask them for a new invitation.',
        ),
        title: tr('inviteAccept.error.revoked.title', 'This invitation was revoked'),
      };
    }
    case INVITATION_ERROR.USED: {
      return {
        description: tr(
          'inviteAccept.error.used.description',
          'This was a single-use link. Ask the workspace owner to send a new invitation.',
        ),
        title: tr('inviteAccept.error.used.title', 'This invitation has already been used'),
      };
    }
    case INVITATION_ERROR.WRONG_ACCOUNT: {
      return {
        description: tr(
          'inviteAccept.error.wrongAccount.description',
          'Sign out and open this link again with the account the invitation was addressed to.',
        ),
        title: tr(
          'inviteAccept.error.wrongAccount.title',
          'This invitation is for a different account',
        ),
      };
    }
    case INVITATION_ERROR.NOT_FOUND: {
      return {
        description: tr(
          'inviteAccept.error.invalid.description',
          'Check that you copied the whole link, or ask the workspace owner to send it again.',
        ),
        title: tr('inviteAccept.error.invalid.title', 'This invitation link is not valid'),
      };
    }
    default: {
      return {
        description: tr(
          'inviteAccept.error.unknown.description',
          'Something went wrong while accepting the invitation. Try again, or ask for a new link.',
        ),
        title: tr('inviteAccept.error.unknown.title', 'We could not accept this invitation'),
      };
    }
  }
};

export default InviteAccept;
