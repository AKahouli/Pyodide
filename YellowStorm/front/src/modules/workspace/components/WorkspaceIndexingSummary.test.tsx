import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkspaceFile } from '../types';
import { WorkspaceIndexingSummary } from './WorkspaceIndexingSummary';

function file(id: string, indexingStatus: WorkspaceFile['indexingStatus'], folderId: string | null = null): WorkspaceFile {
  return { id, indexingStatus, workspaceId: 'workspace', folderId, name: id, mimeType: 'application/pdf', size: 1, uploadedAt: null, assignmentSource: null };
}

describe('WorkspaceIndexingSummary', () => {
  it('counts all folders, queued work and conversion, excluding other workspaces, and updates with live file changes', () => {
    const files: WorkspaceFile[] = [
      file('indexed-root', 'ready'), file('indexed-folder', 'ready', 'folder'),
      file('failed-folder', 'failed', 'folder'), file('processing', 'processing'),
      file('queued', 'pending'), { ...file('converting', 'none'), type: 'url', status: 'processing' },
      file('not-indexed', 'none'), { ...file('other', 'failed'), workspaceId: 'other' },
    ];
    const { rerender } = render(<WorkspaceIndexingSummary files={files} workspaceId='workspace' />);
    const count = (key: string) => screen.getByText(`indexing.count.${key}`).parentElement?.querySelector('dd')?.textContent;
    expect(count('total')).toBe('7');
    expect(count('indexed')).toBe('2');
    expect(count('failed')).toBe('1');
    expect(count('processing')).toBe('3');
    rerender(<WorkspaceIndexingSummary files={files.map((item) => item.id === 'processing' ? { ...item, indexingStatus: 'ready' } : item)} workspaceId='workspace' />);
    expect(count('indexed')).toBe('3');
    expect(count('processing')).toBe('2');
    expect(count('total')).toBe('7');
  });

  it('colours each total with the colour of the state it counts', () => {
    const files: WorkspaceFile[] = [file('indexed', 'ready'), file('failed', 'failed'), file('processing', 'processing')];
    render(<WorkspaceIndexingSummary files={files} workspaceId='workspace' />);
    const value = (key: string) => screen.getByText(`indexing.count.${key}`).parentElement?.querySelector('dd');
    expect(value('total')).toHaveClass('text-foreground');
    expect(value('indexed')).toHaveClass('text-green-700');
    expect(value('failed')).toHaveClass('text-destructive');
    // In-progress work is orange, never red.
    expect(value('processing')).toHaveClass('text-orange-700');
    expect(value('processing')).not.toHaveClass('text-destructive');
  });
});
