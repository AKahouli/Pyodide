import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RuntimeErrorDetails } from '../../types';
import { RuntimeFailureDetails } from './RuntimeFailureDetails';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import ar from '../../locales/ar.json';

const failure: RuntimeErrorDetails = {
  code: 'DataError', errorType: 'DataError', message: 'Database argument 3 has an incompatible type.',
  occurredAt: '2026-10-15T09:02:15Z', phase: 'embedding', attempt: 3,
  jobId: 'job-original', taskId: '600', indexId: 'index-original', sqlState: '22000',
  frames: [{ file: 'app/graph_search/indexer.py', function: 'build_index', line: 203 }],
  causes: [{ errorType: 'ValueError', message: 'An integer is required.' }],
};

describe('RuntimeFailureDetails', () => {
  it('provides every diagnostic label in English, French and Arabic', () => {
    for (const locale of [fr, ar]) {
      expect(Object.keys(locale.runtimeError).sort()).toEqual(Object.keys(en.runtimeError).sort());
      expect(Object.values(locale.runtimeError).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
  it('shows the original cause and provides expandable technical context through retry exhaustion', () => {
    render(<RuntimeFailureDetails details={failure} code='attempts_exhausted' />);
    expect(screen.getByText(failure.message)).toBeVisible();
    fireEvent.click(screen.getByText('runtimeError.technical'));
    expect(screen.getByText('job-original')).toBeVisible();
    expect(screen.getByText('600')).toBeVisible();
    expect(screen.getByText('index-original')).toBeVisible();
    expect(screen.getByText('22000')).toBeVisible();
    expect(screen.getByText(/app\/graph_search\/indexer.py:203/)).toBeVisible();
    expect(screen.getByText('ValueError')).toBeVisible();
    expect(screen.queryByText('runtimeError.legacy')).not.toBeInTheDocument();
  });

  it('does not fabricate details for legacy failures and retains the correlation ID', () => {
    render(<RuntimeFailureDetails code='attempts_exhausted' jobId='old-job' />);
    expect(screen.getByText('runtimeError.legacy')).toBeVisible();
    fireEvent.click(screen.getByText('runtimeError.technical'));
    expect(screen.getByText('attempts_exhausted')).toBeVisible();
    expect(screen.getByText('old-job')).toBeVisible();
  });

  it('renders diagnostics as text and ignores extra untrusted payload properties', () => {
    const untrusted = { ...failure, message: '<script>unsafe()</script>', rawRequest: 'PRIVATE_REQUEST' };
    const { container } = render(<RuntimeFailureDetails details={untrusted} />);
    expect(screen.getByText('<script>unsafe()</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.queryByText('PRIVATE_REQUEST')).not.toBeInTheDocument();
  });
});
