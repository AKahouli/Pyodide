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
