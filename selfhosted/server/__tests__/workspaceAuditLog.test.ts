// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { workspaceAuditLogRouter } from '@/business/server/lambda-routers/workspaceAuditLog';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceAuditLogs, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

// `cloudWorkspaceAuth` (used by `wsCompatProcedure`) reads membership through
// `getServerDB`. Point that at the real PGlite test database so the role gate
// under test is the one that ships, not a mock.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'audit-owner';
const adminId = 'audit-admin';
const memberId = 'audit-member';
const outsiderId = 'audit-outsider';

const workspaceId = 'audit-workspace';
const foreignWorkspaceId = 'audit-foreign-workspace';

const caller = (userId: string, workspace?: string) =>
  workspaceAuditLogRouter.createCaller({ userId, workspaceId: workspace } as never);

const auditRows = [
  {
    action: 'workspace.created',
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    ipAddress: '203.0.113.10',
    resourceId: 'workspace-row',
    resourceType: 'workspace',
    userId: ownerId,
    workspaceId,
  },
  {
    action: 'member.invited',
    createdAt: new Date('2026-01-01T10:01:00.000Z'),
    ipAddress: '203.0.113.11',
    resourceId: 'invitation-row',
    resourceType: 'invitation',
    userId: adminId,
    workspaceId,
  },
  {
    action: 'workspace.updated',
    createdAt: new Date('2026-01-01T10:02:00.000Z'),
    ipAddress: '198.51.100.7',
    resourceId: 'workspace-row',
    resourceType: 'workspace',
    userId: ownerId,
    workspaceId,
  },
  {
    action: 'api_key.created',
    createdAt: new Date('2026-01-01T10:03:00.000Z'),
    ipAddress: '203.0.113.99',
    resourceId: 'api-key-row',
    resourceType: 'api_key',
    userId: adminId,
    workspaceId,
  },
  {
    action: 'workspace.updated',
    createdAt: new Date('2026-01-01T10:04:00.000Z'),
    ipAddress: '203.0.113.50',
    resourceId: 'foreign-row',
    resourceType: 'workspace',
    userId: outsiderId,
    workspaceId: foreignWorkspaceId,
  },
];

const resourceIds = (items: { resourceId: string | null }[]) =>
  items.map((item) => item.resourceId);

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaceAuditLogs);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([{ id: ownerId }, { id: adminId }, { id: memberId }, { id: outsiderId }]);

  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Audit', primaryOwnerId: ownerId, slug: 'audit' },
    { id: foreignWorkspaceId, name: 'Foreign', primaryOwnerId: outsiderId, slug: 'foreign' },
  ]);

  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'admin', userId: adminId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
    { role: 'owner', userId: outsiderId, workspaceId: foreignWorkspaceId },
  ]);

  await serverDB.insert(workspaceAuditLogs).values(auditRows);
});

describe('workspaceAuditLog.list — filters', () => {
  it('returns the workspace rows newest first and never leaks another workspace', async () => {
    const result = await caller(adminId, workspaceId).list();

    expect(resourceIds(result.items)).toEqual([
      'api-key-row',
      'workspace-row',
      'invitation-row',
      'workspace-row',
    ]);
    expect(result.items.some((item) => item.resourceId === 'foreign-row')).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('filters by action', async () => {
    const result = await caller(adminId, workspaceId).list({ action: 'workspace.updated' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      action: 'workspace.updated',
      resourceId: 'workspace-row',
      workspaceId,
    });
  });

  it('filters by resource type', async () => {
    const result = await caller(adminId, workspaceId).list({ resourceType: 'api_key' });

    expect(resourceIds(result.items)).toEqual(['api-key-row']);
  });

  it('filters by an inclusive start/end date range', async () => {
    const result = await caller(adminId, workspaceId).list({
      endDate: '2026-01-01T10:02:00.000Z',
      startDate: '2026-01-01T10:01:00.000Z',
    });

    // Both endpoints are inclusive; rows outside stay out.
    expect(resourceIds(result.items)).toEqual(['workspace-row', 'invitation-row']);
  });

  it('searches action, resource type, resource id and IP case-insensitively', async () => {
    const byIp = await caller(adminId, workspaceId).list({ q: '198.51.100' });
    expect(resourceIds(byIp.items)).toEqual(['workspace-row']);

    const byAction = await caller(adminId, workspaceId).list({ q: 'API_KEY' });
    expect(resourceIds(byAction.items)).toEqual(['api-key-row']);

    const byResourceType = await caller(adminId, workspaceId).list({ q: 'invitation' });
    expect(resourceIds(byResourceType.items)).toEqual(['invitation-row']);
  });

  it('applies filters before paginating', async () => {
    const result = await caller(adminId, workspaceId).list({
      limit: 1,
      resourceType: 'workspace',
    });

    expect(resourceIds(result.items)).toEqual(['workspace-row']);
    expect(result.nextCursor).toBe('2026-01-01T10:02:00.000Z');
  });
});

describe('workspaceAuditLog.list — cursor pagination', () => {
  it('walks every row exactly once across pages', async () => {
    const first = await caller(adminId, workspaceId).list({ limit: 2 });

    expect(resourceIds(first.items)).toEqual(['api-key-row', 'workspace-row']);
    // The cursor is the last row's createdAt, not an offset.
    expect(first.nextCursor).toBe('2026-01-01T10:02:00.000Z');

    const second = await caller(adminId, workspaceId).list({
      cursor: first.nextCursor!,
      limit: 2,
    });

    expect(resourceIds(second.items)).toEqual(['invitation-row', 'workspace-row']);
    expect(second.nextCursor).toBeNull();

    const seen = [...resourceIds(first.items), ...resourceIds(second.items)];
    expect(seen).toHaveLength(4);
    expect(new Set(first.items.concat(second.items).map((item) => item.id)).size).toBe(4);
  });

  it('returns an empty page when the cursor is the oldest row', async () => {
    const result = await caller(adminId, workspaceId).list({
      cursor: '2026-01-01T10:00:00.000Z',
      limit: 2,
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});

describe('workspaceAuditLog.list — admin gate', () => {
  it('refuses a member', async () => {
    await expect(caller(memberId, workspaceId).list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Requires admin role or higher',
    });
  });

  it('refuses a caller who is not a member of the addressed workspace', async () => {
    await expect(caller(outsiderId, workspaceId).list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this workspace',
    });
  });

  it('refuses personal mode (no workspace header)', async () => {
    await expect(caller(adminId).list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows an owner', async () => {
    await expect(caller(ownerId, workspaceId).list()).resolves.toMatchObject({
      nextCursor: null,
    });
  });
});

describe('workspaceAuditLog.list — input contract', () => {
  it('keeps the declared limit bounds (1..200)', async () => {
    await expect(caller(adminId, workspaceId).list({ limit: 201 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller(adminId, workspaceId).list({ limit: 0 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller(adminId, workspaceId).list({ limit: 200 })).resolves.toBeDefined();
  });

  it('rejects an unparseable cursor or date instead of querying with an Invalid Date', async () => {
    await expect(caller(adminId, workspaceId).list({ cursor: 'not-a-date' })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
    await expect(
      caller(adminId, workspaceId).list({ startDate: '2026-13-45' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('returns real rows for an admin instead of the old always-empty stub', async () => {
    // Regression guard for the old stub: it returned `{ items: [] }` for
    // everyone, so an empty result was indistinguishable from "no logs".
    await serverDB.insert(workspaceAuditLogs).values({
      action: 'workspace.updated',
      createdAt: new Date('2026-01-01T11:00:00.000Z'),
      resourceId: 'late-row',
      resourceType: 'workspace',
      userId: adminId,
      workspaceId,
    });

    const result = await caller(adminId, workspaceId).list({ limit: 1 });
    expect(resourceIds(result.items)).toEqual(['late-row']);
  });

  it('scopes to the workspace id on the request, not one in the input', async () => {
    // The input schema has no workspaceId field at all; prove the foreign row
    // cannot be reached by smuggling one through.
    const result = await caller(adminId, workspaceId).list({
      // @ts-expect-error — not part of the contract; stripped by the schema.
      workspaceId: foreignWorkspaceId,
    });

    expect(result.items.every((item) => item.workspaceId === workspaceId)).toBe(true);
  });
});

describe('workspaceAuditLog.list — declared stub schema is preserved', () => {
  it('accepts exactly the stub fields and nothing else', () => {
    const procedure = (workspaceAuditLogRouter._def.procedures as any).list;
    const parser = procedure._def.inputs[0];
    const schema = parser instanceof z.ZodOptional ? parser.unwrap() : parser;

    expect(Object.keys(schema.shape).sort()).toEqual([
      'action',
      'cursor',
      'endDate',
      'limit',
      'q',
      'resourceType',
      'startDate',
    ]);
  });
});

describe('workspaceAuditLog router is wired to the upstream path', () => {
  it('is the re-exported upstream router (procedures mounted by apps/server)', async () => {
    const upstream =
      await import('../../../packages/business-server/src/lambda-routers/workspaceAuditLog');
    expect(upstream.workspaceAuditLogRouter).toBe(workspaceAuditLogRouter);
  });

  it('only writes rows when something else in the product writes them', async () => {
    // The router is read-only: calling `list` must never append an audit row.
    const before = await serverDB.select().from(workspaceAuditLogs);
    await caller(adminId, workspaceId).list();
    const after = await serverDB.select().from(workspaceAuditLogs);

    expect(after).toHaveLength(before.length);
  });

  it('does not expose a mutation surface', () => {
    expect(Object.keys(workspaceAuditLogRouter._def.procedures)).toEqual(['list']);
  });
});

describe('audit row fixture sanity', () => {
  it('keeps the seeded rows in the intended workspaces', async () => {
    const rows = await serverDB
      .select()
      .from(workspaceAuditLogs)
      .where(eq(workspaceAuditLogs.workspaceId, foreignWorkspaceId));

    expect(rows).toHaveLength(1);
    expect(rows[0].resourceId).toBe('foreign-row');
  });
});
