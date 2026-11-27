import {
  isWorkspaceSlugFormatValid,
  WORKSPACE_SLUG_MAX,
  WORKSPACE_SLUG_MIN,
} from '@lobechat/const';
import type { WorkspaceItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  wsAdminProcedure,
  wsCompatProcedure,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';

/**
 * A workspace row as the workspace picker sees it: the stored record plus the
 * caller's membership role and the plan tag cloud derives from subscriptions.
 * `plan` / `lockedOut` stay absent — billing is out of scope for the
 * self-hosted build.
 */
export interface WorkspaceMembershipSummary extends WorkspaceItem {
  lockedOut?: boolean;
  plan?: string;
  role: string | null;
}

export interface WorkspaceStatistics {
  agents: number;
  messages: number;
  messagesToday: number;
  topics: number;
}

// Same shape cloud enforces, so a slug the CLI or UI gets past this router is
// only ever rejected for the reservations cloud adds on top.
const workspaceSlugSchema = z
  .string()
  .min(WORKSPACE_SLUG_MIN)
  .max(WORKSPACE_SLUG_MAX)
  .refine(isWorkspaceSlugFormatValid, { message: 'invalid-slug' });

const workspaceStatisticsInput = z
  .object({ todayStartAt: z.string().datetime().optional() })
  .optional();

const INVALID_SLUG_MESSAGE = 'invalid-slug';
const TAKEN_SLUG_MESSAGE = 'Workspace slug is already taken';

/**
 * `create` / `update` validate the format through `workspaceSlugSchema`, but
 * `checkSlugAvailable`'s published input schema only carries the length bounds
 * (it is a plain `z.string().min().max()` in the contract). Re-check the
 * pattern here so an available-looking answer can never be returned for a slug
 * `create` would then refuse.
 */
const assertSlugFormat = (slug: string) => {
  if (!isWorkspaceSlugFormatValid(slug)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: INVALID_SLUG_MESSAGE });
  }
};

/**
 * Distinct from the length error zod raises for a too-short slug and from the
 * format error above: a well-formed slug that another workspace already owns
 * is a conflict, not a bad request.
 */
const assertSlugAvailable = async (
  db: LobeChatDatabase,
  userId: string,
  slug: string,
  exceptWorkspaceId?: string,
) => {
  const existing = await new WorkspaceModel(db, userId).findBySlug(slug);
  if (existing && existing.id !== exceptWorkspaceId) {
    throw new TRPCError({ code: 'CONFLICT', message: TAKEN_SLUG_MESSAGE });
  }
};

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
};

/**
 * The model layer already owns the counters (`AgentModel.countAgents`,
 * `TopicModel.count`, `MessageModel.count`), so statistics are composed here
 * rather than re-implemented as SQL. Models are workspace-scoped by their
 * constructor, which is what both procedures report: workspace content is
 * visible to every member by default (CONTEXT.md D2), so "my" statistics and
 * workspace statistics read the same counters and differ only in their role
 * gate (member vs admin).
 */
const collectStatistics = async (params: {
  db: LobeChatDatabase;
  todayStartAt?: string;
  userId: string;
  workspaceId: string;
}): Promise<WorkspaceStatistics> => {
  const { db, userId, workspaceId } = params;
  const todayStartAt = params.todayStartAt ?? startOfToday();

  const [agents, topics, messages, messagesToday] = await Promise.all([
    new AgentModel(db, userId, workspaceId).countAgents(),
    new TopicModel(db, userId, workspaceId).count(),
    new MessageModel(db, userId, workspaceId).count(),
    new MessageModel(db, userId, workspaceId).count({ startDate: todayStartAt }),
  ]);

  return { agents, messages, messagesToday, topics };
};

// Cloud overrides this at the same path with the real workspaceRouter backed by cloudDB.
// This is the self-hosted implementation behind that seam: it preserves the
// procedure names, input schemas and return types the client already calls, and
// fills the bodies against the real data layer.
export const workspaceRouter = router({
  checkSlugAvailable: authedProcedure
    .input(z.object({ slug: z.string().min(WORKSPACE_SLUG_MIN).max(WORKSPACE_SLUG_MAX) }))
    .query(async ({ ctx, input }): Promise<{ available: boolean }> => {
      assertSlugFormat(input.slug);

      const db = await getServerDB();
      const existing = await new WorkspaceModel(db, ctx.userId).findBySlug(input.slug);

      return { available: !existing };
    }),

  create: authedProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().max(1000).optional(),
        name: z.string().min(1).max(255),
        slug: workspaceSlugSchema,
      }),
    )
    .mutation(async ({ ctx, input }): Promise<WorkspaceItem> => {
      const db = await getServerDB();
      await assertSlugAvailable(db, ctx.userId, input.slug);

      // `WorkspaceModel.create` inserts the owner membership in the same
      // transaction; re-implementing that here would only risk drift.
      return new WorkspaceModel(db, ctx.userId).create(input);
    }),

  ensureMarketOrganization: authedProcedure
    .input(z.object({ autoProvision: z.boolean().optional() }).optional())
    .mutation(async (): Promise<{ created: boolean; marketAccountId: number }> => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Workspace market organization is a cloud-only feature.',
      });
    }),

  // `wsCompatProcedure` here, unlike cloud's `wsProcedure`, because open-source
  // callers (`buildAppUrl`) reach for it before they know whether a workspace
  // is in scope. With a header, `cloudWorkspaceAuth` has already proved
  // membership; without one there is no workspace to return (personal mode).
  getById: wsCompatProcedure.query(async ({ ctx }): Promise<WorkspaceItem | null> => {
    const workspaceId = ctx.workspaceId;
    if (!workspaceId) return null;

    const db = await getServerDB();
    return (await new WorkspaceModel(db, ctx.userId).findById(workspaceId)) ?? null;
  }),

  // `wsProcedure` resolves the workspace through `cloudWorkspaceAuth` (WS-1b),
  // so a header alone is not enough: the caller must be an active member. No
  // minimum role — viewers may read their own stats too.
  getMyStatistics: wsProcedure
    .input(workspaceStatisticsInput)
    .query(async ({ ctx, input }): Promise<WorkspaceStatistics | null> => {
      const db = await getServerDB();

      return collectStatistics({
        db,
        todayStartAt: input?.todayStartAt,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),

  getSettings: wsProcedure.query(async ({ ctx }): Promise<Record<string, unknown>> => {
    const db = await getServerDB();

    return (await new WorkspaceModel(db, ctx.userId).getSettings(ctx.workspaceId)) as Record<
      string,
      unknown
    >;
  }),

  /** Workspace-wide totals across all members — Admin or higher, like cloud. */
  getStatistics: wsAdminProcedure
    .input(workspaceStatisticsInput)
    .query(async ({ ctx, input }): Promise<WorkspaceStatistics | null> => {
      const db = await getServerDB();

      return collectStatistics({
        db,
        todayStartAt: input?.todayStartAt,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),

  list: authedProcedure.query(async ({ ctx }): Promise<WorkspaceMembershipSummary[]> => {
    const db = await getServerDB();

    // `listUserWorkspaces` joins the caller's active memberships and attaches
    // the role per row; `plan` / `lockedOut` stay absent (no billing here).
    return new WorkspaceModel(db, ctx.userId).listUserWorkspaces();
  }),

  update: wsAdminProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().max(1000).optional(),
        name: z.string().min(1).max(255).optional(),
        slug: workspaceSlugSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<void> => {
      const db = await getServerDB();

      // Renaming the slug must not collide with a workspace other than this
      // one; keeping the current slug is always allowed.
      if (input.slug) await assertSlugAvailable(db, ctx.userId, input.slug, ctx.workspaceId);

      await new WorkspaceModel(db, ctx.userId).update(ctx.workspaceId, input);
    }),
});
