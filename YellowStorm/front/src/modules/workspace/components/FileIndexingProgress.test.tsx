import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import type { IndexingProgress } from '../types';
import { FileIndexingProgress } from './FileIndexingProgress';

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

const progress: IndexingProgress = {
  currentStep: 2,
  totalSteps: 3,
  processingStatus: 'PROCESSING',
  stepStatus: 'PROCESSING',
  message: 'Custom operation in progress.',
  steps: [
    { number: 1, name: 'Download', key: 'download' },
    { number: 2, name: 'Custom operation', key: 'custom' },
    { number: 3, name: 'Cleanup', key: 'cleanup' },
  ],
};

describe('FileIndexingProgress', () => {
  it('shows a failure reason even when no step progress is available', () => {
    const { rerender } = render(<FileIndexingProgress status='failed' error='Indexing server unavailable.' />);
    expect(screen.getByRole('status')).toHaveTextContent('Indexing server unavailable.');
    expect(screen.getByRole('status')).toHaveAttribute('title', 'Indexing server unavailable.');
    rerender(<FileIndexingProgress status='failed' />);
    expect(screen.getByRole('status')).toHaveTextContent('Indexing failed');
  });
  it('prioritizes an overall failure over stale processing progress from a listing', () => {
    render(<FileIndexingProgress progress={progress} status='failed' error='Worker stopped.' />);
    expect(screen.getByRole('status')).toHaveTextContent('Worker stopped.');
    expect(screen.queryByText('Custom operation in progress.')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { hidden: true })).not.toBeInTheDocument();
  });

  it('renders the supplied schedule, initial step zero and live updates', () => {
    const { rerender } = render(<FileIndexingProgress progress={{ ...progress, currentStep: 0, message: 'Queued.' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Step 0/3 — Queued.');
    expect(screen.getAllByRole('listitem', { hidden: true }).every((item) => item.textContent?.includes('Pending'))).toBe(true);
    rerender(<FileIndexingProgress progress={progress} />);
    expect(screen.getByRole('status')).toHaveTextContent('Step 2/3 — Custom operation in progress.');
    const steps = within(screen.getByRole('list', { hidden: true })).getAllByRole('listitem', { hidden: true });
    expect(steps[0]).toHaveTextContent('1. Download — Completed');
    expect(steps[1]).toHaveTextContent('2. Custom operation — Processing');
    expect(steps[2]).toHaveTextContent('3. Cleanup — Pending');
  });

  it('keeps later steps pending after a failure', () => {
    render(<FileIndexingProgress progress={{ ...progress, stepStatus: 'FAIL', processingStatus: 'FAIL', message: 'Custom operation failed.' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Step 2/3 — Custom operation failed.');
    const steps = screen.getAllByRole('listitem', { hidden: true });
    expect(steps[1]).toHaveTextContent('Custom operation — Failed');
    expect(steps[2]).toHaveTextContent('Cleanup — Pending');
  });

  it('does not mistake the final step number for workflow success', () => {
    const { rerender } = render(<FileIndexingProgress progress={{ ...progress, currentStep: 3, stepStatus: 'FAIL', processingStatus: 'FAIL', message: 'Cleanup failed.' }} />);
    expect(screen.getAllByRole('listitem', { hidden: true })[2]).toHaveTextContent('Cleanup — Failed');
    expect(screen.getByRole('status')).toHaveTextContent('Step 3/3 — Cleanup failed.');
    rerender(<FileIndexingProgress progress={{ ...progress, currentStep: 3, stepStatus: undefined, processingStatus: 'FINISH', message: 'Document indexing completed successfully.' }} />);
    expect(screen.getAllByRole('listitem', { hidden: true })[2]).toHaveTextContent('Cleanup — Completed');
    expect(screen.getByRole('status')).toHaveTextContent('Document indexing completed successfully.');
  });
});
