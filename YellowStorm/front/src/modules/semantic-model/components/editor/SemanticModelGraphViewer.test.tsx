import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticModelGraphViewer } from './SemanticModelGraphViewer';

const apiMocks = vi.hoisted(() => ({
  getAgeGraph: vi.fn(),
  graph: vi.fn(),
}));

vi.mock('../../api', () => ({ semanticModelApi: apiMocks }));

describe('SemanticModelGraphViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getAgeGraph.mockResolvedValue({ nodes: [], edges: [] });
    apiMocks.graph.mockResolvedValue({ nodes: [], relations: [], records: [], recordRelations: [] });
  });

  it('refreshes the runtime graph without exposing graph mutations', async () => {
    const user = userEvent.setup();
    render(<SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" />);
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.refresh' }));

    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'graphViewer.addNode' })).not.toBeInTheDocument();
  });

  it('reads the requested data revision', async () => {
    render(<SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" dataRevisionId="rev-1" />);
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledWith('model-1', 'rev-1'));
  });
});
