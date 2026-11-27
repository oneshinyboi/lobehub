'use client';

import { useClientDataSWR } from '@/libs/swr';
import { createWorkspaceLambdaClient } from '@/libs/trpc/client';

import type { WorkspaceTeamDetail, WorkspaceTeamSummary } from './types';

const LIST_KEY = 'workspaceTeam.list';
const DETAIL_KEY = 'workspaceTeam.getById';

const EMPTY_TEAMS: WorkspaceTeamSummary[] = [];

/**
 * The active workspace's teams with their member counts.
 *
 * Personal mode has no teams, so the SWR key stays `null` and no request is
 * issued (CONTEXT.md I4). The client is pinned to `workspaceId` instead of the
 * ambient header so a workspace switch can never mix two rosters.
 */
export const useWorkspaceTeamList = (workspaceId: null | string) => {
  const { data, error, isLoading, mutate } = useClientDataSWR<WorkspaceTeamSummary[]>(
    workspaceId ? LIST_KEY : null,
    async () => {
      if (!workspaceId) return EMPTY_TEAMS;

      return createWorkspaceLambdaClient(workspaceId).workspaceTeam.list.query();
    },
  );

  return {
    error,
    isLoading,
    refresh: mutate,
    teams: data ?? EMPTY_TEAMS,
  };
};

/**
 * One team with its members. The key is null while the list is showing, so
 * opening `/settings/teams` never fetches an arbitrary team.
 */
export const useWorkspaceTeamDetail = (workspaceId: null | string, teamId?: string) => {
  const { data, error, isLoading, mutate } = useClientDataSWR<WorkspaceTeamDetail>(
    workspaceId && teamId ? [DETAIL_KEY, teamId] : null,
    async () => {
      if (!workspaceId || !teamId) throw new Error('workspaceTeam.getById requires a team id');

      return createWorkspaceLambdaClient(workspaceId).workspaceTeam.getById.query({ id: teamId });
    },
  );

  return {
    error,
    isLoading,
    refresh: mutate,
    team: data ?? null,
  };
};
