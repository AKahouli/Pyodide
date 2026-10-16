import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PopulationJobQueue } from '../../types';
import { QueuedRunNotice, queueUnattended } from './QueuedRunNotice';

// Keep the interpolation values visible: the global mock returns the bare key.
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key }),
}));

const NOW = Date.parse('2026-10-10T12:00:00Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const queue = (overrides: Partial<PopulationJobQueue> = {}): PopulationJobQueue => ({
  queueName: 'semantic-model-population.batch', position: 3, ahead: { running: 1, queued: 1 }, workersOnline: 1, ...overrides });

describe('QueuedRunNotice', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it('shows the place in the queue with the jobs ahead', () => {
    render(<QueuedRunNotice queue={queue()} queuedSince={ago(30)} />);
    expect(screen.getByRole('status')).toHaveTextContent('population.queued.position {"position":3,"running":1,"queued":1}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says it is next when nothing is ahead', () => {
    render(<QueuedRunNotice queue={queue({ position: 1, ahead: { running: 0, queued: 0 } })} queuedSince={ago(2)} />);
    expect(screen.getByRole('status')).toHaveTextContent('population.queued.next');
  });

  it('warns that no worker is available once the job has waited past the grace period', () => {
    render(<QueuedRunNotice queue={queue({ workersOnline: 0 })} queuedSince={ago(11)} />);
    expect(screen.getByRole('alert')).toHaveTextContent('population.queued.noWorkerTitle');
    expect(screen.getByRole('alert')).toHaveTextContent('population.queued.noWorkerDevHint');
    expect(screen.queryByText(/population\.queued\.position/)).not.toBeInTheDocument();
  });

  it('keeps showing the position until the grace period passes, then turns into the warning', () => {
    render(<QueuedRunNotice queue={queue({ workersOnline: 0 })} queuedSince={ago(5)} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not warn when the workers are unknown', () => {
    render(<QueuedRunNotice queue={queue({ workersOnline: null })} queuedSince={ago(120)} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('decides the warning from workers and waiting time only', () => {
    expect(queueUnattended(queue({ workersOnline: 0 }), null)).toBe(false);
    expect(queueUnattended(queue({ workersOnline: 0 }), 10)).toBe(false);
    expect(queueUnattended(queue({ workersOnline: 0 }), 10.5)).toBe(true);
    expect(queueUnattended(queue({ workersOnline: 2 }), 600)).toBe(false);
  });
});
