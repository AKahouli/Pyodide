import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { RunHistoryPanel } from './RunHistoryPanel';

const freshness = vi.hoisted(() => ({ data: { state: 'not_runnable', reason: 'Link "documente" matches records on "Clé", which is not filled by any source of Fait.' } as Record<string, unknown> }));
vi.mock('../../query/hooks', () => ({ usePopulationFreshness: () => ({ data: freshness.data }) }));
vi.mock('../../api', () => ({ semanticModelApi: { listPopulationJobs: vi.fn(async () => [
  { jobId: 'j-2', jobType: 'population.run', modelId: 'm', state: 'failed', errorCode: 'attempts_exhausted', result: null,
    createdAt: '2026-10-04T10:00:00Z', startedAt: '2026-10-04T10:00:01Z', completedAt: '2026-10-04T10:00:31Z' },
  { jobId: 'j-1', jobType: 'population.run', modelId: 'm', state: 'completed_with_gaps', errorCode: null,
    result: { purpose: 'build', entityCount: 211, relationshipCount: 227, counts: { gaps: 210 }, changes: { added: 23, changed: 0, removed: 0 } },
    progress: { recent: [{ name: 'emailv3.zip · messages', records: 38, reused: true, status: 'read' }] },
    createdAt: '2026-10-04T09:00:00Z', startedAt: '2026-10-04T09:00:00Z', completedAt: '2026-10-04T09:02:05Z' },
]) } }));

describe('RunHistoryPanel', () => {
  it('lists the runs, newest first, says why the next one cannot start, and opens Review', async () => {
    const onOpenReview = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><RunHistoryPanel modelId='m' onClose={vi.fn()} onOpenReview={onOpenReview} /></QueryClientProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('not filled by any source of Fait');
    fireEvent.click(screen.getByRole('button', { name: 'runHistory.openReview' }));
    expect(onOpenReview).toHaveBeenCalled();
    const states = await screen.findAllByText(/runHistory\.state\./);
    expect(states.map((node) => node.textContent)).toEqual([expect.stringContaining('runHistory.state.failed'), expect.stringContaining('runHistory.state.completed_with_gaps')]);
    expect(screen.getByText('runHistory.error.attempts_exhausted')).toBeInTheDocument();
    // Details: what changed and each source read.
    fireEvent.click(states[1].closest('button')!);
    expect(screen.getByText('emailv3.zip · messages')).toBeInTheDocument();
    expect(screen.getByText('runHistory.changes')).toBeInTheDocument();
  });
});
