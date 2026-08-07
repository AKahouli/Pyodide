import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContent } from './WorkspaceContent';

const {
  fetchDocumentsMock,
  fetchAllFoldersMock,
  renameFolderMock,
  deleteFolderMock,
  setCurrentFolderIdMock,
  state,
  useWorkspaceStoreMock,
} = vi.hoisted(() => {
  const fetchDocumentsMock = vi.fn();
  const fetchAllFoldersMock = vi.fn();
  const renameFolderMock = vi.fn(async () => undefined);
  const deleteFolderMock = vi.fn(async () => undefined);
  const setCurrentFolderIdMock = vi.fn();

  const state = {
    selectedWorkspace: null as
      | {
          id: string;
          name: string;
          documentCount: number;
          usedStorage: number;
          allocatedStorage: number;
          isPersonal?: boolean;
        }
      | null,
    selectedWorkspaceId: null as string | null,
    currentFolderId: null as string | null,
    documents: [] as Array<{ id: string; isFolder?: boolean }>,
    allFolders: [] as Array<{
      id: string;
      isFolder?: boolean;
      folderName?: string;
      originalName?: string;
      parentId?: string | null;
    }>,
  };

  const storeApi = {
    renameFolder: renameFolderMock,
    deleteFolder: deleteFolderMock,
    fetchDocuments: fetchDocumentsMock,
    fetchAllFolders: fetchAllFoldersMock,
    setCurrentFolderId: setCurrentFolderIdMock,
    get selectedWorkspaceId() {
      return state.selectedWorkspaceId;
    },
    get currentFolderId() {
      return state.currentFolderId;
    },
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector: (s: typeof storeApi) => unknown) => selector(storeApi),
    { getState: () => storeApi },
  );

  return {
    fetchDocumentsMock,
    fetchAllFoldersMock,
    renameFolderMock,
    deleteFolderMock,
    setCurrentFolderIdMock,
    state,
    useWorkspaceStoreMock,
  };
});

vi.mock('../store', () => ({
  useSelectedWorkspace: () => state.selectedWorkspace,
  useWorkspaceLoading: () => ({ isDeleting: false, isLoadingWorkspaces: false }),
  useDocuments: () => ({ documents: state.documents }),
  useAllFolders: () => state.allFolders,
  useWorkspaceStore: useWorkspaceStoreMock,
}));

vi.mock('../hooks', () => ({
  useDocumentDragDrop: () => ({
    isDragging: false,
    draggedItems: [],
    handleDropOnRoot: vi.fn(),
  }),
}));

vi.mock('./DocumentsTable', () => ({ DocumentsTable: () => <div>documents-table</div> }));
vi.mock('./UploadDropZone', () => ({ UploadDropZone: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./UploadButton', () => ({ UploadButton: () => <button type="button">upload-button</button> }));
vi.mock('./CreateFolderDialog', () => ({ CreateFolderDialog: () => null }));
vi.mock('./FolderTreeSidebar', () => ({ FolderTreeSidebar: () => <div>folder-tree</div> }));
vi.mock('./FolderNavigation', () => ({ FolderNavigation: () => <div>folder-nav</div> }));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
    placeholder?: string;
  }) => (
    <input
      value={value}
      onChange={(e) => onChange?.({ target: { value: e.target.value } })}
      placeholder={placeholder}
    />
  ),
}));
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('WorkspaceContent', () => {
  beforeEach(() => {
    fetchDocumentsMock.mockReset();
    fetchAllFoldersMock.mockReset();
    renameFolderMock.mockReset();
    deleteFolderMock.mockReset();
    setCurrentFolderIdMock.mockReset();
    state.selectedWorkspace = null;
    state.selectedWorkspaceId = null;
    state.currentFolderId = null;
    state.documents = [];
    state.allFolders = [];
  });

  it('renders empty state when no workspace is selected', () => {
    render(<WorkspaceContent />);

    expect(screen.getByText('content.noWorkspace')).toBeInTheDocument();
  });

  it('renders selected workspace content', () => {
    state.selectedWorkspace = {
      id: 'w-1',
      name: 'Workspace A',
      documentCount: 2,
      usedStorage: 100,
      allocatedStorage: 1000,
      isPersonal: true,
    };
    state.selectedWorkspaceId = 'w-1';
    state.documents = [{ id: 'd1', isFolder: false }];

    render(<WorkspaceContent />);

    expect(screen.getByText('Workspace A')).toBeInTheDocument();
    expect(screen.getByText('documents-table')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('content.searchPlaceholder')).toBeInTheDocument();
  });
});
