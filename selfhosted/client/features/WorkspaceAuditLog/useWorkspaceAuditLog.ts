import type { WorkspaceAuditLogItem } from '@lobechat/database/schemas';
import { useCallback } from 'react';
import useSWRInfinite from 'swr/infinite';

import { createWorkspaceLambdaClient } from '@/libs/trpc/client';

import { AUDIT_LOG_PAGE_SIZE } from './const';

export interface AuditLogFilters {
  action?: string;
  endDate?: string;
  q?: string;
  resourceType?: string;
  startDate?: string;
}

export interface AuditLogPage {
  items: WorkspaceAuditLogItem[];
  nextCursor: string | null;
}

/**
 * Reads `workspaceAuditLog.list` page by page. The cursor is opaque to the
 * caller: it comes from `nextCursor` on the previous page and is only sent back
 * verbatim, matching the router contract (no offsets).
 */
export const useWorkspaceAuditLog = (workspaceId: string | null, filters: AuditLogFilters) => {
  // Keep the key stable across renders that did not change any filter.
  const filtersKey = JSON.stringify(filters);

  const { data, error, isLoading, isValidating, mutate, setSize, size } =
    useSWRInfinite<AuditLogPage>(
      (index, previousPage) => {
        if (!workspaceId) return null;
        // The last page had no cursor, so there is nothing left to fetch.
        if (index > 0 && !previousPage?.nextCursor) return null;

        return [
          'workspaceAuditLog.list',
          workspaceId,
          filtersKey,
          index === 0 ? null : previousPage?.nextCursor,
        ];
      },
      async ([, scopedWorkspaceId, , cursor]: [string, string, string, string | null]) => {
        const client = createWorkspaceLambdaClient(scopedWorkspaceId);

        return client.workspaceAuditLog.list.query({
          ...filters,
          cursor: cursor ?? undefined,
          limit: AUDIT_LOG_PAGE_SIZE,
        });
      },
      {
        // A new filter set is a new query: start from page 1 again.
        persistSize: false,
        revalidateOnFocus: false,
        shouldRetryOnError: false,
      },
    );

  const items = data?.flatMap((page) => page.items) ?? [];
  const nextCursor = data?.at(-1)?.nextCursor ?? null;
  const hasMore = Boolean(nextCursor);

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    void setSize(size + 1);
  }, [hasMore, setSize, size]);

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  return {
    error,
    hasMore,
    isLoading: isLoading && !data,
    isLoadingMore: isValidating && Boolean(data) && data!.length < size,
    items,
    loadMore,
    nextCursor,
    refresh,
  };
};
