import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareProjectDialog } from './ShareProjectDialog';

const apiMocks = vi.hoisted(() => ({
  getProjectShares: vi.fn(),
  shareProject: vi.fn(),
  updateSharePermission: vi.fn(),
  revokeShare: vi.fn(),
  setVisibility: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock('../api', () => apiMocks);

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: { id: 'owner-1', email: 'owner@example.com', profile: { firstName: 'Ada', lastName: 'Owner' } } }),
}));

vi.mock('@/modules/groups', () => ({
  useGroups: () => [],
  useGroupsStore: { getState: () => ({ fetchGroups: vi.fn().mockResolvedValue(undefined) }) },
}));

const project = {
  id: 'project-1',
  name: 'BPCE',
  createdBy: 'owner-1',
  conversationCount: 2,
  isPublic: false,
  shareCount: 0,
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
};

describe('ShareProjectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getProjectShares.mockResolvedValue({ shares: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    apiMocks.searchUsers.mockResolvedValue([
      { id: 'user-2', email: 'member@example.com', firstName: 'Mem', lastName: 'Ber' },
    ]);
  });

  it('lists people with access', async () => {
    apiMocks.getProjectShares.mockResolvedValue({
      shares: [
        {
          id: 'share-1',
          projectId: 'project-1',
          user: { id: 'user-2', email: 'member@example.com', firstName: 'Mem', lastName: 'Ber' },
          permission: 'read',
          sharedBy: 'owner-1',
          createdAt: '2026-09-11T00:00:00Z',
          updatedAt: '2026-09-11T00:00:00Z',
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    render(<ShareProjectDialog open onOpenChange={vi.fn()} project={project} />);

    await waitFor(() => {
      expect(screen.getByText('member@example.com')).toBeInTheDocument();
    });
  });

  it('toggles public visibility', async () => {
    apiMocks.setVisibility.mockResolvedValue({ ...project, isPublic: true });

    render(<ShareProjectDialog open onOpenChange={vi.fn()} project={project} />);

    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      expect(apiMocks.setVisibility).toHaveBeenCalledWith('project-1', true);
    });
  });

  it('shares the project with a searched user', async () => {
    apiMocks.shareProject.mockResolvedValue({
      shared: [
        {
          id: 'share-2',
          projectId: 'project-1',
          user: { id: 'user-2', email: 'member@example.com' },
          permission: 'read',
          sharedBy: 'owner-1',
          createdAt: '2026-09-11T00:00:00Z',
          updatedAt: '2026-09-11T00:00:00Z',
        },
      ],
      notFound: [],
      invalid: [],
    });

    render(<ShareProjectDialog open onOpenChange={vi.fn()} project={project} />);

    await userEvent.type(screen.getByPlaceholderText('sharing.searchUsers'), 'member@example.com');
    await screen.findByText('member@example.com');
    await userEvent.click(screen.getAllByRole('button', { name: 'sharing.permission.read' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'sharing.invite' }));

    await waitFor(() => {
      expect(apiMocks.shareProject).toHaveBeenCalledWith('project-1', {
        shares: [{ email: 'member@example.com', permission: 'read' }],
      });
    });
  });
});
