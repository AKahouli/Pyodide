import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setFileFolderAssignment = vi.fn();
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) =>
    sel({
      pageFolders: [{ id: 'f1', workspaceId: 'w1', name: 'Folder1', parentId: null, description: '' }],
      setFileFolderAssignment,
      selectedWorkspaceId: 'w1',
    }),
}));

import { MoveFileDialog } from './MoveFileDialog';

describe('MoveFileDialog', () => {
  it('moves every file in the set to the picked folder', () => {
    const files = [{ id: 'a', name: 'A', folderId: null }, { id: 'b', name: 'B', folderId: null }] as never;
    render(<MoveFileDialog open files={files} title='example.com' onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Folder1'));       // pick Folder1 as destination
    fireEvent.click(screen.getByText('Déplacer ici'));
    expect(setFileFolderAssignment).toHaveBeenCalledWith('a', 'f1');
    expect(setFileFolderAssignment).toHaveBeenCalledWith('b', 'f1');
  });
});
