// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { resourcePermissions, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { LEGACY_PUBLIC_ACCESS_LEVEL, ResourcePermissionModel } from '../resourcePermission';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'rp-test-owner';
const wsId = 'rp-test-ws';
const wsId2 = 'rp-test-ws-2';
const agentId = 'rp-test-agent';

const model = new ResourcePermissionModel(serverDB, wsId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
  await serverDB.insert(users).values([{ fullName: 'Owner', id: ownerId }]);
  await serverDB.insert(workspaces).values([
    { id: wsId, name: 'WS', primaryOwnerId: ownerId, slug: 'rp-ws' },
    { id: wsId2, name: 'WS2', primaryOwnerId: ownerId, slug: 'rp-ws-2' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(resourcePermissions);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('ResourcePermissionModel', () => {
  it('falls back to edit for a legacy public resource without a row', async () => {
    expect(await model.getAccessLevel('agent', agentId)).toBeNull();
    expect(await model.getEffectiveAccessLevel('agent', agentId)).toBe(LEGACY_PUBLIC_ACCESS_LEVEL);
  });

  it.each(['view', 'use', 'edit'] as const)('explicitly stores %s access', async (accessLevel) => {
    await model.setAccessLevel('agent', agentId, accessLevel, ownerId);

    expect(await model.getAccessLevel('agent', agentId)).toBe(accessLevel);
    expect(await model.getEffectiveAccessLevel('agent', agentId)).toBe(accessLevel);
  });

  it('keeps an explicit row when setting edit', async () => {
    await model.setAccessLevel('agent', agentId, 'view', ownerId);
    await model.setAccessLevel('agent', agentId, 'edit', ownerId);

    expect(await model.getAccessLevel('agent', agentId)).toBe('edit');
    const rows = await serverDB.select().from(resourcePermissions);
    expect(rows).toHaveLength(1);
  });

  it('set is idempotent and updates the access level on conflict', async () => {
    await model.setAccessLevel('agent', agentId, 'view', ownerId);
    await model.setAccessLevel('agent', agentId, 'use', ownerId);

    expect(await model.getAccessLevel('agent', agentId)).toBe('use');
    const rows = await serverDB.select().from(resourcePermissions);
    expect(rows).toHaveLength(1);
  });

  it('is isolated per workspace and per resource type', async () => {
    await model.setAccessLevel('agent', agentId, 'view', ownerId);

    const otherWs = new ResourcePermissionModel(serverDB, wsId2);
    expect(await otherWs.getAccessLevel('agent', agentId)).toBeNull();
    expect(await model.getAccessLevel('agentGroup', agentId)).toBeNull();
  });

  it('removeAll clears every row of a resource', async () => {
    await model.setAccessLevel('agent', agentId, 'view', ownerId);
    await model.removeAll('agent', agentId);

    expect(await model.getAccessLevel('agent', agentId)).toBeNull();
  });
});
