import type { WorkspaceAuditLogItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import type { WorkspaceAuditAction } from '@/database/models/workspaceAuditLog';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/**
 * The contract below is copied verbatim from the upstream stub at
 * `packages/business-server/src/lambda-routers/workspaceAuditLog.ts`; the
 * client and the CLI already send exactly these fields, so it must not drift.
 */
const listInput = z
  .object({
    action: z.string().optional(),
    cursor: z.string().optional(),
    endDate: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    q: z.string().optional(),
    resourceType: z.string().optional(),
    startDate: z.string().optional(),
  })
  .optional();

/**
 * Parses an ISO date coming off the wire. The schema keeps dates as strings
 * (the cloud contract), but the model needs `Date` objects; an unparseable
 * value is a client error rather than an opaque driver failure.
 */
const parseDate = (value: string | undefined, field: string) => {
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid ${field}: ${value}` });
  }
  return date;
};

export const workspaceAuditLogRouter = router({
  list: wsCompatProcedure
    .use(requireWorkspaceRole('admin'))
    .use(serverDatabase)
    .input(listInput)
    .query(
      async ({
        ctx,
        input,
      }): Promise<{ items: WorkspaceAuditLogItem[]; nextCursor: string | null }> => {
        // `wsCompatProcedure` resolves the workspace from the header (and
        // `requireWorkspaceRole` proves an admin is asking). A missing id here
        // means personal mode, where there is no audit log to read.
        if (!ctx.workspaceId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'workspaceId is required',
          });
        }

        const { items, nextCursor } = await new WorkspaceAuditLogModel(ctx.serverDB).list({
          action: input?.action as WorkspaceAuditAction | undefined,
          cursor: parseDate(input?.cursor, 'cursor'),
          endDate: parseDate(input?.endDate, 'endDate'),
          limit: input?.limit,
          q: input?.q,
          resourceType: input?.resourceType,
          startDate: parseDate(input?.startDate, 'startDate'),
          workspaceId: ctx.workspaceId,
        });

        return { items, nextCursor: nextCursor ?? null };
      },
    ),
});
