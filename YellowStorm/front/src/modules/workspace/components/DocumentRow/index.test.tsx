import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import DocumentRow from './index';

const actions = {
  isDeleteDialogOpen: false,
  setIsDeleteDialogOpen: vi.fn(),
  isDownloading: false,
  isDeleting: false,
  isReindexing: false,
  canIndex: true,
  canReindex: false,
  isViewable: true,
  handleDownload: vi.fn(),
  handleDelete: vi.fn(async () => undefined),
  handleReindex: vi.fn(),
  handleViewFile: vi.fn(),
};

vi.mock('../../hooks', () => ({
  useDocumentActions: () => actions,
  useSelectedWorkspace: () => ({ id: 'w-1', isPersonal: true }),
  useWorkspaceStore: (selector: (s: { isUploading: boolean }) => unknown) =>
    selector({ isUploading: false }),
}));

vi.mock('../CreateFolderDialog', () => ({
  CreateFolderDialog: () => null,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/ui/table', () => ({
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
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

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../dialogs', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => (open ? <button onClick={onConfirm}>confirm-delete</button> : null),
}));

vi.mock('./IndexingStatusBadge', () => ({
  IndexingStatusBadge: () => <span>status-badge</span>,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    FileText: () => <span>FileText</span>,
    Download: () => <span>Download</span>,
    Eye: () => <span>Eye</span>,
    RefreshCw: () => <span>RefreshCw</span>,
    Search: () => <span>Search</span>,
    Trash2: () => <span>Trash2</span>,
    Loader2: () => <span>Loader2</span>,
  };
});

describe('DocumentRow', () => {
  it('triggers document action callbacks', async () => {
    render(
      <table>
        <tbody>
          <DocumentRow
            document={{
              id: 'doc-1',
              filename: 'doc.pdf',
              originalName: 'Doc.pdf',
              mimeType: 'application/pdf',
              size: 1024,
              path: '/doc.pdf',
              workspaceId: 'w-1',
              createdBy: 'u-1',
              status: 'completed',
              indexingStatus: 'none',
              isFolder: false,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }}
            isSelected={false}
            onToggleSelect={vi.fn()}
          />
        </tbody>
      </table>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await userEvent.click(screen.getByRole('button', { name: 'Eye' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(screen.getByRole('button', { name: 'Trash2' }));

    expect(actions.handleDownload).toHaveBeenCalledTimes(1);
    expect(actions.handleViewFile).toHaveBeenCalledTimes(1);
    expect(actions.handleReindex).toHaveBeenCalledTimes(1);
    expect(actions.setIsDeleteDialogOpen).toHaveBeenCalledWith(true);
  });
});
