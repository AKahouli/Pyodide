import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceItem } from './WorkspaceItem';

const selectWorkspaceMock = vi.fn();
const renameWorkspaceMock = vi.fn(async () => undefined);
const deleteWorkspaceMock = vi.fn(async () => undefined);
const deleteAllDocumentsMock = vi.fn(async () => undefined);
const openSettingsModalMock = vi.fn();

vi.mock('../store', () => ({
  useWorkspaceStore: (selector: (s: {
    selectWorkspace: typeof selectWorkspaceMock;
    renameWorkspace: typeof renameWorkspaceMock;
    deleteWorkspace: typeof deleteWorkspaceMock;
    deleteAllDocuments: typeof deleteAllDocumentsMock;
    openSettingsModal: typeof openSettingsModalMock;
    isDeleting: boolean;
  }) => unknown) =>
    selector({
      selectWorkspace: selectWorkspaceMock,
      renameWorkspace: renameWorkspaceMock,
      deleteWorkspace: deleteWorkspaceMock,
      deleteAllDocuments: deleteAllDocumentsMock,
      openSettingsModal: openSettingsModalMock,
      isDeleting: false,
    }),
}));

vi.mock('../hooks', () => ({ useModalCloseEffect: vi.fn() }));

vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick }: { children: ReactNode; onClick?: (e: React.MouseEvent) => void }) => <button onClick={(e) => onClick?.(e)}>{children}</button> }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: (e: React.MouseEvent) => void }) => <button onClick={(e) => onClick?.(e)}>{children}</button>,
  DropdownMenuSeparator: () => <div />,
}));

vi.mock('./dialogs', () => ({
  RenameDialog: ({ open, onRename }: { open: boolean; onRename: (name: string) => void }) => (open ? <button onClick={() => onRename('Renamed')}>confirm-rename</button> : null),
  ConfirmDialog: ({ open, onConfirm, title }: { open: boolean; onConfirm: () => void; title: string }) => (open ? <button onClick={onConfirm}>confirm-{title}</button> : null),
}));

describe('WorkspaceItem', () => {
  beforeEach(() => {
    selectWorkspaceMock.mockReset();
    renameWorkspaceMock.mockReset();
    openSettingsModalMock.mockReset();
  });

  it('selects workspace on row click and allows rename action', async () => {
    render(
      <WorkspaceItem
        workspace={{
          id: 'w-1',
          name: 'Workspace A',
          alias: 'workspace-a',
          createdBy: 'u-1',
          documentCount: 2,
          usedStorage: 256,
          allocatedStorage: 1024,
          isSystem: false,
          isPersonal: true,
          shareCount: 0,
          createdAt: '',
          updatedAt: '',
        }}
        isSelected={false}
      />, 
    );

    await userEvent.click(screen.getByText('Workspace A'));
    expect(selectWorkspaceMock).toHaveBeenCalledWith('w-1');

    await userEvent.click(screen.getByRole('button', { name: 'item.menu.rename' }));
    await userEvent.click(screen.getByRole('button', { name: 'confirm-rename' }));

    await waitFor(() => expect(renameWorkspaceMock).toHaveBeenCalledWith('w-1', 'Renamed'));
  });
});
