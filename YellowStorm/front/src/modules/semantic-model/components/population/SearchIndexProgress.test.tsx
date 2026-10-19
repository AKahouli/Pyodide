import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchIndexProgress } from './SearchIndexProgress';

const api = vi.hoisted(() => ({ searchIndexStatus: vi.fn(), ensureSearchIndex: vi.fn(), restartSearchIndex: vi.fn(), refreshPopulation: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));
beforeEach(() => vi.clearAllMocks());

const renderIndex = (dataRevisionId?: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <SearchIndexProgress modelId='model-1' dataRevisionId={dataRevisionId} />
</QueryClientProvider>);

describe('SearchIndexProgress', () => {
  it('retries an exhausted generation only once while pending and retains its failure during the new attempt', async () => {
    const failed = { modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2', index: {
      indexId: 'ix-1', state: 'failed', lastErrorCode: 'attempts_exhausted', errorDetails: {
        code: 'DataError', errorType: 'DataError', message: 'Retained failure', occurredAt: '2026-10-15T09:02:15Z',
      },
    } };
    const queued = { ...failed, index: { indexId: 'ix-1', state: 'queued' } };
    api.searchIndexStatus.mockResolvedValue(failed);
    let finish!: (value: unknown) => void;
    api.ensureSearchIndex.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderIndex('dr-2');
    const retry = await screen.findByRole('button', { name: 'searchIndexRetry.action' });
    act(() => { fireEvent.click(retry); fireEvent.click(retry); });
    expect(api.ensureSearchIndex).toHaveBeenCalledTimes(1);
    expect(api.ensureSearchIndex).toHaveBeenCalledWith('model-1', 'draft', { expectedDataRevisionId: 'dr-2', expectedIndexId: 'ix-1' });
    expect(retry).toBeDisabled();
    expect(screen.getByText('Retained failure')).toBeVisible();
    api.searchIndexStatus.mockResolvedValue(queued);
    await act(async () => { finish(queued); });
    expect(await screen.findByText('population.progress.index.queued')).toBeVisible();
    expect(screen.getByText('Retained failure')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'searchIndexRetry.action' })).not.toBeInTheDocument();
    expect(api.refreshPopulation).not.toHaveBeenCalled();
  });

  it('keeps diagnostics and permits another request after a retry error', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { indexId: 'ix-1', state: 'failed', lastErrorCode: 'attempts_exhausted' } });
    api.ensureSearchIndex.mockRejectedValue(new Error('network unavailable'));
    renderIndex('dr-2');
    const retry = await screen.findByRole('button', { name: 'searchIndexRetry.action' });
    await act(async () => { fireEvent.click(retry); });
    await vi.waitFor(() => expect(retry).not.toBeDisabled());
    expect(screen.getAllByText('attempts_exhausted').length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(retry); });
    expect(api.ensureSearchIndex).toHaveBeenCalledTimes(2);
  });

  it('polls a queued retry through to ready', async () => {
    const failed = { modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { indexId: 'ix-1', state: 'failed', lastErrorCode: 'attempts_exhausted' } };
    const queued = { ...failed, index: { indexId: 'ix-1', state: 'queued' } };
    const ready = { ...failed, index: { indexId: 'ix-1', state: 'ready' } };
    api.searchIndexStatus.mockResolvedValueOnce(failed).mockResolvedValueOnce(queued).mockResolvedValue(ready);
    api.ensureSearchIndex.mockResolvedValue(queued);
    renderIndex('dr-2');
    fireEvent.click(await screen.findByRole('button', { name: 'searchIndexRetry.action' }));
    expect(await screen.findByText('population.progress.index.queued')).toBeVisible();
    expect(await screen.findByText('population.progress.index.ready', {}, { timeout: 4500 })).toBeVisible();
    expect(api.searchIndexStatus).toHaveBeenCalledTimes(3);
  });

  it('never offers retry for the previous data revision', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', dataRevisionId: 'dr-1',
      index: { indexId: 'ix-1', state: 'failed', lastErrorCode: 'attempts_exhausted' } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.queued')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['active_binding_changed', 'revisionChanged'], ['index_identity_changed', 'identityChanged'],
  ])('explains %s and requires an explicit status refresh before another retry', async (reason, key) => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { indexId: 'ix-1', state: 'failed', lastErrorCode: 'attempts_exhausted' } });
    // The shared client's interceptor rejects the unwrapped error, not AxiosError.
    api.ensureSearchIndex.mockRejectedValue({ code: 'ERR_4008', statusCode: 409, message: reason });
    renderIndex('dr-2');
    const retry = await screen.findByRole('button', { name: 'searchIndexRetry.action' });
    await act(async () => { fireEvent.click(retry); });
    expect(await screen.findByText(`searchIndexRetry.${key}`)).toBeVisible();
    expect(screen.getByRole('button', { name: 'searchIndexRetry.action' })).toBeDisabled();
    api.searchIndexStatus.mockRejectedValueOnce(new Error('Status refresh failed'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'searchIndexRetry.refresh' })); });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'searchIndexRetry.refresh' })).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'searchIndexRetry.action' })).toBeDisabled();
    expect(screen.getByText(`searchIndexRetry.${key}`)).toHaveAttribute('role', 'alert');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'searchIndexRetry.refresh' })); });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'searchIndexRetry.action' })).not.toBeDisabled());
    expect(api.ensureSearchIndex).toHaveBeenCalledTimes(1);
    expect(api.searchIndexStatus).toHaveBeenCalledTimes(3);
  });

  it('does not turn a missing generation after a configuration change into an automatic retry', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { indexId: null, state: 'missing' } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.missing')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'searchIndexRetry.action' })).not.toBeInTheDocument();
    expect(api.ensureSearchIndex).not.toHaveBeenCalled();
  });
  it('explicitly builds a missing index from the current revision once while pending', async () => {
    const missing = { modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2', index: { state: 'missing', indexId: null } };
    api.searchIndexStatus.mockResolvedValue(missing);
    let finish!: (value: unknown) => void;
    api.ensureSearchIndex.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { container } = renderIndex('dr-2');
    const build = await screen.findByRole('button', { name: 'searchIndexRetry.buildMissing' });
    expect(screen.getByText('searchIndexRetry.missingHint')).toBeVisible();
    expect(screen.queryByText('population.progress.index.failed')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(api.ensureSearchIndex).not.toHaveBeenCalled();
    act(() => { fireEvent.click(build); fireEvent.click(build); });
    expect(api.ensureSearchIndex).toHaveBeenCalledTimes(1);
    expect(api.ensureSearchIndex).toHaveBeenCalledWith('model-1', 'draft', { expectedDataRevisionId: 'dr-2' });
    expect(build).toBeDisabled();
    const queued = { ...missing, index: { state: 'queued', indexId: 'ix-new' } };
    api.searchIndexStatus.mockResolvedValue(queued);
    await act(async () => { finish(queued); });
    expect(await screen.findByText('population.progress.index.queued')).toBeVisible();
    expect(api.refreshPopulation).not.toHaveBeenCalled();
  });

  it('shows missing data without an admission button', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: null,
      index: { state: 'missing', indexId: null } });
    renderIndex();
    expect(await screen.findByText('searchIndexRetry.noData')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(api.ensureSearchIndex).not.toHaveBeenCalled();
  });

  it('keeps a missing index from a stale revision nonactionable', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-old',
      index: { state: 'missing', indexId: null } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.queued')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows initial loading rather than an empty panel', () => {
    api.searchIndexStatus.mockImplementation(() => new Promise(() => {}));
    renderIndex('dr-2');
    expect(screen.getByRole('status')).toHaveTextContent('searchIndexRetry.loading');
  });

  it('shows a safe status error and recovers through explicit refresh', async () => {
    api.searchIndexStatus.mockRejectedValue(new Error('private transport details'));
    renderIndex('dr-2');
    expect(await screen.findByRole('alert')).toHaveTextContent('searchIndexRetry.unavailable');
    expect(screen.queryByText('private transport details')).not.toBeInTheDocument();
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2', index: { state: 'ready' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'searchIndexRetry.refresh' })); });
    expect(await screen.findByText('population.progress.index.ready')).toBeVisible();
    expect(api.ensureSearchIndex).not.toHaveBeenCalled();
  });

  it('preserves cached failure diagnostics if a later status read fails', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'failed', indexId: 'ix-1', lastErrorCode: 'attempts_exhausted', errorDetails: {
        code: 'DataError', errorType: 'DataError', message: 'Retained diagnostic', occurredAt: '2026-10-15T09:02:15Z',
      } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SearchIndexProgress modelId='model-1' dataRevisionId='dr-2' /></QueryClientProvider>);
    expect(await screen.findByText('Retained diagnostic')).toBeVisible();
    api.searchIndexStatus.mockRejectedValue(new Error('private transport details'));
    await act(async () => { await client.invalidateQueries(); });
    expect(await screen.findByText('searchIndexRetry.unavailable')).toBeVisible();
    expect(screen.getByText('Retained diagnostic')).toBeVisible();
    expect(screen.getByRole('button', { name: 'searchIndexRetry.action' })).toBeDisabled();
    expect(screen.queryByText('private transport details')).not.toBeInTheDocument();
  });
  it('shows the retained root failure rather than only the exhausted retry code', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', dataRevisionId: 'dr-2',
      index: { state: 'failed', lastErrorCode: 'attempts_exhausted', errorDetails: {
        code: 'DataError', errorType: 'DataError', message: 'Database argument 3 has an incompatible type.',
        occurredAt: '2026-10-15T09:02:15Z', jobId: 'index-job', sqlState: '22000',
      } } });
    renderIndex('dr-2');
    expect(await screen.findByText('Database argument 3 has an incompatible type.')).toBeVisible();
    fireEvent.click(screen.getByText('runtimeError.technical'));
    expect(screen.getByText('index-job')).toBeVisible();
    expect(screen.getByText('22000')).toBeVisible();
  });
  it('follows the index of the new data while it builds, records and passages', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'indexing', expectedCount: 200, indexedCount: 50, exactOnlyCount: 0, passageCount: 100, passageIndexedCount: 0 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.indexing')).toBeInTheDocument();
    expect(screen.getByText('population.progress.index.counts')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows how far the records are read while the cards are written', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'indexing', stage: 'documents', expectedCount: 8400, loadedCount: 2100, indexedCount: 0, passageCount: 40 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.reading')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '2100');
    expect(bar).toHaveAttribute('aria-valuemax', '8400');
  });

  it('does not pass a finished read at 100% for a live build', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'indexing', stage: 'documents', expectedCount: 8400, loadedCount: 8400, indexedCount: 0, passageCount: 40 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.preparing')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.reading')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/population\.progress\.index\.percent/)).not.toBeInTheDocument();
  });

  it('says it reuses earlier vectors while the cache is filled', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'indexing', stage: 'reusing', expectedCount: 8400, loadedCount: 8400, indexedCount: 300, exactOnlyCount: 0, passageCount: 0 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.reusing')).toBeInTheDocument();
    expect(screen.getByText('population.progress.index.countsRecords')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows the percent and the records indexed so far while embedding', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'indexing', stage: 'embedding', expectedCount: 8400, loadedCount: 8400, indexedCount: 1200, exactOnlyCount: 0, passageCount: 0, passageIndexedCount: 0 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.countsRecords')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.counts')).not.toBeInTheDocument();
    expect(screen.getByText(/population\.progress\.index\.percent/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1200');
  });

  it('shows the unchanged records being carried over from the previous index, with the three counts', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'indexing', stage: 'carrying', expectedCount: 8400, loadedCount: 3000, indexedCount: 0, buildMode: 'incremental', carriedCount: 3000, rebuiltCount: 0, embeddedCount: 0 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.carrying')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3000');
    expect(screen.getByText('population.progress.index.incremental')).toBeInTheDocument();
  });

  it('shows the comparison with the previous index as a counted step', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'indexing', stage: 'comparing', expectedCount: 8400, loadedCount: 5000, indexedCount: 0 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.comparing')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5000');
    expect(screen.queryByText('population.progress.index.incremental')).not.toBeInTheDocument();
  });

  it('keeps the carried, rebuilt and embedded counts once an incremental index is ready', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'ready', expectedCount: 8400, indexedCount: 8400, buildMode: 'incremental', carriedCount: 8250, rebuiltCount: 150, embeddedCount: 150 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.incremental')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.full')).not.toBeInTheDocument();
  });

  it('says why a build was full', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'ready', expectedCount: 100, indexedCount: 100, buildMode: 'full', buildReason: 'too_many_changes', rebuiltCount: 100, embeddedCount: 100 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.full')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.incremental')).not.toBeInTheDocument();
  });

  it('waits while the index still belongs to the previous data', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-1',
      index: { state: 'ready', expectedCount: 10, indexedCount: 10 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.queued')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.counts')).not.toBeInTheDocument();
  });

  it('shows unavailable search status and lets the person refresh it', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-1', index: { state: 'unavailable' } });
    renderIndex('dr-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('searchIndexRetry.unavailable');
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-1', index: { state: 'ready' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'searchIndexRetry.refresh' })); });
    expect(await screen.findByText('population.progress.index.ready')).toBeVisible();
  });
});

describe('SearchIndexProgress when the worker stopped responding', () => {
  const stalledStatus = (index: Record<string, unknown>) => ({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
    index: { state: 'indexing', stage: 'embedding', expectedCount: 200, indexedCount: 50, stalled: true, ...index } });

  it('warns with the time of the last progress and restarts the build on request', async () => {
    api.searchIndexStatus.mockResolvedValue(stalledStatus({ lastProgressAt: '2026-10-09T06:31:00.000Z' }));
    api.restartSearchIndex.mockResolvedValue({ restarted: true });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.stalled')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText('population.progress.index.restart'));
    await vi.waitFor(() => expect(api.restartSearchIndex).toHaveBeenCalledWith('model-1'));
    expect(api.ensureSearchIndex).not.toHaveBeenCalled();
  });

  it('still warns when the time of the last progress is not known', async () => {
    api.searchIndexStatus.mockResolvedValue(stalledStatus({ lastProgressAt: null }));
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.stalledUnknown')).toBeInTheDocument();
  });

  it('shows no warning and no restart while the build progresses', async () => {
    api.searchIndexStatus.mockResolvedValue(stalledStatus({ stalled: false, lastProgressAt: '2026-10-09T06:31:00.000Z' }));
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.indexing')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.restart')).not.toBeInTheDocument();
  });
});

describe('SearchIndexProgress after a stop', () => {
  it('shows a build stopped on request as stopped, not failed, and builds it again on request', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'failed', lastErrorCode: 'cancelled', expectedCount: 200, indexedCount: 50 } });
    api.ensureSearchIndex.mockResolvedValue({});
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.stopped')).toBeInTheDocument();
    expect(screen.queryByText('cancelled')).not.toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.failed')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('population.progress.index.buildAgain'));
    await vi.waitFor(() => expect(api.ensureSearchIndex).toHaveBeenCalledWith('model-1', 'draft', { expectedDataRevisionId: 'dr-2' }));
  });

  it('shows an interrupted build as such and builds it again on request', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'failed', lastErrorCode: 'index_interrupted', expectedCount: 200, indexedCount: 50 } });
    api.ensureSearchIndex.mockResolvedValue({});
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.interrupted')).toBeInTheDocument();
    expect(screen.queryByText('index_interrupted')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('population.progress.index.buildAgain'));
    await vi.waitFor(() => expect(api.ensureSearchIndex).toHaveBeenCalledWith('model-1', 'draft', { expectedDataRevisionId: 'dr-2' }));
  });

  it('still shows a real failure with its code', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'failed', lastErrorCode: 'embedding_timeout' } });
    renderIndex('dr-2');
    expect(await screen.findByText('embedding_timeout')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.buildAgain')).not.toBeInTheDocument();
  });
});
