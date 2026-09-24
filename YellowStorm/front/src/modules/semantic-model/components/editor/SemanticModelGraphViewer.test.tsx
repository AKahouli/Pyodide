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
const modelMock = vi.hoisted(() => ({ executionOwner: 'legacy' as 'legacy' | 'runtime' }));

vi.mock('../../api', () => ({ semanticModelApi: apiMocks }));
vi.mock('../../query/hooks', () => ({ useSemanticModel: () => ({ data: { indexStatus: 'indexed',indexError: null, executionOwner: modelMock.executionOwner } }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn(),invalidateQueries: vi.fn() }) }));

describe('SemanticModelGraphViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMock.executionOwner = 'legacy';
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

  it('refreshes the existing graph without indexing it', async () => {
    const user = userEvent.setup();
    render(<SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" canEdit />);
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.button' }));

    expect(apiMocks.indexAgeGraph).not.toHaveBeenCalled();
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(2));
  });

  it('refreshes a shared read-only graph without indexing it', async () => {
    const user = userEvent.setup();
    render(<SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" canEdit={false} />);
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.button' }));

    expect(apiMocks.indexAgeGraph).not.toHaveBeenCalled();
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(2));
  });

  it('refreshes a runtime graph without indexing or exposing mutations', async () => {
    modelMock.executionOwner = 'runtime';
    const user = userEvent.setup();
    render(<SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" canEdit />);
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.button' }));

    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(2));
    expect(apiMocks.indexAgeGraph).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'graphViewer.addNode' })).not.toBeInTheDocument();
  });
});
