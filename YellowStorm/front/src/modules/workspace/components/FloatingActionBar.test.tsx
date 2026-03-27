import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { FloatingActionBar } from './FloatingActionBar';

const bulkDeleteDocumentsMock = vi.fn(async () => undefined);
const getDownloadUrlMock = vi.fn(async () => 'https://example.com/file');
const onClearSelectionMock = vi.fn();

vi.mock('../store', () => ({
  useSelectedWorkspace: () => ({ id: 'w-1' }),
  useWorkspaceLoading: () => ({ isDeleting: false }),
  useWorkspaceStore: (selector: (s: { bulkDeleteDocuments: typeof bulkDeleteDocumentsMock; getDownloadUrl: typeof getDownloadUrlMock }) => unknown) =>
    selector({ bulkDeleteDocuments: bulkDeleteDocumentsMock, getDownloadUrl: getDownloadUrlMock }),
}));

vi.mock('../hooks', () => ({
  useModalCloseEffect: vi.fn(),
}));

vi.mock('./dialogs', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => (open ? <button onClick={onConfirm}>confirm-bulk-delete</button> : null),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/separator', () => ({ Separator: () => <div /> }));
vi.mock('lucide-react', () => ({ Download: () => <span>Download</span>, Trash2: () => <span>Trash2</span>, X: () => <span>X</span>, Loader2: () => <span>Loader2</span> }));

describe('FloatingActionBar', () => {
  beforeEach(() => {
    bulkDeleteDocumentsMock.mockReset();
    getDownloadUrlMock.mockReset();
    getDownloadUrlMock.mockResolvedValue('https://example.com/file');
    onClearSelectionMock.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.stubGlobal('open', vi.fn());
  });

  it('downloads selected files', async () => {
    render(<FloatingActionBar selectedCount={1} selectedIds={['d-1']} onClearSelection={onClearSelectionMock} />);

    await userEvent.click(screen.getByRole('button', { name: /floating.actions.download/i }));

    await waitFor(() => {
      expect(getDownloadUrlMock).toHaveBeenCalledWith('w-1', 'd-1');
      expect(window.open).toHaveBeenCalledWith('https://example.com/file', '_blank');
    });
  });

  it('confirms bulk delete and clears selection', async () => {
    render(<FloatingActionBar selectedCount={2} selectedIds={['d-1', 'd-2']} onClearSelection={onClearSelectionMock} />);

    await userEvent.click(screen.getByRole('button', { name: /floating.actions.delete/i }));
    await userEvent.click(screen.getByRole('button', { name: 'confirm-bulk-delete' }));

    await waitFor(() => {
      expect(bulkDeleteDocumentsMock).toHaveBeenCalledWith('w-1', ['d-1', 'd-2']);
      expect(onClearSelectionMock).toHaveBeenCalled();
    });
  });
});
