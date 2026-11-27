'use client';

import { TRPCClientError } from '@trpc/client';
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { lambdaClient } from '@/libs/trpc/client';

import { persistActiveWorkspaceId, useWorkspaceStore } from '../../store/workspace';
import { type InvitationErrorCode, isInvitationErrorCode } from './errors';

export type InviteAcceptStatus = 'accepting' | 'error' | 'idle' | 'success';

export interface InviteAcceptState {
  /** Machine-readable reason when `status === 'error'`. */
  code?: InvitationErrorCode | 'UNKNOWN';
  /** Workspace slug to land on once the membership exists. */
  slug?: string;
  status: InviteAcceptStatus;
}

const toErrorCode = (error: unknown): InvitationErrorCode | 'UNKNOWN' => {
  // The server sends the stable reason as the tRPC message; anything else is a
  // transport or database failure and gets the generic retry copy.
  if (error instanceof TRPCClientError && isInvitationErrorCode(error.message)) {
    return error.message;
  }

  return 'UNKNOWN';
};

/**
 * Redeems an invitation link and switches the caller into the joined
 * workspace. The accept request is idempotent on the server, so a retry after
 * a flaky response returns the same membership instead of failing.
 */
export const useAcceptInvitation = (token: string | undefined) => {
  const navigate = useNavigate();
  const [state, setState] = useState<InviteAcceptState>({ status: 'idle' });
  const startedFor = useRef<null | string>(null);

  const accept = useCallback(async () => {
    if (!token) return;

    setState({ status: 'accepting' });

    try {
      const { membership, workspace } = await lambdaClient.workspaceMember.acceptInvitation.mutate({
        token,
      });

      // Seed the store before navigating. `useWorkspaceUrlSync` resolves
      // `/:slug` against the stored list, and a list cached from before the
      // accept would otherwise render the workspace-not-found boundary for a
      // workspace the caller has just joined.
      const store = useWorkspaceStore.getState();
      store.applyWorkspaces([
        ...store.workspaces.filter((item) => item.id !== workspace.id),
        { ...workspace, role: membership.role },
      ]);
      store.setActiveWorkspaceId(workspace.id);
      persistActiveWorkspaceId(workspace.id);

      setState({ slug: workspace.slug, status: 'success' });
      navigate(`/${workspace.slug}`, { replace: true });
    } catch (error) {
      setState({ code: toErrorCode(error), status: 'error' });
    }
  }, [navigate, token]);

  /**
   * Runs the accept exactly once per token. React's development double-render
   * and a store update during the request both re-run effects; the ref keeps
   * the second pass from submitting again.
   */
  const acceptOnce = useCallback(() => {
    if (!token || startedFor.current === token) return;

    startedFor.current = token;
    void accept();
  }, [accept, token]);

  return { accept, acceptOnce, state };
};
