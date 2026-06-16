'use client';

import { useCallback } from 'react';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

interface ModelAndProvider {
  model: string;
  provider: string;
}

/**
 * Topic-scoped model resolution + switching for ChatInput.
 *
 * - `model`/`provider`: the effective model — the active topic's pinned model
 *   when one exists, otherwise the agent default.
 * - `switchModel`: while a topic is active, pins the chosen model to that topic
 *   (so each topic remembers its own model); otherwise updates the agent default
 *   (which seeds the model of the next topic created from this conversation).
 */
export const useTopicScopedModel = (agentId: string) => {
  const [agentModel, agentProvider, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    s.updateAgentConfigById,
  ]);

  const [activeTopicId, topicModel, updateTopicMetadata] = useChatStore((s) => [
    s.activeTopicId,
    topicSelectors.activeTopicModel(s),
    s.updateTopicMetadata,
  ]);

  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const model = topicModel?.model || agentModel;
  const provider = topicModel?.model ? topicModel.provider : agentProvider;

  const switchModel = useCallback(
    async (params: ModelAndProvider) => {
      const config = applyBusinessModelModeConfig(params);

      // While a topic is active, pin the model to that topic instead of the
      // agent default, so each topic keeps its own model.
      if (activeTopicId) {
        await updateTopicMetadata(activeTopicId, {
          model: config.model,
          provider: config.provider,
        });
        return;
      }

      await updateAgentConfigById(agentId, config);
    },
    [
      activeTopicId,
      agentId,
      applyBusinessModelModeConfig,
      updateAgentConfigById,
      updateTopicMetadata,
    ],
  );

  return { model, provider, switchModel };
};
