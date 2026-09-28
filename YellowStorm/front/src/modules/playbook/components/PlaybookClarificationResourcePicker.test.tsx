import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookClarificationResourcePicker } from './PlaybookClarificationResourcePicker';

const base = { folderIds: [], folders: [], fileCount: 0, stillIndexing: 0, reason: '' };
// The chooser has its own tests: here it shows the mode it was opened in and hands back a choice.
vi.mock('@/modules/semantic-model/components/assistant/SourceChooser', () => ({
  SourceChooserDialog: ({ open, mode, onChoose }: { open: boolean; mode: string; onChoose: (option: unknown) => void }) => open ? <>
    <button type='button' onClick={() => onChoose({ ...base, workspaceId: 'ws-1', workspaceName: 'Legal', kind: 'workspace', documentIds: [], documents: [] })}>{mode}: whole workspace</button>
    <button type='button' onClick={() => onChoose({ ...base, workspaceId: 'ws-1', workspaceName: 'Legal', kind: 'document', documentIds: ['doc-1'], documents: ['Brief.pdf'], mimeType: 'application/pdf' })}>{mode}: one file</button>
  </> : null,
}));

describe('PlaybookClarificationResourcePicker', () => {
  it('chooses one file or a whole workspace from the searchable list', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<PlaybookClarificationResourcePicker open mode='workspace_or_document' onOpenChange={onOpenChange} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('file: one file'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'document', id: 'doc-1', name: 'Brief.pdf', workspaceId: 'ws-1', workspaceName: 'Legal', mimeType: 'application/pdf' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByText('file: whole workspace'));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'workspace', id: 'ws-1', name: 'Legal', workspaceId: 'ws-1', workspaceName: 'Legal' });
  });

  it('chooses only a workspace for a destination', () => {
    render(<PlaybookClarificationResourcePicker open mode='destination_workspace' onOpenChange={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('workspace: whole workspace')).toBeInTheDocument();
  });
});
