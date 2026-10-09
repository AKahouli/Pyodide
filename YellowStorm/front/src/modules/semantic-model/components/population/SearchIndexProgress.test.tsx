import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { SearchIndexProgress } from './SearchIndexProgress';

const api = vi.hoisted(() => ({ searchIndexStatus: vi.fn(), ensureSearchIndex: vi.fn(), restartSearchIndex: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));

const renderIndex = (dataRevisionId?: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <SearchIndexProgress modelId='model-1' dataRevisionId={dataRevisionId} />
</QueryClientProvider>);

describe('SearchIndexProgress', () => {
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

  it('waits while the index still belongs to the previous data', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-1',
      index: { state: 'ready', expectedCount: 10, indexedCount: 10 } });
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.queued')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.counts')).not.toBeInTheDocument();
  });

  it('shows nothing when search is not set up', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-1', index: { state: 'unavailable' } });
    const { container } = renderIndex('dr-1');
    await vi.waitFor(() => expect(api.searchIndexStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
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
    await vi.waitFor(() => expect(api.ensureSearchIndex).toHaveBeenCalledWith('model-1'));
  });

  it('shows an interrupted build as such and builds it again on request', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'failed', lastErrorCode: 'index_interrupted', expectedCount: 200, indexedCount: 50 } });
    api.ensureSearchIndex.mockResolvedValue({});
    renderIndex('dr-2');
    expect(await screen.findByText('population.progress.index.interrupted')).toBeInTheDocument();
    expect(screen.queryByText('index_interrupted')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('population.progress.index.buildAgain'));
    await vi.waitFor(() => expect(api.ensureSearchIndex).toHaveBeenCalledWith('model-1'));
  });

  it('still shows a real failure with its code', async () => {
    api.searchIndexStatus.mockResolvedValue({ modelId: 'model-1', environment: 'draft', dataRevisionId: 'dr-2',
      index: { state: 'failed', lastErrorCode: 'embedding_timeout' } });
    renderIndex('dr-2');
    expect(await screen.findByText('embedding_timeout')).toBeInTheDocument();
    expect(screen.queryByText('population.progress.index.buildAgain')).not.toBeInTheDocument();
  });
});
