'use client';

import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from './store/workspace';

export interface Permission {
  allowed: boolean;
  /**
   * Localised tooltip text explaining why the action is blocked. `undefined`
   * when allowed, so unconditional `<Tooltip title={reason}>` wrappers render
   * nothing instead of an empty tooltip bubble (Tooltip only skips nullish
   * titles, not empty strings).
   */
  reason?: string;
}

export type WorkspaceRole = 'admin' | 'member' | 'owner' | 'viewer';

/**
 * Built-in workspace roles, lowest to highest. `workspace_members.role` is the
 * single source of truth (CONTEXT.md D4), so this ordering is the whole role
 * model — no `rbac_*` rows are consulted on the client.
 */
export const WORKSPACE_ROLE_ORDER: readonly WorkspaceRole[] = [
  'viewer',
  'member',
  'admin',
  'owner',
];

export const isWorkspaceRole = (role: null | string | undefined): role is WorkspaceRole =>
  WORKSPACE_ROLE_ORDER.includes(role as WorkspaceRole);

/** Whether `role` is at least `minRole` in the viewer < member < admin < owner order. */
export const hasMinWorkspaceRole = (
  role: null | string | undefined,
  minRole: WorkspaceRole,
): boolean => {
  if (!isWorkspaceRole(role)) return false;

  return WORKSPACE_ROLE_ORDER.indexOf(role) >= WORKSPACE_ROLE_ORDER.indexOf(minRole);
};

/**
 * Minimum workspace role required by each client-side action code.
 *
 * These are the coarse UI signals the existing call sites already pass
 * (`create_content`, `edit_own_content`, …), not the fine-grained
 * `resource:action` codes the server enforces — the client only needs to know
 * whether to arm or block a control, and the server remains the authority.
 *
 * - content writes (`create_content` / `edit_own_content`) need `member`;
 *   `viewer` is read-only (CONTEXT.md D4).
 * - touching another member's content is an `owner` capability: admins may
 *   curate shared agents, but they do not bypass per-topic / per-agent
 *   ownership restrictions (the same bucket `topic:update:all` grants).
 * - shared infrastructure and workspace settings (`manage_settings`,
 *   `manage_provider_key`) start at `admin`; billing visibility follows the
 *   settings navigation contract ("Admin-or-higher") and is out of scope for
 *   the self-hosted build anyway.
 *
 * An action code this map does not know about stays permissive: upstream keeps
 * adding call sites and the server still enforces, so a missing entry must not
 * lock a personal or member UI out while the overlay catches up.
 */
export const ACTION_MIN_ROLE: Record<string, WorkspaceRole> = {
  create_content: 'member',
  edit_others_content: 'owner',
  edit_own_content: 'member',
  manage_provider_key: 'admin',
  manage_settings: 'admin',
  view_billing: 'admin',
};

const BLOCKED_REASON_KEY = {
  admin: 'workspace.permission.requiresAdmin',
  member: 'workspace.permission.requiresMember',
  owner: 'workspace.permission.requiresOwner',
  viewer: 'workspace.permission.requiresMember',
} as const satisfies Record<WorkspaceRole, string>;

/**
 * Whether the caller may perform `action` in the current scope.
 *
 * Personal mode (no active workspace) keeps the open-source default — allowed,
 * because there is no workspace to govern (CONTEXT.md I4). Inside a workspace
 * the caller's membership role decides, and a blocked action returns a
 * localised reason so disabled controls can explain who to ask.
 */
export const usePermission = (action: string): Permission => {
  const { t } = useTranslation('setting');
  const isWorkspaceScoped = useWorkspaceStore((state) => !!state.activeWorkspaceId);
  const role = useWorkspaceStore((state) => {
    if (!state.activeWorkspaceId) return null;

    return (
      state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)?.role ?? null
    );
  });

  const minRole = ACTION_MIN_ROLE[action];

  // Personal mode, or an action code the overlay does not map yet: the server
  // is still the enforcing authority.
  if (!isWorkspaceScoped || !minRole) return { allowed: true, reason: undefined };

  if (hasMinWorkspaceRole(role, minRole)) return { allowed: true, reason: undefined };

  return { allowed: false, reason: t(BLOCKED_REASON_KEY[minRole]) };
};
