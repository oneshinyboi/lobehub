import type { WorkspaceTeamItem } from '@lobechat/database/schemas';

/** A team row plus the derived member count the list renders. */
export interface WorkspaceTeamSummary extends WorkspaceTeamItem {
  memberCount: number;
}

/** The membership row `workspaceTeam.getById` returns for each member. */
export interface WorkspaceTeamMember {
  createdAt: Date | string;
  /** Reserved for team-level permissions; everyone is `member` today. */
  role: string;
  userId: string;
}

/** A team with the members the detail view renders. */
export interface WorkspaceTeamDetail extends WorkspaceTeamSummary {
  members: WorkspaceTeamMember[];
}

export interface TeamFormValues {
  description?: string;
  identifier?: string;
  name: string;
}

/**
 * Stable codes the team router returns. Declared locally so this client bundle
 * never imports server code; they must stay in sync with
 * `selfhosted/server/routers/workspaceTeam.ts`.
 */
export const DUPLICATE_TEAM_IDENTIFIER = 'DUPLICATE_TEAM_IDENTIFIER';
export const TEAM_MEMBER_NOT_IN_WORKSPACE = 'TEAM_MEMBER_NOT_IN_WORKSPACE';

/** Mirrors the server's identifier contract, narrowed to the 1–7 chars the form hints at. */
export const TEAM_IDENTIFIER_PATTERN = /^[a-z][a-z\d]{0,6}$/i;

/**
 * tRPC client errors carry the server's `message` code. Keep the check narrow:
 * a generic network error must not be rendered as a taken identifier.
 */
export const isTeamApiError = (error: unknown, code: string): boolean => {
  if (!error || typeof error !== 'object') return false;

  const value = error as { data?: { message?: unknown }; message?: unknown };
  return value.message === code || value.data?.message === code;
};
