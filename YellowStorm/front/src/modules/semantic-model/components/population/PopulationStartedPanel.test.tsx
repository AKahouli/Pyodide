import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConceptSourceMapping } from '../../types';
import { PopulationStartedPanel, populationServing } from './PopulationStartedPanel';

const mappings = [
  { id: 'mapping-1', documentName: 'master-agreement-0041.pdf' },
  { id: 'mapping-2', documentName: 'master-agreement-0099.pdf' },
] as ConceptSourceMapping[];

describe('PopulationStartedPanel', () => {
  it('confirms the run and says nothing was left out', () => {
    render(<PopulationStartedPanel outcome={{ jobId:'job-1', status:'queued', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} />);

    expect(screen.getByText('population.started')).toBeInTheDocument();
    expect(screen.getByText('population.allSourcesIncluded')).toBeInTheDocument();
  });

  it('names every source that will not be read, with its reason', () => {
    render(<PopulationStartedPanel
      outcome={{ jobId:'job-1', status:'queued', skipped: [{ mappingId: 'mapping-2', reason: 'no logical index yet' }], reused: false }}
      sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()}
    />);

    expect(screen.getByText('master-agreement-0099.pdf')).toBeInTheDocument();
    expect(screen.getByText('no logical index yet')).toBeInTheDocument();
    expect(screen.queryByText('population.allSourcesIncluded')).not.toBeInTheDocument();
  });

  it('falls back to a neutral label when the skipped mapping is unknown', () => {
    render(<PopulationStartedPanel
      outcome={{ jobId:'job-1', status:'queued', skipped: [{ mappingId: 'gone', reason: 'source disabled' }], reused: false }}
      sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()}
    />);

    expect(screen.getByText('population.unknownSource')).toBeInTheDocument();
  });

  it('says a new run has finished once its job completes', () => {
    render(<PopulationStartedPanel outcome={{ jobId:'job-1', status:'completed', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} />);

    expect(screen.getByText('population.done')).toBeInTheDocument();
    expect(screen.queryByText('population.started')).not.toBeInTheDocument();
  });

  it('reports a run that was already in flight', () => {
    render(<PopulationStartedPanel outcome={{ jobId:'job-1', status:'running', skipped: [], reused: true }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} />);

    expect(screen.getByText('population.alreadyRunning')).toBeInTheDocument();
  });

  it('does not claim a reused finished run is still reading', () => {
    render(<PopulationStartedPanel outcome={{ jobId:'job-1', status:'completed_with_gaps', skipped: [], reused: true }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} />);

    expect(screen.getByText('population.finishedWithGaps')).toBeInTheDocument();
    expect(screen.queryByText('population.alreadyRunning')).not.toBeInTheDocument();
    expect(screen.getByText('population.reusedNotice')).toBeInTheDocument();
  });

  it('reports a reused run that had failed', () => {
    render(<PopulationStartedPanel outcome={{ jobId:'job-1', status:'failed', skipped: [], reused: true }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} />);

    expect(screen.getByText('population.failed')).toBeInTheDocument();
    expect(screen.getByText('population.reusedNotice')).toBeInTheDocument();
  });

  it('hands the reader on to model health', () => {
    const onOpenHealth = vi.fn();
    render(<PopulationStartedPanel outcome={{ jobId:'job-1', status:'queued', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={onOpenHealth} />);

    fireEvent.click(screen.getByRole('button', { name: 'population.openHealth' }));

    expect(onOpenHealth).toHaveBeenCalled();
  });

  it('offers Stop while the run goes on, then says it stopped without changing the data', () => {
    const onStop = vi.fn();
    const { rerender } = render(<PopulationStartedPanel outcome={{ jobId: 'job-1', status: 'running', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'runStop.stop' }));
    expect(onStop).toHaveBeenCalled();

    rerender(<PopulationStartedPanel outcome={{ jobId: 'job-1', status: 'cancel_requested', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} onStop={onStop} />);
    expect(screen.getByText('runStop.stoppingHint')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'runStop.stop' })).not.toBeInTheDocument();

    rerender(<PopulationStartedPanel outcome={{ jobId: 'job-1', status: 'cancelled', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} onStop={onStop} />);
    expect(screen.getByText('runStop.stopped')).toBeInTheDocument();
    expect(screen.getByText('runStop.stoppedHint')).toBeInTheDocument();
  });

  it('has no Stop for someone who cannot stop the run', () => {
    render(<PopulationStartedPanel outcome={{ jobId: 'job-1', status: 'running', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'runStop.stop' })).not.toBeInTheDocument();
  });

  it('says the graph in use was kept when the run is missing data, and why', () => {
    render(<PopulationStartedPanel outcome={{ jobId: 'job-1', status: 'completed_with_gaps', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()}
      serving={populationServing({ servingDecision: 'keep_previous', blockingGapKinds: ['source_unavailable', 'something_new'] })} />);
    expect(screen.getByText('runServing.kept')).toBeInTheDocument();
    expect(screen.getByText('runServing.kind_source_unavailable')).toBeInTheDocument();
    expect(screen.getByText('runServing.kind_other')).toBeInTheDocument();
  });

  it('says a first graph is incomplete, and says nothing for a complete run', () => {
    const { rerender } = render(<PopulationStartedPanel outcome={{ jobId: 'job-1', status: 'completed_with_gaps', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()}
      serving={populationServing({ servingDecision: 'activate', blockingGapKinds: ['enumeration_capped'] })} />);
    expect(screen.getByText('runServing.firstIncomplete')).toBeInTheDocument();
    rerender(<PopulationStartedPanel outcome={{ jobId: 'job-1', status: 'completed', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()}
      serving={populationServing({ servingDecision: 'activate', blockingGapKinds: [] })} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(populationServing({ dataRevisionId: 'r' })).toBeUndefined();
  });
});
