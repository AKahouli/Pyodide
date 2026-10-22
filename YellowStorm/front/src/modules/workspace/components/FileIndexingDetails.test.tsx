import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import type { IndexingProgress, WorkspaceFile } from '../types';
import { FileIndexingStatusLine, FileIndexingSteps } from './FileIndexingDetails';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const entry = en[key as keyof typeof en];
      let value = typeof entry === 'string' ? entry : key;
      for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{{${name}}}`, String(replacement));
      return value;
    },
  }),
}));

const schedule: IndexingProgress = {
  currentStep: 2,
  totalSteps: 3,
  processingStatus: 'PROCESSING',
  stepStatus: 'PROCESSING',
  message: 'Embedding blocks.',
  steps: [
    { number: 1, name: 'Document download', key: 'download' },
    { number: 2, name: 'Block embedding', key: 'embed-blocks' },
    { number: 3, name: 'Document storage', key: 'store' },
  ],
};

function file(overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    id: 'file-1',
    name: 'Invoice.pdf',
    workspaceId: 'ws',
    folderId: null,
    mimeType: 'application/pdf',
    size: 100,
    uploadedAt: null,
    assignmentSource: null,
    indexingStatus: 'processing',
    ...overrides,
  };
}

describe('FileIndexingDetails', () => {
  it('shows the status with the elapsed attempt time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T10:01:23.000Z'));
    try {
      render(<FileIndexingStatusLine file={file({ indexingStatus: 'processing', indexingAttemptStartedAt: '2026-10-21T10:00:00.000Z' })} />);
      expect(screen.getByText('Indexing')).toBeInTheDocument();
      expect(screen.getByLabelText('Processing time: 1m 23s')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists the reported steps of a running schedule', () => {
    render(<FileIndexingSteps file={file({ indexingProgress: schedule })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Step 2/3 — Embedding blocks.');
    const steps = screen.getAllByRole('listitem', { hidden: true });
    expect(steps[0]).toHaveTextContent('1. Document download — Completed');
    expect(steps[1]).toHaveTextContent('2. Block embedding — Processing');
    expect(steps[2]).toHaveTextContent('3. Document storage — Pending');
    // The schedule reads like the status: finished steps green, the running step orange.
    expect(steps[0]).toHaveClass('text-green-700');
    expect(steps[1]).toHaveClass('text-orange-700');
    expect(steps[1]).not.toHaveClass('text-destructive');
  });

  it('shows nothing while the file has no schedule and no failure', () => {
    const { container } = render(<FileIndexingSteps file={file()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the failure reason readable when no schedule is available', () => {
    render(<FileIndexingSteps file={file({ indexingStatus: 'failed', indexingError: 'Indexing server unavailable.' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Indexing server unavailable.');
  });

  it('reports the failed step of a failed schedule and keeps later steps pending', () => {
    render(<FileIndexingSteps file={file({ indexingStatus: 'failed', indexingError: 'Block embedding failed.', indexingProgress: { ...schedule, stepStatus: 'FAIL', processingStatus: 'FAIL', message: 'Block embedding failed.' } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Step 2/3 — Block embedding failed.');
    const steps = screen.getAllByRole('listitem', { hidden: true });
    expect(steps[1]).toHaveTextContent('Block embedding — Failed');
    expect(steps[2]).toHaveTextContent('Document storage — Pending');
  });

  it('does not show a schedule left over from an earlier run', () => {
    const { container } = render(<FileIndexingSteps file={file({ indexingStatus: 'ready', indexingProgress: { ...schedule, processingStatus: 'PROCESSING' } })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('prefers the failure reason over stale progress from a listing', () => {
    render(<FileIndexingSteps file={file({ indexingStatus: 'failed', indexingError: 'Worker stopped.', indexingProgress: schedule })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Worker stopped.');
    expect(screen.queryByText('Embedding blocks.')).not.toBeInTheDocument();
  });

  it('keeps a running file orange even when its schedule still reports an old failure', () => {
    render(<FileIndexingSteps file={file({ indexingStatus: 'processing', indexingProgress: { ...schedule, processingStatus: 'FAIL', stepStatus: 'FAIL', message: 'Old failure from a previous run.' } })} />);
    expect(screen.getByRole('status').closest('summary')).toHaveClass('text-orange-700');
  });
});
