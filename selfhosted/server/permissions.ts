import { getWorkspaceRolePermissionCodes } from '@lobechat/const/rbac';
import { TRPCError } from '@trpc/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { trpc } from '@/libs/trpc/lambda/init';

export type WorkspaceRole = 'admin' | 'member' | 'owner' | 'viewer';

/**
 * Built-in workspace roles, lowest to highest. `workspace_members.role` is the
 * single source of truth (CONTEXT.md D4), so this ordering is the whole role
 * model — no `rbac_*` rows are consulted here.
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
 * Whether a `workspace_members.role` value grants `code`.
 *
 * The role is expanded through the in-code matrix in `@lobechat/const/rbac`
 * (D4: the membership column is the source of truth, the matrix is its
 * expansion). A code without a scope (`agent:update`) accepts any granted
 * scope (`:owner` or `:all`), which is what `withScopedPermission` promises its
 * callers.
 */
export const workspaceRoleHasPermission = (
  role: null | string | undefined,
  code: string,
): boolean => {
  if (!isWorkspaceRole(role)) return false;

  const permissions = getWorkspaceRolePermissionCodes(role);

  return permissions.some((permission) => permission === code || permission.startsWith(`${code}:`));
};

interface PermissionContext {
  userId?: null | string;
  workspaceId?: null | string;
  workspaceRole?: string;
}

const asPermissionContext = (ctx: unknown): PermissionContext => ctx as PermissionContext;

/**
 * The caller's role in the active workspace, or `undefined` in personal mode.
 *
 * `cloudWorkspaceAuth` normally puts a verified role on the context. When it
 * has not run — a router that only carries `X-Workspace-Id` — resolve the
 * membership here instead of trusting the header (CONTEXT.md I3). A workspace
 * the caller does not belong to is never granted a role.
 */
const resolveWorkspaceRole = async (ctx: PermissionContext): Promise<undefined | WorkspaceRole> => {
  if (!ctx.workspaceId) return undefined;
  if (isWorkspaceRole(ctx.workspaceRole)) return ctx.workspaceRole;

  if (!ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required for workspace access',
    });
  }

  const db = await getServerDB();
  const membership = await new WorkspaceMemberModel(db, ctx.userId).getMember(
    ctx.workspaceId,
    ctx.userId,
  );

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this workspace' });
  }

  if (!isWorkspaceRole(membership.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Unknown workspace role: ${membership.role}`,
    });
  }

  return membership.role;
};

/**
 * Personal requests (no `X-Workspace-Id`) pass through untouched (CONTEXT.md
 * I4). A workspace-scoped request needs a role that satisfies `check`; a
 * missing role is a refusal, never an implicit allow.
 */
const enforceWorkspacePermission = (check: (role: WorkspaceRole) => boolean, description: string) =>
  trpc.middleware(async (opts) => {
    const ctx = asPermissionContext(opts.ctx);

    if (!ctx.workspaceId) return opts.next();

    const role = await resolveWorkspaceRole(ctx);

    if (!role || !check(role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Requires workspace permission: ${description}`,
      });
    }

    return opts.next();
  });

/** Requires `code` (`resource:action`), accepting any granted scope of it. */
export const withRbacPermission = (code: string) =>
  enforceWorkspacePermission((role) => workspaceRoleHasPermission(role, code), code);

/** Requires every one of `codes`. */
export const withAllRbacPermissions = (codes: string[]) =>
  enforceWorkspacePermission(
    (role) => codes.every((code) => workspaceRoleHasPermission(role, code)),
    codes.join(' & '),
  );

/** Requires at least one of `codes`. */
export const withAnyRbacPermission = (codes: string[]) =>
  enforceWorkspacePermission(
    (role) => codes.some((code) => workspaceRoleHasPermission(role, code)),
    codes.join(' | '),
  );

/**
 * The "member-or-owner" gate: `action` (`resource:action`) is satisfied by
 * either scope (`:owner` for a member's own rows, `:all` for an owner's), so
 * this is the same check as `withRbacPermission` spelled for call sites that
 * reason in actions rather than full permission codes.
 */
export const withScopedPermission = (action: string) =>
  enforceWorkspacePermission((role) => workspaceRoleHasPermission(role, action), action);
