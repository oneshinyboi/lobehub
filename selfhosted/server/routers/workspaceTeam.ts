import type { WorkspaceTeamItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import {
  DEFAULT_TEAM_IDENTIFIER,
  deriveTeamIdentifier,
  type WorkspaceTeamMemberRow,
  WorkspaceTeamModel,
  type WorkspaceTeamWithMemberCount,
} from '@/database/models/workspaceTeam';
import { router } from '@/libs/trpc/lambda';
import { wsAdminProcedure, wsMemberProcedure } from '@/selfhosted/server/workspaceAuth';

/**
 * Stable code the teams form translates and shows next to the identifier field.
 * A taken identifier is a client-resolvable conflict, not a server failure.
 */
export const WORKSPACE_TEAM_DUPLICATE_IDENTIFIER = 'DUPLICATE_TEAM_IDENTIFIER';

/**
 * Stable code for a member add that names a user who is not an active member of
 * the workspace. Sending them is a bad payload, not a permission problem.
 */
export const WORKSPACE_TEAM_MEMBER_NOT_IN_WORKSPACE = 'TEAM_MEMBER_NOT_IN_WORKSPACE';

/** A team row plus the members the detail page renders. */
export interface WorkspaceTeamDetail extends WorkspaceTeamItem {
  memberCount: number;
  members: WorkspaceTeamMemberRow[];
}

const teamIdentifierSchema = z.string().trim().min(1).max(16);

const teamIdInput = z.object({ id: z.string().min(1) });

const createTeamInput = z.object({
  avatar: z.string().nullish(),
  description: z.string().max(1000).nullish(),
  identifier: teamIdentifierSchema.optional(),
  memberUserIds: z.array(z.string().min(1)).optional(),
  name: z.string().trim().min(1).max(255),
});

const updateTeamInput = z.object({
  avatar: z.string().nullish(),
  description: z.string().max(1000).nullish(),
  id: z.string().min(1),
  identifier: teamIdentifierSchema.optional(),
  name: z.string().trim().min(1).max(255).optional(),
});

const addMembersInput = z.object({
  id: z.string().min(1),
  userIds: z.array(z.string().min(1)).min(1),
});

const removeMemberInput = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
});

/** Identifiers are stored uppercase; the model documents callers normalize. */
const normalizeIdentifier = (identifier: string) => identifier.trim().toUpperCase();

const duplicateIdentifier = (): never => {
  throw new TRPCError({ code: 'CONFLICT', message: WORKSPACE_TEAM_DUPLICATE_IDENTIFIER });
};

/**
 * Drizzle wraps driver errors, so the Postgres fields sit down the chain. The
 * pre-check in `isIdentifierTaken` closes the normal path; this closes the race
 * between that check and the insert so two concurrent creates cannot turn the
 * loser into a 500.
 */
const isIdentifierUniqueViolation = (error: unknown): boolean => {
  const readCode = (value: unknown): unknown =>
    (value as { code?: unknown } | undefined)?.code ??
    (value as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return readCode(error) === '23505';
};

const getTeamModel = async (workspaceId: string) =>
  new WorkspaceTeamModel(await getServerDB(), workspaceId);

/**
 * Every id in `userIds` must be an active member of this workspace. Checked
 * before any write so a mixed batch adds nobody rather than silently dropping
 * the stranger. The model repeats the filter under a row lock; this is the
 * user-facing rejection, not a substitute for it.
 */
const assertActiveWorkspaceMembers = async (
  db: Awaited<ReturnType<typeof getServerDB>>,
  workspaceId: string,
  callerId: string,
  userIds: string[],
) => {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return;

  const members = await new WorkspaceMemberModel(db, callerId).listMembers(workspaceId);
  const activeIds = new Set(members.map((member) => member.userId));
  const missing = uniqueIds.filter((userId) => !activeIds.has(userId));

  if (missing.length > 0) {
    throw new TRPCError({
      cause: { data: { userIds: missing } },
      code: 'BAD_REQUEST',
      message: WORKSPACE_TEAM_MEMBER_NOT_IN_WORKSPACE,
    });
  }
};

const requireTeam = async (model: WorkspaceTeamModel, id: string): Promise<WorkspaceTeamItem> => {
  const team = await model.findById(id);
  if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
  return team;
};

/**
 * Workspace teams. Reads are open to every member; writes need Admin or Owner.
 * Every query goes through `WorkspaceTeamModel`, which scopes by the workspace
 * on the context, so a team id from another workspace never resolves.
 */
export const workspaceTeamRouter = router({
  list: wsMemberProcedure.query(async ({ ctx }): Promise<WorkspaceTeamWithMemberCount[]> =>
    (await getTeamModel(ctx.workspaceId)).list(),
  ),

  getById: wsMemberProcedure
    .input(teamIdInput)
    .query(async ({ ctx, input }): Promise<WorkspaceTeamDetail> => {
      const model = await getTeamModel(ctx.workspaceId);
      const team = await requireTeam(model, input.id);
      const members = await model.listMembers(team.id);

      return { ...team, memberCount: members.length, members };
    }),

  create: wsAdminProcedure
    .input(createTeamInput)
    .mutation(async ({ ctx, input }): Promise<WorkspaceTeamItem> => {
      const db = await getServerDB();
      const model = new WorkspaceTeamModel(db, ctx.workspaceId);
      const memberUserIds = input.memberUserIds ?? [];

      await assertActiveWorkspaceMembers(db, ctx.workspaceId, ctx.userId, memberUserIds);

      const identifier = normalizeIdentifier(
        input.identifier ?? (deriveTeamIdentifier(input.name) || DEFAULT_TEAM_IDENTIFIER),
      );

      if (await model.isIdentifierTaken(identifier)) duplicateIdentifier();

      try {
        return await model.create({
          avatar: input.avatar ?? null,
          createdBy: ctx.userId,
          description: input.description ?? null,
          identifier,
          memberUserIds,
          name: input.name,
        });
      } catch (error) {
        if (isIdentifierUniqueViolation(error)) duplicateIdentifier();
        throw error;
      }
    }),

  update: wsAdminProcedure
    .input(updateTeamInput)
    .mutation(async ({ ctx, input }): Promise<WorkspaceTeamItem> => {
      const model = await getTeamModel(ctx.workspaceId);
      await requireTeam(model, input.id);

      const identifier =
        input.identifier === undefined ? undefined : normalizeIdentifier(input.identifier);

      if (identifier && (await model.isIdentifierTaken(identifier, input.id))) {
        duplicateIdentifier();
      }

      try {
        const team = await model.update(input.id, {
          avatar: input.avatar,
          description: input.description,
          identifier,
          name: input.name,
        });
        if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
        return team;
      } catch (error) {
        if (isIdentifierUniqueViolation(error)) duplicateIdentifier();
        throw error;
      }
    }),

  /**
   * Removes the team and its team-membership rows only. Workspace members
   * themselves are untouched: a team is a grouping, not a membership, so
   * deleting it must never remove anyone from the workspace.
   */
  delete: wsAdminProcedure
    .input(teamIdInput)
    .mutation(async ({ ctx, input }): Promise<WorkspaceTeamItem> => {
      const model = await getTeamModel(ctx.workspaceId);
      const team = await requireTeam(model, input.id);
      return (await model.delete(team.id)) ?? team;
    }),

  /**
   * Idempotent: users already in the team are skipped and only the newly added
   * ids come back. Only active workspace members can be added, and the whole
   * batch is rejected if it names a non-member.
   */
  addMembers: wsAdminProcedure
    .input(addMembersInput)
    .mutation(async ({ ctx, input }): Promise<string[]> => {
      const db = await getServerDB();
      const model = new WorkspaceTeamModel(db, ctx.workspaceId);
      const team = await requireTeam(model, input.id);

      await assertActiveWorkspaceMembers(db, ctx.workspaceId, ctx.userId, input.userIds);

      return model.addMembers(team.id, input.userIds);
    }),

  removeMember: wsAdminProcedure
    .input(removeMemberInput)
    .mutation(async ({ ctx, input }): Promise<boolean> => {
      const model = await getTeamModel(ctx.workspaceId);
      const team = await requireTeam(model, input.id);
      return model.removeMember(team.id, input.userId);
    }),
});
