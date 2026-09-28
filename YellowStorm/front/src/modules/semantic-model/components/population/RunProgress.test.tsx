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

  it('rounds durations to what a person reads', () => {
    expect(durationParts(12.4)).toEqual({ unit: 'seconds', count: 12 });
    expect(durationParts(600)).toEqual({ unit: 'minutes', count: 10 });
    expect(durationParts(5400)).toEqual({ unit: 'hours', count: 1.5 });
  });
});
