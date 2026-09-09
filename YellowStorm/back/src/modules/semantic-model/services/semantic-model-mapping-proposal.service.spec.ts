import { SemanticModelMappingProposalService } from './semantic-model-mapping-proposal.service';

describe('SemanticModelMappingProposalService AGE mutation synchronization', () => {
  const sourceTypeId = '10000000-0000-4000-8000-000000000001';
  const targetTypeId = '10000000-0000-4000-8000-000000000002';
  const relationTypeId = '10000000-0000-4000-8000-000000000003';
  const sourceId = '10000000-0000-4000-8000-000000000004';
  const targetId = '10000000-0000-4000-8000-000000000005';
  const edgeId = '10000000-0000-4000-8000-000000000006';
  const graph = {
    revision: 0,
    nodes: [
      { id: sourceTypeId, systemKey: null, attributes: [] },
      { id: targetTypeId, systemKey: null, attributes: [] },
    ],
    relations: [{
      id: relationTypeId,
      sourceNodeTypeId: sourceTypeId,
      targetNodeTypeId: targetTypeId,
    }],
    records: [
      { id: sourceId, nodeTypeId: sourceTypeId },
      { id: targetId, nodeTypeId: targetTypeId },
    ],
    recordRelations: [{
      id: edgeId,
      relationTypeId,
      sourceRecordId: sourceId,
      targetRecordId: targetId,
    }],
  };
  const models = { requireActiveRole: jest.fn(), requireRole: jest.fn() };
  const graphCommands = {
    getGraph: jest.fn().mockResolvedValue(graph),
    apply: jest.fn().mockResolvedValue({ revision: 1 }),
  };
  const ageGraph = {
    dropGraph: jest.fn().mockResolvedValue(undefined),
    buildGraph: jest.fn().mockResolvedValue({
      vertexCount: 2,
      edgeCount: 1,
      failedVertexCount: 0,
      failedEdgeCount: 0,
    }),
  };
  const indexJobs = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new SemanticModelMappingProposalService(
    {} as never,
    models as never,
    graphCommands as never,
    {} as never,
    {} as never,
    ageGraph as never,
    indexJobs as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    graphCommands.getGraph.mockResolvedValue(graph);
    graphCommands.apply.mockResolvedValue({ revision: 1 });
    ageGraph.buildGraph.mockResolvedValue({
      vertexCount: 2,
      edgeCount: 1,
      failedVertexCount: 0,
      failedEdgeCount: 0,
    });
    indexJobs.enqueue.mockResolvedValue(undefined);
  });

  it('rebuilds and indexes after deleting a graph-viewer node', async () => {
    await service.applyAgeGraphOperations('user-id', 'model-id', {
      operations: [{ type: 'node.delete', nodeId: sourceId }],
    } as never);

    expect(graphCommands.apply).toHaveBeenCalled();
    expect(ageGraph.buildGraph).not.toHaveBeenCalled();
    expect(indexJobs.enqueue).toHaveBeenCalledWith('model-id');
  });

  it('rebuilds and indexes after creating a graph-viewer edge', async () => {
    await service.applyAgeGraphOperations('user-id', 'model-id', {
      operations: [{
        type: 'edge.create',
        relationTypeId,
        sourceId,
        targetId,
      }],
    } as never);

    expect(graphCommands.apply).toHaveBeenCalled();
    expect(ageGraph.buildGraph).not.toHaveBeenCalled();
    expect(indexJobs.enqueue).toHaveBeenCalledWith('model-id');
  });

  it('allows a shared viewer to index without rebuilding the AGE graph', async () => {
    await expect(service.indexAgeGraph('viewer-id', 'model-id')).resolves.toEqual({ queued: true });

    expect(models.requireRole).toHaveBeenCalledWith('viewer-id', 'model-id', ['owner', 'editor', 'viewer']);
    expect(indexJobs.enqueue).toHaveBeenCalledWith('model-id');
    expect(ageGraph.dropGraph).not.toHaveBeenCalled();
    expect(ageGraph.buildGraph).not.toHaveBeenCalled();
  });
});
