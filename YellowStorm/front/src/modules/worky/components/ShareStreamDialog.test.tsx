import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareStreamDialog } from './ShareStreamDialog';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
  refetch: vi.fn(),
  showError: vi.fn(),
  shares: {
    data: [] as Array<{
      id: string;
      permission: 'read' | 'write';
      user: { id: string; email: string; firstName: string; lastName: string };
      createdAt: string;
    }> | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, vars?: { title?: string }) => vars?.title ? `${key}:${vars.title}` : key,
  }),
}));
vi.mock('@/modules/auth', () => ({
  useAuth: () => ({
    user: { email: 'owner@example.com', profile: { firstName: 'Ada', lastName: 'Owner' } },
  }),
}));
vi.mock('@/lib/notifications', () => ({ showError: mocks.showError }));
vi.mock('@/modules/agent/components/UserSearchInput', () => ({
  UserSearchInput: ({ onAddPending }: { onAddPending: (share: { email: string; permission: 'read' }) => void }) => (
    <button type='button' onClick={() => onAddPending({ email: 'member@example.com', permission: 'read' })}>
      sharing.searchUsers
    </button>
  ),
}));
vi.mock('../query/hooks', () => ({
  useStreamShares: () => ({ ...mocks.shares, refetch: mocks.refetch }),
  useCreateStreamShare: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateStreamShare: () => ({ mutate: mocks.update }),
  useRevokeStreamShare: () => ({ mutate: mocks.revoke }),
}));

describe('ShareStreamDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue(undefined);
    mocks.shares.data = [];
    mocks.shares.isLoading = false;
    mocks.shares.isError = false;
  });

  it('uses the established searchable sharing flow', async () => {
    render(<ShareStreamDialog streamId='s1' title='Q3 Expansion' open onOpenChange={vi.fn()} />);

    expect(screen.getByText('sharing.title:Q3 Expansion')).toBeTruthy();
    expect(screen.getByText('sharing.peopleWithAccess')).toBeTruthy();
    expect(screen.getByText('sharing.you')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'sharing.searchUsers' }));
    fireEvent.click(screen.getByRole('button', { name: 'sharing.invite' }));

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith({
        email: 'member@example.com',
        permission: 'read',
      });
    });
  });

  it('renders collaborators and supports permission updates and revoke', async () => {
    mocks.shares.data = [{
      id: 'share-1',
      permission: 'read',
      user: {
        id: 'u2',
        email: 'member@example.com',
        firstName: 'Member',
        lastName: 'User',
      },
      createdAt: '2026-09-23T00:00:00Z',
    }];
    render(<ShareStreamDialog streamId='s1' title='Q3 Expansion' open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Member User')).toBeTruthy();
    expect(screen.getByText('member@example.com')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'sharing.changePermission' }));
    await userEvent.click(screen.getByText('sharing.write'));
    expect(mocks.update).toHaveBeenCalledWith(
      { shareId: 'share-1', permission: 'write' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'sharing.revoke' }));
    expect(mocks.revoke).toHaveBeenCalledWith(
      'share-1',
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('shows collaborator query failures and retries', async () => {
    mocks.shares.data = undefined;
    mocks.shares.isError = true;
    render(<ShareStreamDialog streamId='s1' title='Q3 Expansion' open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toContain('sharing.loadFailed');
    await userEvent.click(screen.getByRole('button', { name: 'sharing.retry' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('reports invite failures', async () => {
    mocks.create.mockRejectedValue(new Error('share failed'));
    render(<ShareStreamDialog streamId='s1' title='Q3 Expansion' open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'sharing.searchUsers' }));
    fireEvent.click(screen.getByRole('button', { name: 'sharing.invite' }));

    await waitFor(() => expect(mocks.showError).toHaveBeenCalledWith('share failed'));
  });
});
