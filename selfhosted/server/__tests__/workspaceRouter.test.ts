// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceRouter } from '@/business/server/lambda-routers/workspace';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { agents, messages, topics, users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

// The router reaches the database through `getServerDB` (as `cloudWorkspaceAuth`
// does); point that at the real PGlite test database so every check runs
// through the production model layer instead of a hand-rolled mock.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'ws-router-owner';
const adminId = 'ws-router-admin';
const memberId = 'ws-router-member';
const viewerId = 'ws-router-viewer';
const outsiderId = 'ws-router-outsider';

const workspaceId = 'ws-router-workspace';

const caller = (userId: string, workspace?: string) =>
  workspaceRouter.createCaller({ userId, workspaceId: workspace } as never);

const seedWorkspace = async () => {
  await serverDB
    .insert(users)
    .values([
      { id: ownerId },
      { id: adminId },
      { id: memberId },
      { id: viewerId },
      { id: outsiderId },
    ]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Acme',
    primaryOwnerId: ownerId,
    settings: { theme: 'dark' },
    slug: 'acme',
  });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'admin', userId: adminId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
    { role: 'viewer', userId: viewerId, workspaceId },
  ]);
};

const seedWorkspaceContent = async () => {
  await serverDB.insert(agents).values({
    id: 'ws-router-agent',
    title: 'Shared agent',
    userId: ownerId,
    virtual: false,
    workspaceId,
  });
  await serverDB.insert(topics).values({
    agentId: 'ws-router-agent',
    id: 'ws-router-topic',
    title: 'Shared topic',
    userId: ownerId,
    workspaceId,
  });
  await serverDB.insert(messages).values([
    {
      content: 'today',
      createdAt: new Date(),
      id: 'ws-router-message-today',
      role: 'user',
      topicId: 'ws-router-topic',
      userId: ownerId,
      workspaceId,
    },
    {
      content: 'old',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      id: 'ws-router-message-old',
      role: 'assistant',
      topicId: 'ws-router-topic',
      userId: ownerId,
      workspaceId,
    },
  ]);
};

beforeAll(() => {
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(agents);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

afterEach(async () => {
  vi.mocked(getServerDB).mockClear();
});

describe('workspaceRouter.create / list', () => {
  it('create followed by list returns the new workspace with the owner role', async () => {
    await serverDB.insert(users).values({ id: ownerId });

    const created = await caller(ownerId).create({ name: 'Acme', slug: 'acme' });

    expect(created).toMatchObject({ name: 'Acme', slug: 'acme' });

    const listed = await caller(ownerId).list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: created.id,
      name: 'Acme',
      role: 'owner',
      slug: 'acme',
    });

    // Billing fields stay absent — they are out of scope for this build.
    expect(listed[0]).not.toHaveProperty('plan');
    expect(listed[0]).not.toHaveProperty('lockedOut');

    // The owner membership was written by `WorkspaceModel.create` itself.
    const memberships = await serverDB
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, created.id));
    expect(memberships).toMatchObject([{ role: 'owner', userId: ownerId }]);
  });

  it('lists every workspace the caller joined with that workspace role', async () => {
    await seedWorkspace();

    const listed = await caller(memberId).list();

    expect(listed).toMatchObject([{ id: workspaceId, role: 'member', slug: 'acme' }]);
  });
});

describe('workspaceRouter.checkSlugAvailable', () => {
  it('reports an unclaimed slug as available', async () => {
    await expect(caller(ownerId).checkSlugAvailable({ slug: 'fresh-slug' })).resolves.toEqual({
      available: true,
    });
  });

  it('reports a taken slug as unavailable', async () => {
    await seedWorkspace();

    await expect(caller(memberId).checkSlugAvailable({ slug: 'acme' })).resolves.toEqual({
      available: false,
    });
  });

  it('rejects a too-short slug with a length error', async () => {
    await expect(caller(ownerId).checkSlugAvailable({ slug: 'ab' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects an invalid-format slug with the distinct invalid-slug error', async () => {
    await expect(caller(ownerId).checkSlugAvailable({ slug: 'Bad_Slug' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'invalid-slug',
    });
  });
});

describe('workspaceRouter.create — slug validation', () => {
  it('rejects a too-short slug before touching the database', async () => {
    await expect(caller(ownerId).create({ name: 'Acme', slug: 'ab' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects an invalid-format slug', async () => {
    await expect(caller(ownerId).create({ name: 'Acme', slug: 'Acme Workspace' })).rejects.toThrow(
      /invalid-slug/,
    );
  });

  it('rejects a taken slug with a conflict, distinct from the format errors', async () => {
    await seedWorkspace();

    await expect(caller(ownerId).create({ name: 'Other', slug: 'acme' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Workspace slug is already taken',
    });
  });
});

describe('workspaceRouter membership gates', () => {
  it('returns the workspace to a member and null in personal mode', async () => {
    await seedWorkspace();

    await expect(caller(memberId, workspaceId).getById()).resolves.toMatchObject({
      id: workspaceId,
      slug: 'acme',
    });
    await expect(caller(memberId).getById()).resolves.toBeNull();
  });

  it('refuses a non-member on getById', async () => {
    await seedWorkspace();

    await expect(caller(outsiderId, workspaceId).getById()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this workspace',
    });
  });

  it('refuses a non-member on update', async () => {
    await seedWorkspace();

    await expect(
      caller(outsiderId, workspaceId).update({ name: 'Hijacked' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const [row] = await serverDB
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    expect(row.name).toBe('Acme');
  });

  it('refuses a plain member on update and allows an admin', async () => {
    await seedWorkspace();

    await expect(caller(memberId, workspaceId).update({ name: 'Hijacked' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Requires admin role or higher',
    });

    await expect(caller(adminId, workspaceId).update({ name: 'Acme 2' })).resolves.toBeUndefined();

    const [row] = await serverDB
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    expect(row.name).toBe('Acme 2');
  });

  it('refuses a non-member on getSettings but serves it to a member', async () => {
    await seedWorkspace();

    await expect(caller(outsiderId, workspaceId).getSettings()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller(memberId, workspaceId).getSettings()).resolves.toEqual({ theme: 'dark' });
  });

  it('lets a viewer read the workspace settings and statistics', async () => {
    await seedWorkspace();

    // A viewer is still an active member: reading must not require the
    // `member` role, only membership (CONTEXT.md D4 orders viewer < member).
    await expect(caller(viewerId, workspaceId).getSettings()).resolves.toEqual({ theme: 'dark' });
    await expect(caller(viewerId, workspaceId).getMyStatistics({})).resolves.toMatchObject({
      agents: 0,
      messages: 0,
      topics: 0,
    });
  });

  it('refuses a member on update when renaming the slug to another workspace slug', async () => {
    await seedWorkspace();
    await serverDB.insert(users).values({ id: 'ws-router-other-owner' });
    await serverDB.insert(workspaces).values({
      id: 'ws-router-other-workspace',
      name: 'Other',
      primaryOwnerId: 'ws-router-other-owner',
      slug: 'other',
    });

    await expect(caller(adminId, workspaceId).update({ slug: 'other' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Workspace slug is already taken',
    });

    // Keeping the current slug is not a conflict with itself.
    await expect(caller(adminId, workspaceId).update({ slug: 'acme' })).resolves.toBeUndefined();
  });
});

describe('workspaceRouter statistics', () => {
  it('counts workspace agents, topics and messages (today included)', async () => {
    await seedWorkspace();
    await seedWorkspaceContent();

    const todayStartAt = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

    await expect(caller(adminId, workspaceId).getStatistics({ todayStartAt })).resolves.toEqual({
      agents: 1,
      messages: 2,
      messagesToday: 1,
      topics: 1,
    });

    await expect(caller(memberId, workspaceId).getMyStatistics({ todayStartAt })).resolves.toEqual({
      agents: 1,
      messages: 2,
      messagesToday: 1,
      topics: 1,
    });
  });

  it('reserves workspace-wide statistics for admins', async () => {
    await seedWorkspace();

    await expect(caller(memberId, workspaceId).getStatistics({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Requires admin role or higher',
    });

    await expect(caller(outsiderId, workspaceId).getMyStatistics({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
