import { render, screen, waitFor } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import { useWorkspaceStore } from '../../store/workspace';
import { INVITATION_ERROR } from './errors';
import InviteAccept from './index';

const accept = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ token: 'tok_123' as string | undefined }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { workspaceMember: { acceptInvitation: { mutate: accept } } },
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return { ...actual, useNavigate: () => navigate, useParams: () => params };
});

const accepted = {
  alreadyMember: false,
  membership: { id: 'member-1', role: 'admin', userId: 'user-1', workspaceId: 'ws-1' },
  workspace: { id: 'ws-1', name: 'Acme', slug: 'acme' },
};

beforeEach(() => {
  vi.clearAllMocks();
  params.token = 'tok_123';
  localStorage.clear();
  useUserStore.setState({ isSignedIn: true });
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    isWorkspaceListLoaded: false,
    isWorkspaceLoading: false,
    workspaces: [],
  });
});

describe('InviteAccept page', () => {
  it('sends a signed-out visitor to sign in and returns to the same token URL', () => {
    useUserStore.setState({ isSignedIn: false });

    render(<InviteAccept />);

    const signIn = screen.getByText('Sign in to accept');
    expect(signIn).toHaveAttribute(
      'href',
      `/signin?callbackUrl=${encodeURIComponent('/invite/tok_123')}`,
    );
    expect(accept).not.toHaveBeenCalled();
  });

  it('accepts once, seeds the workspace store and lands on the workspace home', async () => {
    accept.mockResolvedValue(accepted);

    render(<InviteAccept />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/acme', { replace: true }));

    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith({ token: 'tok_123' });
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    expect(useWorkspaceStore.getState().workspaces).toEqual([
      expect.objectContaining({ id: 'ws-1', role: 'admin', slug: 'acme' }),
    ]);
    expect(localStorage.getItem('lobehub:active-workspace-id')).toBe('ws-1');
  });

  it('does not submit a second time when the page re-renders', async () => {
    accept.mockResolvedValue(accepted);

    const view = render(<InviteAccept />);
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    view.rerender(<InviteAccept />);

    expect(accept).toHaveBeenCalledTimes(1);
  });

  it.each([
    [INVITATION_ERROR.EXPIRED, 'This invitation has expired'],
    [INVITATION_ERROR.REVOKED, 'This invitation was revoked'],
    [INVITATION_ERROR.USED, 'This invitation has already been used'],
    [INVITATION_ERROR.WRONG_ACCOUNT, 'This invitation is for a different account'],
    [INVITATION_ERROR.NOT_FOUND, 'This invitation link is not valid'],
  ])('renders distinct copy for %s', async (code, title) => {
    accept.mockRejectedValue(new TRPCClientError(code));

    render(<InviteAccept />);

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('falls back to the generic failure copy for an unrecognised error', async () => {
    accept.mockRejectedValue(new Error('network down'));

    render(<InviteAccept />);

    expect(await screen.findByText('We could not accept this invitation')).toBeInTheDocument();
  });

  it('shows an invalid-link message when the route carries no token', () => {
    params.token = undefined;

    render(<InviteAccept />);

    expect(screen.getByText('This invitation link is not valid')).toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
  });
});
