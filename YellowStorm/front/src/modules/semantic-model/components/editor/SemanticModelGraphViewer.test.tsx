import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticModelGraphViewer } from './SemanticModelGraphViewer';

const apiMocks = vi.hoisted(() => ({
  getAgeGraph: vi.fn(),
  graph: vi.fn(),
  corpus: vi.fn(),
  rebuildAgeGraph: vi.fn(),
  indexAgeGraph: vi.fn(),
}));

vi.mock('../../api', () => ({ semanticModelApi: apiMocks }));
vi.mock('../../query/hooks', () => ({ useSemanticModel: () => ({ data: { indexStatus: 'indexed',indexError: null } }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn(),invalidateQueries: vi.fn() }) }));

describe('SemanticModelGraphViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getAgeGraph.mockResolvedValue({ nodes: [], edges: [] });
    apiMocks.graph.mockResolvedValue({ nodes: [], relations: [], records: [], recordRelations: [] });
    apiMocks.corpus.mockResolvedValue({ bindings: [] });
    apiMocks.rebuildAgeGraph.mockResolvedValue({
      vertexCount: 0,
      edgeCount: 0,
      failedVertexCount: 0,
      failedEdgeCount: 0,
      graphViewerWarning: null,
    });
    apiMocks.indexAgeGraph.mockResolvedValue({ indexed: true });
  });

  it('indexes the existing graph before refreshing the viewer', async () => {
    const user = userEvent.setup();
    render(<SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" canEdit />);
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.button' }));

    expect(apiMocks.indexAgeGraph).toHaveBeenCalledWith('model-1');
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(2));
  });

  it('retries synchronization instead of only hiding an indexing failure', async () => {
    const user = userEvent.setup();
    apiMocks.indexAgeGraph
      .mockRejectedValueOnce(new Error('index failed'))
      .mockResolvedValueOnce({ indexed: true });
    render(<SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" canEdit />);
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.button' }));
    await screen.findByText('index failed');
    await user.click(screen.getByRole('button', { name: 'graphViewer.retry' }));

    await waitFor(() => expect(apiMocks.indexAgeGraph).toHaveBeenCalledTimes(2));
  });

  it('synchronizes from the refresh button for a shared read-only graph', async () => {
    const user = userEvent.setup();
    render(<SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" canEdit={false} />);
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.button' }));

    expect(apiMocks.indexAgeGraph).toHaveBeenCalledWith('model-1');
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(2));
  });
});
