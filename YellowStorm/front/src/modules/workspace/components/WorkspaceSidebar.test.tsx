import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSidebar } from './WorkspaceSidebar';

const fetchWorkspacesMock = vi.fn();
const openCreateModalMock = vi.fn();
const closeModalMock = vi.fn();
const searchWorkspacesMock = vi.fn();
const resetSearchMock = vi.fn();

const state = {
  isModalOpen: true,
};

vi.mock('../store', () => ({
  useWorkspaces: () => [
    {
      id: 'w-1',
      name: 'Workspace A',
      alias: 'workspace-a',
      createdBy: 'u-1',
      documentCount: 1,
      usedStorage: 128,
      allocatedStorage: 1024,
      createdAt: '',
      updatedAt: '',
    },
  ],
  useWorkspacePagination: () => ({ currentPage: 1, totalPages: 2 }),
  useWorkspaceLoading: () => ({ isLoadingWorkspaces: false }),
  useWorkspaceStore: (selector: (s: {
    fetchWorkspaces: typeof fetchWorkspacesMock;
    searchWorkspaces: typeof searchWorkspacesMock;
    openCreateModal: typeof openCreateModalMock;
    selectedWorkspaceId: string;
    isModalOpen: boolean;
    closeModal: typeof closeModalMock;
  }) => unknown) =>
    selector({
      fetchWorkspaces: fetchWorkspacesMock,
      searchWorkspaces: searchWorkspacesMock,
      openCreateModal: openCreateModalMock,
      selectedWorkspaceId: 'w-1',
      isModalOpen: state.isModalOpen,
      closeModal: closeModalMock,
    }),
}));

vi.mock('../hooks', () => ({
  useDebouncedSearch: () => ({ value: '', onChange: searchWorkspacesMock, reset: resetSearchMock }),
}));

vi.mock('./WorkspaceItem', () => ({ WorkspaceItem: ({ workspace }: { workspace: { id: string } }) => <div>workspace-item-{workspace.id}</div> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => <button onClick={onClick} disabled={disabled}>{children}</button> }));
vi.mock('@/components/ui/input', () => ({ Input: ({ value, onChange, placeholder }: { value?: string; onChange?: (e: { target: { value: string } }) => void; placeholder?: string }) => <input value={value} onChange={(e) => onChange?.({ target: { value: e.target.value } })} placeholder={placeholder} /> }));
vi.mock('@/components/ui/separator', () => ({ Separator: () => <div /> }));
vi.mock('lucide-react', () => ({ Search: () => <span>Search</span>, Plus: () => <span>Plus</span>, ChevronLeft: () => <span>ChevronLeft</span>, ChevronRight: () => <span>ChevronRight</span>, Loader2: () => <span>Loader2</span>, X: () => <span>X</span> }));

describe('WorkspaceSidebar', () => {
  beforeEach(() => {
    fetchWorkspacesMock.mockReset();
    openCreateModalMock.mockReset();
    closeModalMock.mockReset();
    searchWorkspacesMock.mockReset();
    resetSearchMock.mockReset();
    state.isModalOpen = true;
  });

  it('renders workspace items and handles create/pagination actions', async () => {
    render(<WorkspaceSidebar />);

    expect(screen.getByText('workspace-item-w-1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /sidebar.create/i }));
    expect(openCreateModalMock).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'ChevronRight' }));
    expect(fetchWorkspacesMock).toHaveBeenCalledWith(2);
  });

  it('resets search when parent modal closes', () => {
    state.isModalOpen = false;
    render(<WorkspaceSidebar />);
    expect(resetSearchMock).toHaveBeenCalled();
  });
});
