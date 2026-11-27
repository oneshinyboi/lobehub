import { INVITATION_EXPIRY_DAYS } from '@lobechat/const';
import type {
  WorkspaceInvitationItem,
  WorkspaceItem,
  WorkspaceMemberItem,
} from '@lobechat/database/schemas';
import { users } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { UserModel } from '@/database/models/user';
import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import type { InvitationErrorCode } from '@/selfhosted/client/features/InviteAccept/errors';
import { INVITATION_ERROR } from '@/selfhosted/client/features/InviteAccept/errors';
import { WORKSPACE_MEMBER_ERROR } from '@/selfhosted/client/features/WorkspaceMembers/errors';
import { getWorkspaceMemberName } from '@/utils/workspaceMemberName';

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

/**
 * What a caller receives after redeeming a link: the membership they now hold
 * (or already held) and enough workspace identity to switch into it.
 */
export interface AcceptedInvitation {
  /** True when the caller was already a member and nothing was written. */
  alreadyMember: boolean;
  membership: WorkspaceMemberItem;
  workspace: WorkspaceItem;
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

/**
 * A revoked link and an expired one are different problems for the person
 * holding it (ask the owner for a new link vs. wait for a fresh one), so they
 * keep distinct errors. Neither message names the workspace: the token holder
 * may not be a member yet, and an invitation error must not confirm that any
 * particular workspace exists.
 */
const invitationError = (code: InvitationErrorCode): TRPCError => {
  switch (code) {
    case INVITATION_ERROR.EXPIRED: {
      return new TRPCError({ code: 'BAD_REQUEST', message: code });
    }
    case INVITATION_ERROR.NOT_FOUND: {
      return new TRPCError({ code: 'NOT_FOUND', message: code });
    }
    case INVITATION_ERROR.REVOKED: {
      return new TRPCError({ code: 'BAD_REQUEST', message: code });
    }
    case INVITATION_ERROR.USED: {
      return new TRPCError({ code: 'CONFLICT', message: code });
    }
    case INVITATION_ERROR.WRONG_ACCOUNT: {
      return new TRPCError({ code: 'FORBIDDEN', message: code });
    }
    default: {
      // Unreachable for the declared union; unknown reasons read as invalid.
      return new TRPCError({ code: 'NOT_FOUND', message: INVITATION_ERROR.NOT_FOUND });
    }
  }
};

const isExpired = (invitation: WorkspaceInvitationItem, now: Date) =>
  invitation.status === 'expired' ||
  (invitation.expiresAt !== null && invitation.expiresAt.getTime() <= now.getTime());

const memberRoleSchema = z.enum(['admin', 'member', 'viewer']);

/**
 * Refuse a change that would leave the workspace without an owner.
 *
 * The role column is the source of truth (CONTEXT.md D4) and the schema keeps
 * active owners unique, but the client cannot see the whole roster at write
 * time. This check is therefore the server's job: the UI only renders the
 * refusal it gets back instead of pre-disabling the last owner's controls.
 */
const assertMemberIsNotLastOwner = async (
  model: WorkspaceMemberModel,
  workspaceId: string,
  userId: string,
) => {
  const members = await model.listMembers(workspaceId);
  const target = members.find((member) => member.userId === userId);
  if (target?.role !== 'owner') return;

  const ownerCount = members.filter((member) => member.role === 'owner').length;
  if (ownerCount <= 1) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: WORKSPACE_MEMBER_ERROR.LAST_OWNER,
    });
  }
};

// Cloud overrides this at the same path with the real workspaceMemberRouter.
// The invitation flows, the member directory and the link-invite management are
// implemented here on top of the data layer; `updateProfile` keeps the stub
// contract so an unbuilt surface still type-checks.
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
    .query(async ({ ctx, input }): Promise<WorkspaceMemberSummary[]> => {
      // An unscoped call is personal mode, which has no member directory — the
      // client hooks skip the request entirely, and a direct caller reads empty
      // rather than an error. With a header, `cloudWorkspaceAuth` has already
      // proved active membership (CONTEXT.md I3).
      const workspaceId = ctx.workspaceId;
      if (!workspaceId) return [];

      const db = await getServerDB();
      const members = await new WorkspaceMemberModel(db, ctx.userId!).listMembers(workspaceId, {
        includeDeleted: input?.includeDeleted,
      });

      // One batch lookup rather than a join in the model: the member list is
      // small and the profile columns are the only user fields the directory
      // exposes (never settings or key vaults).
      const profiles = await UserModel.findByIds(
        db,
        members.map((member) => member.userId),
      );
      const profileById = new Map(
        profiles.map((user) => [
          user.id,
          {
            avatar: user.avatar,
            email: user.email,
            fullName: user.fullName,
            username: user.username,
          },
        ]),
      );

      return members
        .map((member) => ({ ...member, user: profileById.get(member.userId) ?? null }))
        .sort((a, b) => {
          // Same nickname-first name the UI renders, so the CLI's table and a
          // picker list people in the same order.
          const byName = getWorkspaceMemberName(a).localeCompare(getWorkspaceMemberName(b));
          return byName === 0 ? a.userId.localeCompare(b.userId) : byName;
        });
    }),

  /**
   * Change a member's built-in role. Inviting through this endpoint never
   * grants `owner`: ownership moves only through the dedicated transfer flow.
   *
   * The last-owner guard runs before the write and refuses with a stable code
   * so the page can explain why instead of silently dropping the change.
   */
  updateRole: wsCompatAdminProcedure
    .input(z.object({ role: memberRoleSchema, userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<WorkspaceMemberItem> => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await getServerDB();
      const model = new WorkspaceMemberModel(db, ctx.userId!);

      const target = await model.getMember(workspaceId, input.userId);
      if (!target) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: WORKSPACE_MEMBER_ERROR.MEMBER_NOT_FOUND,
        });
      }

      await assertMemberIsNotLastOwner(model, workspaceId, input.userId);
      await model.updateMemberRole(workspaceId, input.userId, input.role);

      // Re-read so the caller gets the row as stored (including the updatedAt
      // the model owns) rather than a client-side reconstruction.
      const updated = await model.getMember(workspaceId, input.userId);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: WORKSPACE_MEMBER_ERROR.MEMBER_NOT_FOUND,
        });
      }

      return updated;
    }),

  /**
   * Remove a member from the workspace. Same last-owner refusal as `updateRole`
   * — the owner's row is the one membership that cannot disappear on its own.
   */
  removeMember: wsCompatAdminProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ removed: boolean }> => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await getServerDB();
      const model = new WorkspaceMemberModel(db, ctx.userId!);

      const target = await model.getMember(workspaceId, input.userId);
      if (!target) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: WORKSPACE_MEMBER_ERROR.MEMBER_NOT_FOUND,
        });
      }

      await assertMemberIsNotLastOwner(model, workspaceId, input.userId);
      await model.removeMember(workspaceId, input.userId);

      return { removed: true };
    }),

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

  /**
   * Redeem an invitation link. Signed-in callers only; the token is the secret,
   * so there is no workspace header to send and no workspace id in the input.
   *
   * Order matters:
   * 1. An unknown token is `NOT_FOUND`.
   * 2. An existing member gets their membership back, whatever the invitation's
   *    state — this is what makes accepting twice a no-op. It is also safe: the
   *    caller already belongs to the workspace, so nothing is revealed.
   * 3. A single-use invitation addressed to another account is refused before
   *    its state is examined, so the intended recipient gets the actionable
   *    "wrong account" copy rather than a misleading expiry message.
   * 4. Revoked, already-used and expired each keep their own error.
   *
   * Reusable share links stay `pending` after an accept; a single-use
   * invitation is marked `accepted` so a different user cannot reuse it.
   */
  acceptInvitation: authedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<AcceptedInvitation> => {
      const userId = ctx.userId!;
      const db = await getServerDB();
      const memberModel = new WorkspaceMemberModel(db, userId);
      const invitation = await memberModel.findInvitationByToken(input.token);

      if (!invitation) throw invitationError(INVITATION_ERROR.NOT_FOUND);

      const workspace = await new WorkspaceModel(db, userId).findById(invitation.workspaceId);
      if (!workspace) throw invitationError(INVITATION_ERROR.NOT_FOUND);

      const existing = await memberModel.getMember(invitation.workspaceId, userId);
      if (existing) {
        return {
          alreadyMember: true,
          membership: existing,
          workspace,
        };
      }

      if (invitation.email) {
        const user = await db.query.users.findFirst({
          columns: { email: true },
          where: eq(users.id, userId),
        });
        const matches =
          !!user?.email && user.email.toLowerCase() === invitation.email.toLowerCase();

        if (!matches) throw invitationError(INVITATION_ERROR.WRONG_ACCOUNT);
      }

      if (invitation.status === 'revoked') throw invitationError(INVITATION_ERROR.REVOKED);
      // `accepted` is terminal for a single-use invitation; check it before
      // the expiry so a used link that has since aged out still reads as used.
      // A reusable link stays `pending` and never reaches this branch.
      if (!invitation.reusable && invitation.status !== 'pending')
        throw invitationError(INVITATION_ERROR.USED);
      if (isExpired(invitation, new Date())) throw invitationError(INVITATION_ERROR.EXPIRED);
      if (invitation.status !== 'pending') throw invitationError(INVITATION_ERROR.USED);

      // `catch` keeps a malformed stored role from making the invitation
      // unusable: the built-in default is member, the least surprising grant.
      const role = invitationRoleSchema.catch('member').parse(invitation.role);
      const membership = await memberModel.addMember({
        role,
        userId,
        workspaceId: invitation.workspaceId,
      });

      if (!invitation.reusable) {
        await memberModel.updateInvitationStatus(invitation.id, 'accepted');
      }

      return {
        alreadyMember: false,
        membership,
        workspace,
      };
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
