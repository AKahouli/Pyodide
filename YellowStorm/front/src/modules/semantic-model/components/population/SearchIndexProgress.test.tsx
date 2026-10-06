import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { SearchIndexProgress } from './SearchIndexProgress';

const api = vi.hoisted(() => ({ searchIndexStatus: vi.fn() }));
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
