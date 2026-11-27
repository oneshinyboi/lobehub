/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWorkspaceMemberName } from '@/utils/workspaceMemberName';

import { useWorkspaceStore } from '../../store/workspace';
import { useFetchWorkspaceMembers } from '../useFetchWorkspaceMembers';
import { useWorkspaceMemberProfiles } from '../useWorkspaceMemberProfiles';
import { getWorkspaceMembers, useWorkspaceMembers } from '../useWorkspaceMembers';
import { memberSnapshots } from '../workspaceMemberIdentity';

const { listQuery, memberClient } = vi.hoisted(() => {
  const query = vi.fn();
  return { listQuery: query, memberClient: { workspaceMember: { list: { query } } } };
});

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: memberClient,
  scopedLambdaClient: () => memberClient,
}));

const resetStore = () => {
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    isWorkspaceListLoaded: false,
    isWorkspaceLoading: false,
    workspaces: [],
  });
};

type RowOptions = {
  avatar?: string | null;
  email?: string | null;
  fullName?: string | null;
  nickname?: string | null;
  username?: string | null;
};

const row = (userId: string, options: RowOptions = {}) =>
  ({
    config: options.nickname ? { nickname: options.nickname } : {},
    deletedAt: null,
    joinedAt: new Date(),
    role: 'member',
    title: null,
    responsibilities: null,
    updatedAt: new Date(),
    userId,
    workspaceId: 'ws-1',
    user: {
      avatar: options.avatar ?? null,
      email: options.email ?? null,
      fullName: options.fullName ?? null,
      username: options.username ?? null,
    },
  }) as never;

beforeEach(async () => {
  listQuery.mockReset();
  memberSnapshots.clear();
  resetStore();
  await mutate(() => true, undefined, { revalidate: false });
});

describe('useWorkspaceMembers — personal mode', () => {
  it('returns an empty list and an empty profile map, and never issues a request', async () => {
    const { result } = renderHook(() => ({
      members: useWorkspaceMembers(),
      profiles: useWorkspaceMemberProfiles(),
    }));

    expect(result.current.members).toEqual([]);
    expect(result.current.profiles.size).toBe(0);
    // Give SWR a tick to prove the null key really skipped the fetch.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listQuery).not.toHaveBeenCalled();
    expect(getWorkspaceMembers()).toEqual([]);
  });

  it('stays empty without a request when the host disables the fetch', async () => {
    act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-1'));

    const { result } = renderHook(() => useFetchWorkspaceMembers({ enabled: false }));

    expect(result.current.data).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listQuery).not.toHaveBeenCalled();
  });
});

describe('useWorkspaceMembers — active workspace', () => {
  it('returns membership rows enriched with profile, honouring the nickname', async () => {
    listQuery.mockResolvedValue([
      row('user-dee', {
        avatar: 'avatar-dee.png',
        email: 'dee@example.com',
        fullName: 'Dee Account',
        nickname: 'Dee (Ops)',
        username: 'dee',
      }),
      row('user-bob', {
        email: 'bob@example.com',
        fullName: 'Bob Account',
        username: 'bob',
      }),
    ]);
    act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-1'));

    const { result } = renderHook(() => ({
      members: useWorkspaceMembers(),
      profiles: useWorkspaceMemberProfiles(),
    }));

    await waitFor(() => expect(result.current.members).toHaveLength(2));

    const [dee, bob] = result.current.members;

    // Nickname wins over the account name for every label surface, including
    // callers that only read `user`.
    expect(dee.config.nickname).toBe('Dee (Ops)');
    expect(dee.user?.fullName).toBe('Dee (Ops)');
    expect(getWorkspaceMemberName(dee)).toBe('Dee (Ops)');
    expect(getWorkspaceMemberName(bob)).toBe('Bob Account');

    expect(result.current.profiles.get('user-dee')).toEqual({
      avatar: 'avatar-dee.png',
      fullName: 'Dee (Ops)',
      username: 'dee',
    });
    expect(result.current.profiles.get('user-bob')).toEqual({
      avatar: null,
      fullName: 'Bob Account',
      username: 'bob',
    });

    // The imperative snapshot is the same list, so the task tool executor
    // labels members the same way.
    expect(getWorkspaceMembers()).toEqual(result.current.members);
    expect(listQuery).toHaveBeenCalledWith({ includeDeleted: false });
  });

  it('keeps a separate roster and snapshot per workspace', async () => {
    listQuery.mockImplementation(({ includeDeleted }) => {
      expect(includeDeleted).toBe(false);
      return Promise.resolve([
        row(useWorkspaceStore.getState().activeWorkspaceId === 'ws-1' ? 'user-1' : 'user-2', {
          fullName: useWorkspaceStore.getState().activeWorkspaceId === 'ws-1' ? 'One' : 'Two',
        }),
      ]);
    });

    act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-1'));
    const { result } = renderHook(() => useWorkspaceMembers());
    await waitFor(() => expect(result.current.map((m) => m.userId)).toEqual(['user-1']));
    expect(getWorkspaceMembers().map((m) => m.userId)).toEqual(['user-1']);

    act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-2'));
    await waitFor(() => expect(result.current.map((m) => m.userId)).toEqual(['user-2']));
    expect(getWorkspaceMembers().map((m) => m.userId)).toEqual(['user-2']);
  });

  it('forwards includeDeleted and keeps the active-only snapshot intact', async () => {
    listQuery.mockResolvedValue([
      row('user-1', { fullName: 'One' }),
      { ...row('user-gone', { fullName: 'Gone' }), deletedAt: new Date() } as never,
    ]);
    act(() => useWorkspaceStore.getState().setActiveWorkspaceId('ws-1'));

    renderHook(() => useFetchWorkspaceMembers({ includeDeleted: true }));
    await waitFor(() => expect(listQuery).toHaveBeenCalledWith({ includeDeleted: true }));

    // A settings read must not replace the roster tool executors use.
    expect(getWorkspaceMembers()).toEqual([]);
  });
});
