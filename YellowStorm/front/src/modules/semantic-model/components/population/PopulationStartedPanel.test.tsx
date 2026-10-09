import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConceptSourceMapping } from '../../types';
import { PopulationStartedPanel, populationServing, runCanStop } from './PopulationStartedPanel';

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

  it('shows the progress of a refresh that reads no file: its AI calls and records', () => {
    render(<PopulationStartedPanel outcome={{ jobId:'job-1', status:'running', skipped: [], reused: false }} sourceMappings={mappings}
      progress={{ phase: 'making', total: 0, done: 0, records: 121, ai: { planned: 400, answered: 37, reused: 0, failed: 0, skipped: 0 } }}
      onClose={vi.fn()} onOpenHealth={vi.fn()} />);

    expect(screen.getByLabelText('population.progress.title')).toBeInTheDocument();
    expect(screen.getByText('121')).toBeInTheDocument();
    expect(screen.getByLabelText('population.progress.ai.title')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.filesRead')).not.toBeInTheDocument();
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

  it('says why a run failed when the runtime gave a reason', () => {
    render(<PopulationStartedPanel outcome={{ jobId:'job-1', status:'failed', skipped: [], reused: false, errorCode: 'no_data_in_use' }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()} />);

    expect(screen.getByText('runHistory.error.no_data_in_use')).toBeInTheDocument();
    expect(screen.queryByText('population.failedHint')).not.toBeInTheDocument();
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

  it('tells a source limit the person set apart from missing data: an info line, no warning', () => {
    const serving = populationServing({ servingDecision: 'activate', blockingGapKinds: [],
      userSampleLimits: [{ conceptId: 'c1', read: 10, total: 25000, limit: 10 }, { conceptId: 'c2', read: 5 }, { read: 1 }] });
    expect(serving?.samples).toEqual([{ conceptId: 'c1', read: 10, total: 25000 }, { conceptId: 'c2', read: 5 }]);
    render(<PopulationStartedPanel outcome={{ jobId: 'job-1', status: 'completed', skipped: [], reused: false }} sourceMappings={mappings} onClose={vi.fn()} onOpenHealth={vi.fn()}
      serving={serving} conceptLabels={{ c1: 'Message' }} />);
    expect(screen.getByText('runServing.sampleTitle')).toBeInTheDocument();
    expect(screen.getByText('runServing.userSample')).toBeInTheDocument();
    expect(screen.getByText('runServing.userSampleUnknownTotal')).toBeInTheDocument();
    expect(screen.queryByText('runServing.kept')).not.toBeInTheDocument();
    expect(screen.queryByText('runServing.firstIncomplete')).not.toBeInTheDocument();
    expect(populationServing({ servingDecision: 'activate', blockingGapKinds: [] })?.samples).toBeUndefined();
  });
});

describe('PopulationStartedPanel stop', () => {
  const running = { jobId: 'job-1', status: 'running', skipped: [], reused: false };

  it('stops a run that is still reading', () => {
    const onStop = vi.fn();
    render(<PopulationStartedPanel outcome={running} sourceMappings={mappings} progress={{ phase: 'reading', total: 2, done: 1 }}
      onClose={vi.fn()} onOpenHealth={vi.fn()} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'runStop.stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('keeps Stop disabled, saying why, once the data is being saved', () => {
    const onStop = vi.fn();
    render(<PopulationStartedPanel outcome={running} sourceMappings={mappings} progress={{ phase: 'saving', total: 2, done: 2, cancellable: false }}
      onClose={vi.fn()} onOpenHealth={vi.fn()} onStop={onStop} />);
    const button = screen.getByRole('button', { name: /runStop\.stop/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName('runStop.stop: runStop.notNow');
    fireEvent.click(button);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('knows a run can no longer be stopped from its phase or its flag', () => {
    expect(runCanStop(undefined)).toBe(true);
    expect(runCanStop({ phase: 'reading' })).toBe(true);
    expect(runCanStop({ phase: 'linking', cancellable: true })).toBe(true);
    for (const phase of ['saving', 'comparing', 'projecting'] as const) expect(runCanStop({ phase })).toBe(false);
    expect(runCanStop({ phase: 'reading', cancellable: false })).toBe(false);
  });
  it('tells when a stop takes long: the worker may be gone and the run ends when its lease runs out', () => {
    const outcome = { jobId: 'job-1', status: 'cancel_requested', skipped: [], reused: false };
    const { rerender } = render(<PopulationStartedPanel outcome={outcome} sourceMappings={mappings} stopping onClose={vi.fn()} onOpenHealth={vi.fn()} />);
    expect(screen.getByText('runStop.stoppingHint')).toBeInTheDocument();

    rerender(<PopulationStartedPanel outcome={outcome} sourceMappings={mappings} stopping stoppingSlow onClose={vi.fn()} onOpenHealth={vi.fn()} />);
    expect(screen.getByText('runStatus.stoppingSlowHint')).toBeInTheDocument();
  });
});
