import { type ChatTopicMetadata } from '@lobechat/types';

import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/**
 * Snapshot the given agent's current model/provider so a newly created topic
 * remembers which model it was started with. Subsequent model switches while the
 * topic is active update this metadata (see `updateTopicMetadata`), and
 * generation reads from it (see `topicSelectors.getTopicModelById`).
 */
export const snapshotAgentModelMetadata = (
  agentId?: string | null,
): Pick<ChatTopicMetadata, 'model' | 'provider'> | undefined => {
  if (!agentId) return undefined;

  const agentState = getAgentStoreState();
  const model = agentByIdSelectors.getAgentModelById(agentId)(agentState);
  if (!model) return undefined;

  return { model, provider: agentByIdSelectors.getAgentModelProviderById(agentId)(agentState) };
};
