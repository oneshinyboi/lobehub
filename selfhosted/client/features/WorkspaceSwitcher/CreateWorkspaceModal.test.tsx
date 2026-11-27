/**
 * @vitest-environment happy-dom
 */
import type * as LobeUI from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '../../store/workspace';
import CreateWorkspaceModal from './CreateWorkspaceModal';

const mocks = vi.hoisted(() => ({
  checkSlug: vi.fn(),
  close: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeUI>();

  return {
    ...actual,
    useModalContext: () => ({ close: mocks.close }),
  };
});

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    workspace: {
      checkSlugAvailable: { query: mocks.checkSlug },
      create: { mutate: mocks.create },
    },
  },
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return { ...actual, useNavigate: () => mocks.navigate };
});

const created = {
  avatar: null,
  description: null,
  id: 'ws-new',
  name: 'Acme Team',
  primaryOwnerId: 'user-1',
  settings: {},
  slug: 'acme-team',
} as never;

const nameInput = () => screen.getByPlaceholderText('e.g. Design team');
const slugInput = () => screen.getByPlaceholderText('design-team');
const submit = () => screen.getByRole('button', { name: 'Create workspace' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.checkSlug.mockResolvedValue({ available: true });
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    isWorkspaceListLoaded: true,
    isWorkspaceLoading: false,
    workspaces: [],
  });
});

describe('CreateWorkspaceModal', () => {
  it('derives an editable slug, checks availability and lands in the new workspace as owner', async () => {
    mocks.create.mockResolvedValue(created);
    const onCreated = vi.fn();

    render(<CreateWorkspaceModal onCreated={onCreated} />);

    fireEvent.change(nameInput(), { target: { value: 'Acme Team' } });

    expect(slugInput()).toHaveValue('acme-team');

    await waitFor(() => expect(mocks.checkSlug).toHaveBeenCalledWith({ slug: 'acme-team' }));
    expect(await screen.findByText('This URL is available.')).toBeInTheDocument();

    fireEvent.click(submit());

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/acme-team'));

    expect(mocks.create).toHaveBeenCalledWith({ name: 'Acme Team', slug: 'acme-team' });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);

    // The store is seeded before navigation so the slug route resolves, and the
    // row already claims the owner role the server just wrote.
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-new');
    expect(useWorkspaceStore.getState().workspaces).toEqual([
      expect.objectContaining({ id: 'ws-new', role: 'owner', slug: 'acme-team' }),
    ]);
    expect(localStorage.getItem('lobehub:active-workspace-id')).toBe('ws-new');
  });

  it('keeps a manually edited slug when the name changes afterwards', async () => {
    render(<CreateWorkspaceModal />);

    fireEvent.change(nameInput(), { target: { value: 'Acme Team' } });
    fireEvent.change(slugInput(), { target: { value: 'custom-slug' } });
    fireEvent.change(nameInput(), { target: { value: 'Another name' } });

    expect(slugInput()).toHaveValue('custom-slug');
  });

  it('refuses to create while the slug is taken', async () => {
    mocks.checkSlug.mockResolvedValue({ available: false });

    render(<CreateWorkspaceModal />);

    fireEvent.change(nameInput(), { target: { value: 'Taken' } });

    expect(await screen.findByText('This URL is already taken.')).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    fireEvent.click(submit());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('explains an invalid slug instead of asking the server', async () => {
    render(<CreateWorkspaceModal />);

    fireEvent.change(nameInput(), { target: { value: 'Acme Team' } });
    fireEvent.change(slugInput(), { target: { value: '-bad-' } });

    expect(
      await screen.findByText('Use 3–32 lowercase letters, numbers or hyphens.'),
    ).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    expect(mocks.checkSlug).not.toHaveBeenCalledWith({ slug: '-bad-' });
  });
});
