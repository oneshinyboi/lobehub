import { INVITATION_EXPIRY_DAYS } from '@lobechat/const';
import type { WorkspaceInvitationItem, WorkspaceMemberItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { router } from '@/libs/trpc/lambda';

/** A membership row joined with the public profile of the member. */
export interface WorkspaceMemberSummary extends WorkspaceMemberItem {
  user: {
    avatar: string | null;
    email: string | null;
    fullName: string | null;
    username: string | null;
  } | null;
}

/**
 * An invitation as the owner receives it: the stored row plus the absolute URL
 * they copy and send themselves. Invitations are link-only (CONTEXT.md D1), so
 * the URL — never an email — is the delivery mechanism.
 */
export interface WorkspaceInvitationLink extends WorkspaceInvitationItem {
  url: string;
}

// Cloud gates these on the compat procedure plus a role check rather than on a
// procedure that requires the header, so an unscoped call reads as empty rather
// than as a bad request. Mirror that here. Inviting and listing invitations is
// admin-and-above; the member roster itself stays readable by every member.
const wsCompatAdminProcedure = wsCompatProcedure.use(requireWorkspaceRole('admin'));

const invitationRoleSchema = z.enum(['admin', 'member', 'viewer']);

const inviteLinkInput = z.object({ role: invitationRoleSchema.default('member') });

const appOrigin = () => {
  const configured = process.env.APP_URL?.trim();
  const origin = configured || `http://localhost:${process.env.PORT || 3210}`;
  return origin.replace(/\/+$/, '');
};

const invitationUrl = (token: string) => `${appOrigin()}/invite/${encodeURIComponent(token)}`;

const withUrl = (invitation: WorkspaceInvitationItem): WorkspaceInvitationLink => ({
  ...invitation,
  url: invitationUrl(invitation.token),
});

/**
 * The link is created from `INVITATION_EXPIRY_DAYS` rather than a literal so a
 * single constant governs both the stored expiry and what the UI promises.
 */
const linkExpiry = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);
  return expiresAt;
};

const workspaceIdOf = (ctx: { workspaceId?: string | null }): string => {
  if (!ctx.workspaceId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'workspaceId is required' });
  }
  return ctx.workspaceId;
};

// Cloud overrides this at the same path with the real workspaceMemberRouter.
// The invitation procedures are implemented here on top of the data layer;
// unbuilt surfaces keep the stub contract so existing callers still type-check.
export const workspaceMemberRouter = router({
  /**
   * Legacy invite entry point (the CLI's `workspace invite`). It never sends
   * mail: it records a single-use invitation whose token the owner can turn
   * into a URL. Reusable share links are created by `createInviteLink`.
   */
  invite: wsCompatAdminProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        role: invitationRoleSchema.default('member'),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<WorkspaceInvitationLink> => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await getServerDB();
      const invitation = await new WorkspaceMemberModel(db, ctx.userId!).createInvitation({
        email: input.email,
        role: input.role,
        workspaceId,
      });

      return withUrl(invitation);
    }),

  list: wsCompatProcedure
    .input(z.object({ includeDeleted: z.boolean().optional() }).optional())
    .query(async (): Promise<WorkspaceMemberSummary[]> => []),

  /** Pending single-use invitations (link-only: no mail has been sent). */
  listInvitations: wsCompatAdminProcedure.query(
    async ({ ctx }): Promise<WorkspaceInvitationLink[]> => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await getServerDB();
      const invitations = await new WorkspaceMemberModel(db, ctx.userId!).listPendingInvitations(
        workspaceId,
      );

      return invitations.map(withUrl);
    },
  ),

  /** Create a reusable share link any signed-in user can accept until it expires. */
  createInviteLink: wsCompatAdminProcedure
    .input(inviteLinkInput)
    .mutation(async ({ ctx, input }): Promise<WorkspaceInvitationLink> => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await getServerDB();
      const invitation = await new WorkspaceMemberModel(db, ctx.userId!).createLinkInvitation({
        expiresAt: linkExpiry(),
        role: input.role,
        workspaceId,
      });

      return withUrl(invitation);
    }),

  /** The workspace's live share links, newest first. */
  listInviteLinks: wsCompatAdminProcedure.query(
    async ({ ctx }): Promise<WorkspaceInvitationLink[]> => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await getServerDB();
      const invitations = await new WorkspaceMemberModel(db, ctx.userId!).listLinkInvitations(
        workspaceId,
      );

      return invitations.map(withUrl);
    },
  ),

  /**
   * Revoke one share link. `revoked: false` covers an unknown id, another
   * workspace's link and a link that was already revoked; the model refuses
   * all of them rather than leaking whether the row exists.
   */
  revokeInviteLink: wsCompatAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ revoked: boolean }> => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await getServerDB();
      const revoked = await new WorkspaceMemberModel(db, ctx.userId!).revokeLinkInvitation(
        workspaceId,
        input.id,
      );

      return { revoked };
    }),

  // A member's workspace title and responsibilities. Cloud lets any member edit
  // their own and Admin or higher edit anyone's; blank clears, omitted keeps.
  updateProfile: wsCompatProcedure
    .input(
      z.object({
        responsibilities: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        userId: z.string(),
      }),
    )
    .mutation(async (): Promise<WorkspaceMemberItem> => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Workspace member profiles are a cloud-only feature.',
      });
    }),
});
