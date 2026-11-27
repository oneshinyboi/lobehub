// @vitest-environment node
import { INVITATION_EXPIRY_DAYS } from '@lobechat/const';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceMemberRouter } from '@/business/server/lambda-routers/workspaceMember';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { users, workspaceInvitations, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

// The router reaches the database through `getServerDB`; point that at the real
// (PGlite) test database so every assertion below runs the actual data layer.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'wm-router-owner';
const adminId = 'wm-router-admin';
const memberId = 'wm-router-member';
const viewerId = 'wm-router-viewer';
const outsiderId = 'wm-router-outsider';

const workspaceId = 'wm-router-workspace';
const otherWorkspaceId = 'wm-router-other-workspace';

const originalAppUrl = process.env.APP_URL;
const appUrl = 'https://chat.selfhosted.test';

const caller = (userId: string, workspace?: string) =>
  workspaceMemberRouter.createCaller({ userId, workspaceId: workspace } as never);

beforeAll(() => {
  process.env.APP_URL = appUrl;
  vi.mocked(getServerDB).mockResolvedValue(serverDB);
});

beforeEach(async () => {
  await serverDB.delete(workspaceInvitations);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([
      { id: ownerId },
      { id: adminId },
      { id: memberId },
      { id: viewerId },
      { id: outsiderId },
    ]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Acme', primaryOwnerId: ownerId, slug: 'acme' },
    { id: otherWorkspaceId, name: 'Other', primaryOwnerId: outsiderId, slug: 'other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'admin', userId: adminId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
    { role: 'viewer', userId: viewerId, workspaceId },
    { role: 'owner', userId: outsiderId, workspaceId: otherWorkspaceId },
  ]);
});

afterEach(() => {
  vi.mocked(getServerDB).mockClear();
});

afterAll(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

/** The same gate the accept flow (WS-8) will apply to a token. */
const tokenIsUsable = async (token: string) => {
  const invitation = await new WorkspaceMemberModel(serverDB, ownerId).findInvitationByToken(token);

  if (!invitation || invitation.status !== 'pending') return false;
  if (invitation.expiresAt && invitation.expiresAt.getTime() <= Date.now()) return false;
  return true;
};

describe('workspaceMemberRouter — link invitations', () => {
  it('lets an owner create a link whose URL carries the token and whose expiry comes from the constant', async () => {
    const startedAt = new Date();

    const invitation = await caller(ownerId, workspaceId).createInviteLink({ role: 'viewer' });

    expect(invitation).toMatchObject({
      reusable: true,
      role: 'viewer',
      status: 'pending',
    });
    expect(invitation.token).toHaveLength(32);
    expect(invitation.url).toBe(`${appUrl}/invite/${invitation.token}`);

    const expected = new Date(startedAt);
    expected.setDate(expected.getDate() + INVITATION_EXPIRY_DAYS);
    expect(invitation.expiresAt).not.toBeNull();
    expect(Math.abs(invitation.expiresAt!.getTime() - expected.getTime())).toBeLessThan(5_000);
  });

  it('lets an admin (not just the owner) create and revoke a link', async () => {
    const invitation = await caller(adminId, workspaceId).createInviteLink({});

    expect(invitation.role).toBe('member');

    await expect(
      caller(adminId, workspaceId).revokeInviteLink({ id: invitation.id }),
    ).resolves.toEqual({ revoked: true });
  });

  it('lists only live links, newest first', async () => {
    const first = await caller(ownerId, workspaceId).createInviteLink({});
    const second = await caller(ownerId, workspaceId).createInviteLink({ role: 'admin' });

    const links = await caller(ownerId, workspaceId).listInviteLinks();

    expect(links.map((link) => link.id)).toEqual([second.id, first.id]);
    expect(links.every((link) => link.url.includes(link.token))).toBe(true);
  });

  it('refuses a plain member and a viewer on every invitation surface', async () => {
    for (const userId of [memberId, viewerId]) {
      await expect(caller(userId, workspaceId).createInviteLink({})).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Requires admin role or higher',
      });
      await expect(caller(userId, workspaceId).listInviteLinks()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        caller(userId, workspaceId).revokeInviteLink({ id: 'anything' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(userId, workspaceId).listInvitations()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        caller(userId, workspaceId).invite({ email: 'someone@example.com' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('refuses an unscoped call instead of falling back to a personal workspace', async () => {
    await expect(caller(ownerId).createInviteLink({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('revoking makes the token unusable and removes it from the live list', async () => {
    const invitation = await caller(ownerId, workspaceId).createInviteLink({});

    await expect(tokenIsUsable(invitation.token)).resolves.toBe(true);

    await expect(
      caller(ownerId, workspaceId).revokeInviteLink({ id: invitation.id }),
    ).resolves.toEqual({ revoked: true });

    // The token no longer satisfies the accept gate, and a second revoke is a no-op.
    await expect(tokenIsUsable(invitation.token)).resolves.toBe(false);
    await expect(
      caller(ownerId, workspaceId).revokeInviteLink({ id: invitation.id }),
    ).resolves.toEqual({ revoked: false });

    const links = await caller(ownerId, workspaceId).listInviteLinks();
    expect(links).toEqual([]);

    const stored = await new WorkspaceMemberModel(serverDB, ownerId).findInvitationByToken(
      invitation.token,
    );
    expect(stored?.status).toBe('revoked');
  });

  it('cannot revoke another workspace’s link', async () => {
    const invitation = await caller(ownerId, workspaceId).createInviteLink({});

    await expect(
      caller(outsiderId, otherWorkspaceId).revokeInviteLink({ id: invitation.id }),
    ).resolves.toEqual({ revoked: false });

    await expect(tokenIsUsable(invitation.token)).resolves.toBe(true);
  });
});

describe('workspaceMemberRouter — legacy invite and pending invitations', () => {
  it('creates a single-use invitation with the constant expiry and a copyable URL, without sending mail', async () => {
    const startedAt = new Date();

    const invitation = await caller(ownerId, workspaceId).invite({
      email: 'new@example.com',
      role: 'member',
    });

    expect(invitation).toMatchObject({
      email: 'new@example.com',
      reusable: false,
      role: 'member',
      status: 'pending',
    });
    expect(invitation.url).toBe(`${appUrl}/invite/${invitation.token}`);

    const expected = new Date(startedAt);
    expected.setDate(expected.getDate() + INVITATION_EXPIRY_DAYS);
    expect(Math.abs(invitation.expiresAt!.getTime() - expected.getTime())).toBeLessThan(5_000);
  });

  it('lists pending single-use invitations but not reusable links', async () => {
    const pending = await caller(ownerId, workspaceId).invite({ email: 'a@example.com' });
    await caller(ownerId, workspaceId).createInviteLink({});

    const invitations = await caller(ownerId, workspaceId).listInvitations();

    expect(invitations.map((invitation) => invitation.id)).toEqual([pending.id]);
  });
});
