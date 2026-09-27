import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConceptSourceMapping } from '../../types';
import { PopulationStartedPanel } from './PopulationStartedPanel';

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
});
