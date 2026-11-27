import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';

const WORKSPACE_ID_HEADER = 'X-Workspace-Id';

/**
 * Extra headers the business layer contributes to outbound requests.
 *
 * Personal mode adds nothing, so a request without a workspace behaves exactly
 * as it did before workspaces existed (I4). When a workspace is active, its id
 * scopes the request on the server.
 *
 * This runs on every request, including non-tRPC fetches, so it only reads the
 * already-hydrated in-memory store: no network, no storage access, no throw.
 * A store failure must degrade to personal mode, never break the request.
 */
export const getBusinessTrpcHeaders = async (): Promise<Record<string, string>> => {
  try {
    const workspaceId = getActiveWorkspaceId();
    return workspaceId ? { [WORKSPACE_ID_HEADER]: workspaceId } : {};
  } catch {
    return {};
  }
};
