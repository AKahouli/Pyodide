import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import { FileIndexingDuration } from './FileIndexingDuration';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      let value = en[key as keyof typeof en] ?? key;
      for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{{${name}}}`, String(replacement));
      return value;
    },
  }),
}));

const start = '2026-10-21T10:00:00.000Z';
const completed = '2026-10-21T10:01:23.000Z';

describe('FileIndexingDuration', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(completed)); });
  afterEach(() => { vi.useRealTimers(); });

  it('hydrates from the server start time, ticks while processing and resets on retry', () => {
    const { rerender, unmount } = render(<FileIndexingDuration status='processing' indexingAttemptStartedAt={start} />);
    expect(screen.getByLabelText('Processing time: 1m 23s')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByLabelText('Processing time: 1m 24s')).toBeInTheDocument();
    rerender(<FileIndexingDuration status='pending' indexingAttemptStartedAt={null} indexingAttemptCompletedAt={null} />);
    expect(screen.queryByLabelText(/Processing time/)).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<FileIndexingDuration status='processing' indexingAttemptStartedAt={new Date().toISOString()} indexingAttemptCompletedAt={null} />);
    expect(screen.getByLabelText('Processing time: 0s')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByLabelText('Processing time: 1s')).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['ready', 'failed'] as const)('freezes the server duration on %s and after remount', (status) => {
    const view = render(<FileIndexingDuration status='processing' indexingAttemptStartedAt={start} />);
    view.rerender(<FileIndexingDuration status={status} indexingAttemptStartedAt={start} indexingAttemptCompletedAt={completed} />);
    expect(screen.getByLabelText('Processing time: 1m 23s')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByLabelText('Processing time: 1m 23s')).toBeInTheDocument();
    view.unmount();
    render(<FileIndexingDuration status={status} indexingAttemptStartedAt={start} indexingAttemptCompletedAt={completed} />);
    expect(screen.getByLabelText('Processing time: 1m 23s')).toBeInTheDocument();
  });

  it('hides missing or invalid timestamps instead of inventing a historical duration', () => {
    const { container, rerender } = render(<FileIndexingDuration status='processing' />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FileIndexingDuration status='processing' indexingAttemptStartedAt='invalid' />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FileIndexingDuration status='failed' indexingAttemptStartedAt={start} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FileIndexingDuration status='ready' indexingAttemptStartedAt={completed} indexingAttemptCompletedAt={start} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FileIndexingDuration status='processing' indexingAttemptStartedAt='2026-10-22T10:00:00.000Z' />);
    expect(container).toBeEmptyDOMElement();
  });
});
