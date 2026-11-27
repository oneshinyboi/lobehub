import type { WorkspaceAuditLogItem } from '@lobechat/database/schemas';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceAuditLog from './index';

const listQuery = vi.hoisted(() => vi.fn());
const createWorkspaceLambdaClient = vi.hoisted(() => vi.fn());
const activeWorkspace = vi.hoisted(() => ({ value: 'ws-test' as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => activeWorkspace.value,
}));

vi.mock('@/libs/trpc/client', () => ({ createWorkspaceLambdaClient }));

const row = (id: string, action: string, overrides: Partial<WorkspaceAuditLogItem> = {}) =>
  ({
    action,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    id,
    ipAddress: '203.0.113.10',
    metadata: {},
    resourceId: `${id}-resource`,
    resourceType: 'workspace',
    userId: 'user-1',
    workspaceId: 'ws-test',
    ...overrides,
  }) as WorkspaceAuditLogItem;

const renderPage = () =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <WorkspaceAuditLog />
    </SWRConfig>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  activeWorkspace.value = 'ws-test';
  createWorkspaceLambdaClient.mockReturnValue({
    workspaceAuditLog: { list: { query: listQuery } },
  });
});

describe('WorkspaceAuditLog page', () => {
  it('renders the empty state when the workspace has no audit rows', async () => {
    listQuery.mockResolvedValue({ items: [], nextCursor: null });

    renderPage();

    expect(await screen.findByText('workspace.auditLog.empty')).toBeInTheDocument();
    expect(createWorkspaceLambdaClient).toHaveBeenCalledWith('ws-test');
    expect(listQuery).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });

  it('renders rows and appends the next cursor page when "load more" is clicked', async () => {
    listQuery.mockImplementation(async ({ cursor }: { cursor?: string }) =>
      cursor === 'cursor-2'
        ? {
            items: [row('3', 'api_key.created', { resourceType: 'api_key' })],
            nextCursor: null,
          }
        : {
            items: [row('2', 'member.invited'), row('1', 'workspace.created')],
            nextCursor: 'cursor-2',
          },
    );

    renderPage();

    expect(await screen.findByText('member.invited')).toBeInTheDocument();
    expect(screen.getByText('workspace.created')).toBeInTheDocument();

    await userEvent.click(screen.getByText('workspace.auditLog.loadMore'));

    expect(await screen.findByText('api_key.created')).toBeInTheDocument();
    expect(listQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2', limit: 20 }),
    );
    // The second page returned `nextCursor: null`, so the control disappears.
    await waitFor(() =>
      expect(screen.queryByText('workspace.auditLog.loadMore')).not.toBeInTheDocument(),
    );
  });

  it('sends the debounced free-text query and resets it', async () => {
    listQuery.mockResolvedValue({ items: [], nextCursor: null });

    renderPage();

    const input = screen.getByPlaceholderText(
      'workspace.auditLog.filters.searchPlaceholder',
    ) as HTMLInputElement;

    await userEvent.type(input, 'alice');

    await waitFor(
      () => {
        expect(listQuery.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'alice' });
      },
      { timeout: 2000 },
    );

    await userEvent.click(screen.getByText('workspace.auditLog.filters.reset'));

    await waitFor(() => expect(input.value).toBe(''));
    await waitFor(
      () => {
        expect(listQuery.mock.calls.at(-1)?.[0]?.q).toBeUndefined();
      },
      { timeout: 2000 },
    );
  });

  it('shows a retryable error state instead of the empty state when the load fails', async () => {
    listQuery.mockRejectedValue(new Error('boom'));

    renderPage();

    expect(await screen.findByText('workspace.auditLog.loadFailed')).toBeInTheDocument();
    expect(screen.getByText('retry')).toBeInTheDocument();
  });

  it('does not fetch without an active workspace', async () => {
    activeWorkspace.value = null;
    listQuery.mockResolvedValue({ items: [], nextCursor: null });

    renderPage();

    expect(await screen.findByText('workspace.auditLog.empty')).toBeInTheDocument();
    expect(createWorkspaceLambdaClient).not.toHaveBeenCalled();
    expect(listQuery).not.toHaveBeenCalled();
  });
});
