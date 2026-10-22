import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import type { WorkspaceFile } from '../types';
import { IndexingStatusDot } from './IndexingStatusDot';
import { WorkspaceIndexingStatus } from './WorkspaceIndexingStatus';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => {
      const entry = en[key as keyof typeof en];
      return typeof entry === 'string' ? entry : key;
    },
  }),
}));

function file(indexingStatus: WorkspaceFile['indexingStatus']): WorkspaceFile {
  return { id: 'file-1', name: 'Invoice.pdf', workspaceId: 'ws', folderId: null, mimeType: 'application/pdf', size: 100, uploadedAt: null, assignmentSource: null, indexingStatus };
}

describe('workspace indexing colours', () => {
  it('colours a running status orange', () => {
    render(<WorkspaceIndexingStatus file={file('processing')} />);
    expect(screen.getByText('Indexing')).toHaveClass('text-orange-700');
  });

  it('colours a failed status red', () => {
    render(<WorkspaceIndexingStatus file={file('failed')} />);
    expect(screen.getByText('Needs attention')).toHaveClass('text-destructive');
  });

  it('colours a finished status green', () => {
    render(<WorkspaceIndexingStatus file={file('ready')} />);
    expect(screen.getByText('Ready to use')).toHaveClass('text-green-700');
  });

  it('keeps a not indexed file neutral', () => {
    render(<WorkspaceIndexingStatus file={file('none')} />);
    expect(screen.getByText('Not indexed')).toHaveClass('text-muted-foreground');
  });

  it('colours the status dot with the same palette', () => {
    const { rerender } = render(<IndexingStatusDot status='processing' />);
    expect(screen.getByRole('img')).toHaveClass('bg-orange-500');
    rerender(<IndexingStatusDot status='failed' />);
    expect(screen.getByRole('img')).toHaveClass('bg-red-500');
    rerender(<IndexingStatusDot status='ready' />);
    expect(screen.getByRole('img')).toHaveClass('bg-green-500');
  });
});
