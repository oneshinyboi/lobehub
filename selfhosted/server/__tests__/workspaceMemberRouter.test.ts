// @vitest-environment node
import { INVITATION_EXPIRY_DAYS } from '@lobechat/const';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceMemberRouter } from '@/business/server/lambda-routers/workspaceMember';
import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { users, workspaceInvitations, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { INVITATION_ERROR } from '@/selfhosted/client/features/InviteAccept/errors';

// The router reaches the database through `getServerDB`; point that at the real
// (PGlite) test database so every assertion below runs the actual data layer.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'wm-router-owner';
const adminId = 'wm-router-admin';
const memberId = 'wm-router-member';
const viewerId = 'wm-router-viewer';
const outsiderId = 'wm-router-outsider';
const applicantId = 'wm-router-applicant';
const secondApplicantId = 'wm-router-second-applicant';

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
      { email: 'applicant@example.com', id: applicantId },
      { email: 'second-applicant@example.com', id: secondApplicantId },
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

describe('workspaceMemberRouter — acceptInvitation', () => {
  const captureError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as { code?: string; message?: string };
    }

    throw new Error('Expected the invitation to be rejected');
  };

  const memberRows = async (userId: string) =>
    (await new WorkspaceMemberModel(serverDB, userId).listMembers(workspaceId)).filter(
      (member) => member.userId === userId,
    );

  it('lets an invited second user join at the invited role', async () => {
    const invitation = await caller(ownerId, workspaceId).createInviteLink({ role: 'admin' });

    const accepted = await caller(applicantId).acceptInvitation({ token: invitation.token });

    expect(accepted.alreadyMember).toBe(false);
    expect(accepted.membership).toMatchObject({
      role: 'admin',
      userId: applicantId,
      workspaceId,
    });
    expect(accepted.workspace).toMatchObject({ id: workspaceId, slug: 'acme' });

    const stored = await new WorkspaceMemberModel(serverDB, applicantId).getMember(
      workspaceId,
      applicantId,
    );
    expect(stored?.role).toBe('admin');
    // The reusable link stays live for the next invitee.
    const stillPending = await new WorkspaceMemberModel(serverDB, ownerId).findInvitationByToken(
      invitation.token,
    );
    expect(stillPending?.status).toBe('pending');
  });

  it('is idempotent: accepting twice returns the same membership and writes no duplicate', async () => {
    const invitation = await caller(ownerId, workspaceId).createInviteLink({ role: 'viewer' });

    const first = await caller(applicantId).acceptInvitation({ token: invitation.token });
    const second = await caller(applicantId).acceptInvitation({ token: invitation.token });

    expect(first.alreadyMember).toBe(false);
    expect(second.alreadyMember).toBe(true);
    expect(second.membership.id).toBe(first.membership.id);
    expect(second.membership.role).toBe('viewer');
    expect(await memberRows(applicantId)).toHaveLength(1);
  });

  it('returns the existing membership to an already-member caller instead of a revoked error', async () => {
    const invitation = await caller(ownerId, workspaceId).createInviteLink({});
    await caller(ownerId, workspaceId).revokeInviteLink({ id: invitation.id });

    const accepted = await caller(memberId).acceptInvitation({ token: invitation.token });

    expect(accepted.alreadyMember).toBe(true);
    expect(accepted.membership).toMatchObject({ role: 'member', userId: memberId });
  });

  it('rejects an expired token with its own reason and never names the workspace', async () => {
    await serverDB.insert(workspaceInvitations).values({
      expiresAt: new Date(Date.now() - 60_000),
      inviterId: ownerId,
      role: 'member',
      token: 'expired-link-token',
      workspaceId,
    });

    const error = await captureError(
      caller(applicantId).acceptInvitation({ token: 'expired-link-token' }),
    );

    expect(error).toMatchObject({ code: 'BAD_REQUEST', message: INVITATION_ERROR.EXPIRED });
    expect(error.message).not.toContain('Acme');
    expect(error.message).not.toContain('acme');
    expect(error.message).not.toContain(workspaceId);
  });

  it('rejects a revoked token with a different reason from an expired one', async () => {
    const invitation = await caller(ownerId, workspaceId).createInviteLink({});
    await caller(ownerId, workspaceId).revokeInviteLink({ id: invitation.id });

    const error = await captureError(
      caller(applicantId).acceptInvitation({ token: invitation.token }),
    );

    expect(error).toMatchObject({ code: 'BAD_REQUEST', message: INVITATION_ERROR.REVOKED });
    expect(error.message).not.toBe(INVITATION_ERROR.EXPIRED);
    expect(error.message).not.toContain('Acme');
    expect(error.message).not.toContain(workspaceId);
  });

  it('rejects an unknown token without revealing any workspace', async () => {
    const error = await captureError(
      caller(applicantId).acceptInvitation({ token: 'not-a-real-token' }),
    );

    expect(error).toMatchObject({ code: 'NOT_FOUND', message: INVITATION_ERROR.NOT_FOUND });
    expect(error.message).not.toContain('Acme');
    expect(error.message).not.toContain(workspaceId);
  });

  it('consumes a single-use invitation, then refuses a second account as already used', async () => {
    const invitation = await caller(ownerId, workspaceId).invite({ role: 'viewer' });

    const accepted = await caller(applicantId).acceptInvitation({ token: invitation.token });
    expect(accepted.membership.role).toBe('viewer');

    const stored = await new WorkspaceMemberModel(serverDB, ownerId).findInvitationByToken(
      invitation.token,
    );
    expect(stored?.status).toBe('accepted');

    const error = await captureError(
      caller(secondApplicantId).acceptInvitation({ token: invitation.token }),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', message: INVITATION_ERROR.USED });
    // The second account got no membership.
    expect(await memberRows(secondApplicantId)).toHaveLength(0);
  });

  it('lets several accounts use one reusable link', async () => {
    const invitation = await caller(ownerId, workspaceId).createInviteLink({ role: 'member' });

    await caller(applicantId).acceptInvitation({ token: invitation.token });
    await caller(secondApplicantId).acceptInvitation({ token: invitation.token });

    expect((await memberRows(applicantId))[0]?.role).toBe('member');
    expect((await memberRows(secondApplicantId))[0]?.role).toBe('member');
  });

  it('refuses an invitation addressed to a different account', async () => {
    const invitation = await caller(ownerId, workspaceId).invite({
      email: 'applicant@example.com',
    });

    const error = await captureError(
      caller(secondApplicantId).acceptInvitation({ token: invitation.token }),
    );

    expect(error).toMatchObject({ code: 'FORBIDDEN', message: INVITATION_ERROR.WRONG_ACCOUNT });
    expect(error.message).not.toContain('Acme');
    expect(await memberRows(secondApplicantId)).toHaveLength(0);

    // The intended recipient (case-insensitive match) can still redeem it.
    const accepted = await caller(applicantId).acceptInvitation({ token: invitation.token });
    expect(accepted.membership.role).toBe('member');
  });

  it('requires a signed-in caller', async () => {
    const invitation = await caller(ownerId, workspaceId).createInviteLink({});

    const error = await captureError(
      workspaceMemberRouter.createCaller({} as never).acceptInvitation({ token: invitation.token }),
    );

    expect(error).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
