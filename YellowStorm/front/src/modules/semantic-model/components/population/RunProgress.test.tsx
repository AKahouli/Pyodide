import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { durationParts, RunProgress } from './RunProgress';

describe('RunProgress', () => {
  it('shows how far a run got, what it found, what it is reading and what it just read', () => {
    vi.useFakeTimers({ now: new Date('2026-09-27T10:01:00Z') });
    render(<RunProgress running conceptLabels={{ contract: 'Contract' }} progress={{
      phase: 'reading', total: 400, done: 100, reused: 60, records: 1234, gaps: 5,
      startedAt: '2026-09-27T10:00:00Z',
      current: { name: 'agreement-101.pdf', conceptId: 'contract' },
      recent: [
        { name: 'agreement-100.pdf', conceptId: 'contract', status: 'processed_complete', records: 1, reused: false },
        { name: 'agreement-099.pdf', conceptId: 'contract', status: 'processed_complete', records: 1, reused: true },
        { name: 'agreement-098.pdf', conceptId: 'contract', status: 'processed_with_gaps', records: 1, reused: false },
      ],
    }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('25%')).toBeInTheDocument();
    // toLocaleString() groups with a comma or a (narrow) space per runner locale.
    expect(screen.getByText(/^1[,\s]234$/)).toBeInTheDocument();
    expect(screen.getByText('agreement-101.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText('population.progress.reusedOne')).toBeInTheDocument();
    expect(screen.getByLabelText('population.progress.issueOne')).toBeInTheDocument();
    // 40 files read in 60 s (reused ones take no time), so there is a time left to show.
    expect(screen.getByText(/population.progress.left/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('says it finished once the run ends, without a file in progress', () => {
    render(<RunProgress running={false} progress={{ phase: 'saving', total: 2, done: 2, reused: 0, records: 3, gaps: 0,
      current: { name: 'stale.pdf' }, recent: [] }} />);
    expect(screen.getByText('population.progress.finished')).toBeInTheDocument();
    expect(screen.queryByText('stale.pdf')).not.toBeInTheDocument();
  });

  it('shows what the run changed, and the files it no longer read', () => {
    render(<RunProgress running={false} progress={{ phase: 'saving', total: 1, done: 1, reused: 1, records: 2, gaps: 0, current: null, recent: [],
      changes: { added: 0, removed: 1, changed: 2, removedSources: [{ assetId: 'doc-1', name: 'amendment-01.pdf', records: 1 }] } }} />);
    expect(screen.getByText('−population.progress.removed')).toBeInTheDocument();
    expect(screen.getByText('population.progress.changed')).toBeInTheDocument();
    expect(screen.queryByText('+population.progress.added')).not.toBeInTheDocument();
    expect(screen.getByText('amendment-01.pdf')).toBeInTheDocument();
    expect(screen.getByText('population.progress.recordsRemoved')).toBeInTheDocument();
  });

  it('says when a run changed nothing', () => {
    render(<RunProgress running={false} progress={{ phase: 'saving', total: 1, done: 1, reused: 1, records: 2, gaps: 0, current: null, recent: [],
      changes: { added: 0, removed: 0, changed: 0, removedSources: [] } }} />);
    expect(screen.getByText('population.progress.noChanges')).toBeInTheDocument();
  });

  it('rounds durations to what a person reads', () => {
    expect(durationParts(12.4)).toEqual({ unit: 'seconds', count: 12 });
    expect(durationParts(600)).toEqual({ unit: 'minutes', count: 10 });
    expect(durationParts(5400)).toEqual({ unit: 'hours', count: 1.5 });
  });
});

describe('RunProgress steps and AI calls', () => {
  const base = { phase: 'reading' as const, total: 1, done: 0, reused: 0, records: 0, gaps: 0, startedAt: '2026-09-27T10:00:00Z', current: null, recent: [] };

  it('says how far the source under way is, and that an archive is still opening', () => {
    const { rerender } = render(<RunProgress running progress={{ ...base, step: { unit: 'rows', done: 5000, total: 25000 } }} />);
    expect(screen.getByText('population.progress.step.rows')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    rerender(<RunProgress running progress={{ ...base, step: { unit: 'opening', done: 0, total: null } }} />);
    expect(screen.getByText('population.progress.step.openingUnknown')).toBeInTheDocument();
  });

  it('counts the AI calls answered, reused, failed and left over the limit', () => {
    render(<RunProgress running progress={{ ...base, ai: { planned: 40, answered: 12, reused: 5, skipped: 3, failed: 1 } }} />);
    expect(screen.getByLabelText('population.progress.ai.title')).toBeInTheDocument();
    expect(screen.getByText('population.progress.ai.done')).toBeInTheDocument();
    expect(screen.getByText('population.progress.ai.failed')).toBeInTheDocument();
    expect(screen.getByText('population.progress.ai.skipped')).toBeInTheDocument();
  });

  it('follows the saved records, not the sources read, once every source is read', () => {
    render(<RunProgress running progress={{ ...base, phase: 'saving', total: 3, done: 3, step: { unit: 'entries', done: 1000, total: 4000 } }} />);
    expect(screen.getByText('population.progress.phase.saving')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1000');
    expect(bar).toHaveAttribute('aria-valuemax', '4000');
    expect(screen.getByText('population.progress.step.entries')).toBeInTheDocument();
    // The sources-read count stays as a secondary line.
    expect(screen.getByText(/population.progress.filesRead/)).toBeInTheDocument();
  });

  it('shows the graph being built with its own count, and no percent while the step has no total', () => {
    const { rerender } = render(<RunProgress running progress={{ ...base, phase: 'projecting', total: 3, done: 3, step: { unit: 'elements', done: 500, total: 2000 } }} />);
    expect(screen.getByText('population.progress.phase.projecting')).toBeInTheDocument();
    expect(screen.getByText('population.progress.step.elements')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    rerender(<RunProgress running progress={{ ...base, phase: 'projecting', total: 3, done: 3, step: { unit: 'loading', done: 0, total: null } }} />);
    expect(screen.getByText('population.progress.step.loadingUnknown')).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    rerender(<RunProgress running progress={{ ...base, phase: 'comparing', total: 3, done: 3 }} />);
    expect(screen.getByText('population.progress.phase.comparing')).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('shows no step once the run is over', () => {
    render(<RunProgress running={false} progress={{ ...base, done: 1, step: { unit: 'rows', done: 10, total: 10 } }} />);
    expect(screen.queryByText('population.progress.step.rows')).not.toBeInTheDocument();
  });
});
