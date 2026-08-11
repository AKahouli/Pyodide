import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsTable } from './DocumentsTable';

const fetchDocumentsMock = vi.fn();
const toggleSelectAllMock = vi.fn();

const state = {
  isLoadingDocuments: false,
  documents: [
    {
      id: 'd1',
      filename: 'd1.pdf',
      originalName: 'Doc 1',
      mimeType: 'application/pdf',
      size: 500,
      path: '/d1.pdf',
      workspaceId: 'w-1',
      createdBy: 'u-1',
      status: 'completed' as const,
      indexingStatus: 'none' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  selectedCount: 0,
};

vi.mock('../store', () => ({
  useDocuments: () => ({ documents: state.documents }),
  useSelectedWorkspace: () => ({ id: 'w-1' }),
  useDocumentPagination: () => ({ currentPage: 1, totalPages: 2, totalDocuments: 25 }),
  useWorkspaceLoading: () => ({ isLoadingDocuments: state.isLoadingDocuments }),
  useWorkspaceStore: (selector: (s: {
    fetchDocuments: typeof fetchDocumentsMock;
    addFilesToQueue: ReturnType<typeof vi.fn>;
    startUpload: ReturnType<typeof vi.fn>;
    currentFolderId: string | null;
  }) => unknown) =>
    selector({
      fetchDocuments: fetchDocumentsMock,
      addFilesToQueue: vi.fn(),
      startUpload: vi.fn(),
      currentFolderId: null,
    }),
}));

vi.mock('../hooks', () => ({
  useDocumentSelection: () => ({
    selectedCount: state.selectedCount,
    isAllSelected: false,
    isSomeSelected: false,
    isSelected: () => false,
    toggleSelect: vi.fn(),
    toggleSelectAll: toggleSelectAllMock,
    clearSelection: vi.fn(),
    getSelectedIds: () => ['d1'],
  }),
}));

vi.mock('../hooks/useDocumentDragDrop', () => ({
  useDocumentDragDrop: () => ({
    isDragging: false,
    dropTargetId: null,
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDropOnFolder: vi.fn(),
    handleDropOnRoot: vi.fn(),
  }),
}));

vi.mock('../hooks/useAllowedUploadExtensions', () => ({
  useAllowedUploadExtensions: () => ({ accept: '.pdf' }),
}));

vi.mock('./DocumentRow', () => ({
  default: ({ document }: { document: { id: string } }) => <tr><td>row-{document.id}</td></tr>,
}));

vi.mock('./DocumentRow/DocumentCard', () => ({
  DocumentCard: ({ document }: { document: { id: string } }) => <div>card-{document.id}</div>,
}));

vi.mock('./FloatingActionBar', () => ({
  FloatingActionBar: ({ selectedCount }: { selectedCount: number }) => <div>floating-{selectedCount}</div>,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ onCheckedChange, ...props }: { onCheckedChange?: () => void } & Record<string, unknown>) => <input type='checkbox' onChange={() => onCheckedChange?.()} {...props} />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/scroll-area', () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    Loader2: () => <span>Loader2</span>,
    Upload: () => <span>Upload</span>,
    ChevronLeft: () => <span>ChevronLeft</span>,
    ChevronRight: () => <span>ChevronRight</span>,
    FolderPlus: () => <span>FolderPlus</span>,
  };
});

describe('DocumentsTable', () => {
  beforeEach(() => {
    fetchDocumentsMock.mockReset();
    toggleSelectAllMock.mockReset();
    state.isLoadingDocuments = false;
    state.selectedCount = 0;
    state.documents = [state.documents[0]];
  });

  it('renders document rows and handles next pagination click', async () => {
    render(<DocumentsTable />);

    expect(screen.getByText('row-d1')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'ChevronRight' })[0]);
    expect(fetchDocumentsMock).toHaveBeenCalledWith('w-1', 2);
  });

  it('renders floating action bar when selection exists', () => {
    state.selectedCount = 2;
    render(<DocumentsTable />);
    expect(screen.getByText('floating-2')).toBeInTheDocument();
  });
});
