import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContent } from './WorkspaceContent';

const searchDocumentsMock = vi.fn();
const renameWorkspaceMock = vi.fn(async () => undefined);
const deleteWorkspaceMock = vi.fn(async () => undefined);
const deleteAllDocumentsMock = vi.fn(async () => undefined);
const openSettingsModalMock = vi.fn();
const toggleMobileSidebarMock = vi.fn();

const state = {
  selectedWorkspace: null as
    | {
        id: string;
        name: string;
        documentCount: number;
        usedStorage: number;
        allocatedStorage: number;
      }
    | null,
};

vi.mock('../store', () => ({
  useSelectedWorkspace: () => state.selectedWorkspace,
  useWorkspaceLoading: () => ({ isDeleting: false, isLoadingWorkspaces: false }),
  useWorkspaceStore: (selector: (s: {
    totalWorkspaces: number;
    searchDocuments: typeof searchDocumentsMock;
    renameWorkspace: typeof renameWorkspaceMock;
    deleteWorkspace: typeof deleteWorkspaceMock;
    deleteAllDocuments: typeof deleteAllDocumentsMock;
    openSettingsModal: typeof openSettingsModalMock;
    toggleMobileSidebar: typeof toggleMobileSidebarMock;
  }) => unknown) =>
    selector({
      totalWorkspaces: 0,
      searchDocuments: searchDocumentsMock,
      renameWorkspace: renameWorkspaceMock,
      deleteWorkspace: deleteWorkspaceMock,
      deleteAllDocuments: deleteAllDocumentsMock,
      openSettingsModal: openSettingsModalMock,
      toggleMobileSidebar: toggleMobileSidebarMock,
    }),
}));

vi.mock('../hooks', () => ({
  useModalCloseEffect: vi.fn(),
  useDebouncedSearch: () => ({ value: '', onChange: searchDocumentsMock, reset: vi.fn() }),
  useIndexingNotifications: vi.fn(),
}));

vi.mock('./DocumentsTable', () => ({ DocumentsTable: () => <div>documents-table</div> }));
vi.mock('./UploadDropZone', () => ({ UploadDropZone: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./UploadButton', () => ({ UploadButton: () => <button>upload-button</button> }));
vi.mock('./dialogs', () => ({
  RenameDialog: () => null,
  ConfirmDialog: () => null,
}));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button> }));
vi.mock('@/components/ui/input', () => ({ Input: ({ value, onChange, placeholder }: { value?: string; onChange?: (e: { target: { value: string } }) => void; placeholder?: string }) => <input value={value} onChange={(e) => onChange?.({ target: { value: e.target.value } })} placeholder={placeholder} /> }));
vi.mock('@/components/ui/scroll-area', () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <div />,
}));
vi.mock('@/components/ui/progress', () => ({ Progress: () => <div /> }));

describe('WorkspaceContent', () => {
  beforeEach(() => {
    searchDocumentsMock.mockReset();
    openSettingsModalMock.mockReset();
    toggleMobileSidebarMock.mockReset();
  });

  it('renders empty state when no workspace is selected', async () => {
    state.selectedWorkspace = null;
    render(<WorkspaceContent />);

    expect(screen.getByText('content.empty.createTitle')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'content.empty.back' }));
    expect(toggleMobileSidebarMock).toHaveBeenCalled();
  });

  it('renders selected workspace content and delegates search/settings actions', async () => {
    state.selectedWorkspace = { id: 'w-1', name: 'Workspace A', documentCount: 2, usedStorage: 100, allocatedStorage: 1000 };
    render(<WorkspaceContent />);

    expect(screen.getByText('documents-table')).toBeInTheDocument();
    await userEvent.type(screen.getAllByPlaceholderText('content.searchPlaceholder')[0], 'abc');
    expect(searchDocumentsMock).toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole('button', { name: 'item.menu.settings' })[0]);
    expect(openSettingsModalMock).toHaveBeenCalled();
  });
});
