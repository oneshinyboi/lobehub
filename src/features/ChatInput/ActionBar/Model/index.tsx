import { ModelIcon } from '@lobehub/icons';
import { Center, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback } from 'react';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { usePermission } from '@/hooks/usePermission';

import { useAgentId } from '../../hooks/useAgentId';
import { useTopicScopedModel } from '../../hooks/useTopicScopedModel';
import { useActionBarContext } from '../context';

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    transition: scale 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
  `,
  modelDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    :hover {
      background: transparent;
    }

    :active {
      div {
        scale: 1;
      }
    }
  `,
  model: css`
    cursor: pointer;
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillSecondary};
    }

    :active {
      div {
        scale: 0.8;
      }
    }
  `,
}));

const ModelSwitch = memo(() => {
  const { actionSize, dropdownPlacement } = useActionBarContext();
  const blockSize = actionSize?.blockSize ?? 32;
  const iconSize = actionSize?.size ?? 20;
  const { allowed: canCreateContent, reason } = usePermission('create_content');

  const agentId = useAgentId();
  const { model, provider, switchModel } = useTopicScopedModel(agentId);

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canCreateContent) return;

      await switchModel(params);
    },
    [canCreateContent, switchModel],
  );

  const trigger = (
    <Center
      className={cx(styles.model, !canCreateContent && styles.modelDisabled)}
      height={blockSize}
      width={blockSize}
    >
      <div className={styles.icon}>
        <ModelIcon model={model} size={iconSize} />
      </div>
    </Center>
  );

  if (!canCreateContent)
    return (
      <Tooltip title={reason}>
        <div>{trigger}</div>
      </Tooltip>
    );

  return (
    <ModelSwitchPanel
      model={model}
      placement={dropdownPlacement}
      provider={provider}
      onModelChange={handleModelChange}
    >
      {trigger}
    </ModelSwitchPanel>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default ModelSwitch;
