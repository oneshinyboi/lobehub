import type { WorkspaceTeamItem } from '@lobechat/database/schemas';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceMemberWithProfile } from '@/business/client/hooks/useWorkspaceMembers';

import WorkspaceTeams from './index';
import type { WorkspaceTeamDetail, WorkspaceTeamSummary } from './types';

const api = vi.hoisted(() => ({
  addMembers: vi.fn(),
  create: vi.fn(),
  createWorkspaceLambdaClient: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  removeMember: vi.fn(),
  removeTeam: vi.fn(),
  update: vi.fn(),
}));

const activeWorkspace = vi.hoisted(() => ({ value: 'ws-test' as string | null }));
const permission = vi.hoisted(() => ({ allowed: true, reason: undefined as string | undefined }));

const workspaceMembers: WorkspaceMemberWithProfile[] = [
  {
    config: {},
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    role: 'member',
    userId: 'user-alice',
    user: { email: 'alice@example.com', fullName: 'Alice', username: 'alice' },
    workspaceId: 'ws-test',
  } as unknown as WorkspaceMemberWithProfile,
  {
    config: {},
    joinedAt: new Date('2026-01-02T00:00:00.000Z'),
    role: 'member',
    userId: 'user-bob',
    user: { email: 'bob@example.com', fullName: 'Bob', username: 'bob' },
    workspaceId: 'ws-test',
  } as unknown as WorkspaceMemberWithProfile,
  {
    config: {},
    joinedAt: new Date('2026-01-03T00:00:00.000Z'),
    role: 'member',
    userId: 'user-carol',
    user: { email: 'carol@example.com', fullName: 'Carol', username: 'carol' },
    workspaceId: 'ws-test',
  } as unknown as WorkspaceMemberWithProfile,
];

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => activeWorkspace.value,
}));

vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => workspaceMembers,
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => permission }));

vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: api.createWorkspaceLambdaClient,
}));

// Count is part of every assertion that proves the round trip, so keep it in
// the mocked translation output instead of only asserting the key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { changeLanguage: vi.fn(), language: 'en-US' },
    t: (key: string, options?: { count?: number }) =>
      options && typeof options.count === 'number' ? `${key}:${options.count}` : key,
  }),
}));

const makeTeam = (overrides: Partial<WorkspaceTeamItem> = {}): WorkspaceTeamItem => ({
  avatar: null,
  createdAt: new Date('2026-02-01T10:00:00.000Z'),
  createdBy: 'user-alice',
  description: null,
  id: 'team-eng',
  identifier: 'ENG',
  name: 'Engineering',
  updatedAt: new Date('2026-02-01T10:00:00.000Z'),
  workspaceId: 'ws-test',
  ...overrides,
});

const makeDetail = (overrides: Partial<WorkspaceTeamDetail> = {}): WorkspaceTeamDetail => ({
  ...makeTeam(),
  memberCount: 2,
  members: [
    { createdAt: new Date('2026-02-02T10:00:00.000Z'), role: 'owner', userId: 'user-alice' },
    { createdAt: new Date('2026-02-02T11:00:00.000Z'), role: 'member', userId: 'user-bob' },
  ],
  ...overrides,
});

let teams: WorkspaceTeamSummary[];
let details: Record<string, WorkspaceTeamDetail>;

const seed = () => {
  const engineering = makeDetail();
  const design = makeDetail({
    ...makeTeam({
      createdAt: new Date('2026-02-03T10:00:00.000Z'),
      description: 'Design systems',
      id: 'team-design',
      identifier: 'DES',
      name: 'Design',
    }),
    memberCount: 0,
    members: [],
  });

  details = { [engineering.id]: engineering, [design.id]: design };
  teams = [engineering, design];
};

const renderPage = (initialEntry = '/settings/teams') =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<WorkspaceTeams />} path={'/settings/teams'} />
          <Route element={<WorkspaceTeams />} path={'/settings/teams/:teamId'} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  activeWorkspace.value = 'ws-test';
  permission.allowed = true;
  permission.reason = undefined;
  seed();

  api.list.mockImplementation(async () => teams);
  api.getById.mockImplementation(async ({ id }: { id: string }) => details[id]);
  api.create.mockImplementation(
    async (input: { description?: string; identifier?: string; name: string }) => {
      const created = makeTeam({
        description: input.description ?? null,
        id: `team-${details ? Object.keys(details).length + 1 : 1}`,
        identifier: input.identifier ?? 'NEW',
        name: input.name,
      });
      details[created.id] = { ...created, memberCount: 0, members: [] };
      teams = [...teams, { ...created, memberCount: 0 }];
      return created;
    },
  );
  api.update.mockImplementation(async (input: { id: string } & Partial<WorkspaceTeamItem>) => {
    const current = details[input.id];
    const next = { ...current, ...input };
    details[input.id] = next;
    teams = teams.map((team) => (team.id === input.id ? { ...team, ...input } : team));
    return next;
  });
  api.removeTeam.mockImplementation(async ({ id }: { id: string }) => {
    const removed = details[id];
    delete details[id];
    teams = teams.filter((team) => team.id !== id);
    return removed;
  });
  api.addMembers.mockImplementation(async ({ id, userIds }: { id: string; userIds: string[] }) => {
    const detail = details[id];
    const existing = new Set(detail.members.map((member) => member.userId));
    const added = userIds.filter((userId) => !existing.has(userId));
    detail.members = [
      ...detail.members,
      ...added.map((userId) => ({
        createdAt: new Date('2026-02-04T10:00:00.000Z'),
        role: 'member',
        userId,
      })),
    ];
    detail.memberCount = detail.members.length;
    teams = teams.map((team) =>
      team.id === id ? { ...team, memberCount: detail.members.length } : team,
    );
    return added;
  });
  api.removeMember.mockImplementation(async ({ id, userId }: { id: string; userId: string }) => {
    const detail = details[id];
    detail.members = detail.members.filter((member) => member.userId !== userId);
    detail.memberCount = detail.members.length;
    teams = teams.map((team) =>
      team.id === id ? { ...team, memberCount: detail.members.length } : team,
    );
    return true;
  });

  api.createWorkspaceLambdaClient.mockReturnValue({
    workspaceTeam: {
      addMembers: { mutate: api.addMembers },
      create: { mutate: api.create },
      delete: { mutate: api.removeTeam },
      getById: { query: api.getById },
      list: { query: api.list },
      removeMember: { mutate: api.removeMember },
      update: { mutate: api.update },
    },
  });
});

describe('WorkspaceTeams page', () => {
  it('creates a team, opens its detail, adds a member, and shows the new count in the list', async () => {
    renderPage();

    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.getByText('workspace.teams.members.description:2')).toBeInTheDocument();
    expect(screen.getByText('2026-02-01')).toBeInTheDocument();

    await userEvent.click(screen.getByText('workspace.teams.create.button'));

    const nameInput = await screen.findByPlaceholderText('workspace.teams.fields.namePlaceholder');
    await userEvent.type(nameInput, 'Platform');
    await userEvent.type(
      screen.getByPlaceholderText('workspace.teams.fields.identifierPlaceholder'),
      'PLT',
    );
    await userEvent.click(screen.getByText('workspace.teams.create.submit'));

    expect(await screen.findByText('Platform')).toBeInTheDocument();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'PLT', name: 'Platform' }),
    );
    expect(await screen.findByText('workspace.teams.members.empty')).toBeInTheDocument();

    await userEvent.click(screen.getByText('workspace.teams.members.add'));
    const addDialog = await screen.findByRole('dialog');
    // Candidates come from the workspace directory only.
    expect(within(addDialog).getByText('Carol')).toBeInTheDocument();
    expect(within(addDialog).getByText('Alice')).toBeInTheDocument();
    expect(within(addDialog).queryByText('user-carol')).not.toBeInTheDocument();

    await userEvent.click(within(addDialog).getByText('Carol'));
    await userEvent.click(within(addDialog).getByText('workspace.teams.members.addSubmit'));

    await waitFor(() =>
      expect(api.addMembers).toHaveBeenCalledWith({ id: 'team-3', userIds: ['user-carol'] }),
    );
    expect(await screen.findByText('workspace.teams.members.description:1')).toBeInTheDocument();

    await userEvent.click(screen.getByText('workspace.teams.backToList'));

    // List revalidates after the membership write, and the new team is present
    // with the fresh count rather than the zero it was created with.
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    expect(api.list.mock.calls.length).toBeGreaterThan(1);
    expect(screen.getAllByText('workspace.teams.members.description:1').length).toBeGreaterThan(0);
  });

  it('deletes the open team and returns to the list without its row', async () => {
    renderPage('/settings/teams/team-eng');

    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    await userEvent.click(screen.getByText('workspace.teams.delete.button'));
    await userEvent.click(await screen.findByText('workspace.teams.delete.confirm.ok'));

    expect(
      await screen.findByPlaceholderText('workspace.teams.searchPlaceholder'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Engineering')).not.toBeInTheDocument());
    expect(api.removeTeam).toHaveBeenCalledWith({ id: 'team-eng' });
    expect(await screen.findByText('Design')).toBeInTheDocument();
  });

  it('renders a read-only list and detail when the caller cannot manage settings', async () => {
    permission.allowed = false;
    permission.reason = 'workspace.permission.requiresAdmin';

    renderPage();

    const createButton = await screen.findByText('workspace.teams.create.button');
    expect(createButton.closest('button')).toBeDisabled();
    for (const edit of screen.getAllByLabelText('edit', { selector: 'button' })) {
      expect(edit).toBeDisabled();
    }
    for (const remove of screen.getAllByLabelText('workspace.teams.delete.button', {
      selector: 'button',
    })) {
      expect(remove).toBeDisabled();
    }

    await userEvent.click(screen.getByText('Engineering'));
    expect(await screen.findByText('workspace.teams.members.title')).toBeInTheDocument();
    // The membership row carries a team role; show the owning distinction when
    // it is not the default `member`.
    expect(screen.getByText('Owner')).toBeInTheDocument();

    const addButton = screen.getByText('workspace.teams.members.add').closest('button');
    expect(addButton).toBeDisabled();
    for (const remove of screen.getAllByLabelText('workspace.teams.members.remove', {
      selector: 'button',
    })) {
      expect(remove).toBeDisabled();
    }

    expect(api.create).not.toHaveBeenCalled();
    expect(api.addMembers).not.toHaveBeenCalled();
    expect(api.removeTeam).not.toHaveBeenCalled();
  });

  it('renders the not-found state for an unknown team id', async () => {
    api.getById.mockRejectedValue(new Error('not found'));

    renderPage('/settings/teams/team-missing');

    expect(await screen.findByText('workspace.teams.notFound')).toBeInTheDocument();
    expect(screen.getByText('workspace.teams.backToList')).toBeInTheDocument();
  });
});
