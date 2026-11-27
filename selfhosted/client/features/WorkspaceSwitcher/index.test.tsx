/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore, type WorkspaceListItem } from '../../store/workspace';
import UserPanelWorkspaceSection from './index';

const mocks = vi.hoisted(() => ({
  openCreate: vi.fn(),
  switchToPersonal: vi.fn(),
  switchWorkspace: vi.fn(),
  workspaces: [] as WorkspaceListItem[],
}));

vi.mock('../../hooks/useWorkspaces', () => ({ useWorkspaces: () => mocks.workspaces }));

vi.mock('../../hooks/useSwitchWorkspace', () => ({
  useSwitchWorkspace: () => ({
    switchToPersonal: mocks.switchToPersonal,
    switchWorkspace: mocks.switchWorkspace,
  }),
}));

vi.mock('./CreateWorkspaceModal', () => ({
  openCreateWorkspaceModal: mocks.openCreate,
}));

const workspace = (overrides: Partial<WorkspaceListItem>): WorkspaceListItem =>
  ({ id: 'ws-1', name: 'Acme', role: 'owner', slug: 'acme', ...overrides }) as WorkspaceListItem;

const setScope = (params: {
  activeWorkspaceId: null | string;
  isLoading?: boolean;
  workspaces: WorkspaceListItem[];
}) =>
  useWorkspaceStore.setState({
    activeWorkspaceId: params.activeWorkspaceId,
    isWorkspaceListLoaded: !params.isLoading,
    isWorkspaceLoading: params.isLoading ?? false,
    workspaces: params.workspaces,
  });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.workspaces = [];
  setScope({ activeWorkspaceId: null, workspaces: [] });
});

describe('UserPanelWorkspaceSection', () => {
  it('renders the zero-workspace empty state with the create entry and no workspace rows', () => {
    const onSwitch = vi.fn();

    render(<UserPanelWorkspaceSection onSwitch={onSwitch} />);

    // Personal mode stays reachable, but no workspace row exists to switch to.
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Create workspace')).toBeInTheDocument();
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Create workspace'));
    expect(mocks.openCreate).toHaveBeenCalledWith({ onCreated: onSwitch });
  });

  it('keeps the same rows while the list is loading, so the panel does not jump', () => {
    setScope({ activeWorkspaceId: null, isLoading: true, workspaces: [] });

    render(<UserPanelWorkspaceSection />);

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Create workspace')).toBeInTheDocument();
  });

  it('shows one row per workspace with the membership role and switches on click', () => {
    mocks.workspaces = [
      workspace({ id: 'ws-1', name: 'Acme', role: 'owner', slug: 'acme' }),
      workspace({ id: 'ws-2', name: 'Design', role: 'member', slug: 'design' }),
    ];
    setScope({ activeWorkspaceId: 'ws-2', workspaces: mocks.workspaces });
    const onSwitch = vi.fn();

    render(<UserPanelWorkspaceSection onSwitch={onSwitch} />);

    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();

    // The active workspace is marked, personal is not.
    expect(screen.getByRole('button', { name: /Design/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Personal/ })).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByText('Acme'));
    expect(mocks.switchWorkspace).toHaveBeenCalledWith('ws-1');
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it('switches back to personal scope', () => {
    mocks.workspaces = [workspace({ id: 'ws-1' })];
    setScope({ activeWorkspaceId: 'ws-1', workspaces: mocks.workspaces });
    const onSwitch = vi.fn();

    render(<UserPanelWorkspaceSection onSwitch={onSwitch} />);

    fireEvent.click(screen.getByText('Personal'));

    expect(mocks.switchToPersonal).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});
