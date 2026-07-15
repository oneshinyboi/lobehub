import { SendButton as Send } from '@lobehub/editor/react';
import { Tooltip } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import { selectors, useChatInputStore } from '../store';

const SendButton = memo(() => {
  const { t } = useTranslation('setting');
  const sendMenu = useChatInputStore((s) => s.sendMenu);
  const shape = useChatInputStore((s) => s.sendButtonProps?.shape);
  const size = useChatInputStore((s) => s.sendButtonProps?.size);
  const { generating, disabled } = useChatInputStore(selectors.sendButtonProps, isEqual);
  const [send, handleStop] = useChatInputStore((s) => [s.handleSendButton, s.handleStop]);

  // Workspace viewer doesn't have `message:create` → backend would 403.
  // OR the permission gate into the existing disabled prop so the button
  // visibly grays out and a tooltip explains why.
  const { allowed: canCreate, reason } = usePermission('create_content');

  // Per-resource General-access gating: a workspace member with view-only
  // access on the active agent (or group) can read the conversation but the
  // server rejects sends. Only gate when the input is bound to a resolvable
  // workspace resource — home/new-conversation inputs (no explicit agentId)
  // and personal resources stay untouched.
  const chatInputAgentId = useChatInputStore((s) => s.agentId);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentVisibility = useAgentStore((s) =>
    chatInputAgentId ? s.agentMap[chatInputAgentId]?.visibility : undefined,
  );
  // Group conversations reuse the supervisor's agentId as the input context
  // (see useGroupContext), so a supervisor match means "this input sends to
  // the group" — gate on the group's access level instead of the agent's.
  const activeGroup = useAgentGroupStore((s) =>
    s.activeGroupId ? agentGroupSelectors.getGroupById(s.activeGroupId)(s) : undefined,
  );
  const isGroupContext =
    !!chatInputAgentId && !!activeGroup && activeGroup.supervisorAgentId === chatInputAgentId;

  const gatedResourceId = isGroupContext
    ? activeGroup.visibility === 'private'
      ? undefined
      : activeGroup.id
    : chatInputAgentId && chatInputAgentId !== inboxAgentId && agentVisibility !== 'private'
      ? chatInputAgentId
      : undefined;
  const { canUseResource } = useResourceAccess(
    isGroupContext ? 'agentGroup' : 'agent',
    gatedResourceId,
  );
  const viewOnly = !canUseResource;
  const canSend = canCreate && !viewOnly;

  const button = (
    <Send
      disabled={disabled || !canSend}
      generating={generating}
      menu={canSend ? (sendMenu as any) : undefined}
      placement={'topRight'}
      shape={shape}
      size={size}
      trigger={['hover']}
      onClick={generating || !canSend ? undefined : () => send()}
      onStop={() => handleStop()}
    />
  );

  if (!canCreate) return <Tooltip title={reason}>{button}</Tooltip>;
  if (viewOnly) return <Tooltip title={t('permission.viewOnlySendTip')}>{button}</Tooltip>;
  return button;
});

SendButton.displayName = 'SendButton';

export default SendButton;
