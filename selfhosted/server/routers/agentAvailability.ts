import type { AgentAvailability } from '@lobechat/types';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentAvailabilityService } from '@/server/services/agentAvailability';

/**
 * Composed on `wsCompatProcedure`, not `authedProcedure`, because availability is
 * read per scope: `AgentAvailabilityService` filters routing state by the
 * workspace it is handed, so a header alone would let a non-member read another
 * workspace's agents (CONTEXT.md I3). `cloudWorkspaceAuth` runs first here and
 * refuses that caller with `FORBIDDEN` before the service is even constructed.
 *
 * `wsCompatProcedure` rather than `wsProcedure` because personal mode is
 * legitimate: without an `X-Workspace-Id` header the middleware passes through
 * untouched and the service reads the caller's own pool, exactly as before this
 * change (I4).
 */
const availabilityProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      availabilityService: new AgentAvailabilityService(
        ctx.serverDB,
        ctx.userId,
        // Already proved to be a workspace the caller belongs to, so forwarding
        // it cannot cross a scope boundary.
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const agentAvailabilityRouter = router({
  /**
   * Whether each agent can take work right now, in one read: its status, the queued and
   * running Channel replies it has, when an off-duty agent's quota comes back, and whether
   * routing may hand it an unaddressed message. Agents the caller cannot see are absent.
   */
  getAvailability: availabilityProcedure
    .input(z.object({ agentIds: z.array(z.string()).max(200) }))
    .query(async ({ ctx, input }): Promise<Record<string, AgentAvailability>> =>
      ctx.availabilityService.getAvailability(input.agentIds),
    ),
});
