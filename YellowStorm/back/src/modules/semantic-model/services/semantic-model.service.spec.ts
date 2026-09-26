import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelService } from './semantic-model.service';

describe('SemanticModelService archived access', () => {
  const accessible = {
    id: 'model-id',
    role: 'owner',
    status: 'archived',
  };
  const repository = { findAccessible: jest.fn() };
  const runtime = { getPublishedBinding: jest.fn() };
  const service = new SemanticModelService({} as never, repository as never, {} as never, {} as never, {} as never, runtime as never);

  beforeEach(() => {
    repository.findAccessible.mockReset();
    runtime.getPublishedBinding.mockReset();
  });

  it('allows archived models to be inspected', async () => {
    repository.findAccessible.mockResolvedValue(accessible);
    await expect(service.requireRole('user-id', 'model-id', ['owner'])).resolves.toMatchObject({ status: 'archived' });
  });

  it('rejects mutation access to archived models', async () => {
    repository.findAccessible.mockResolvedValue(accessible);
    await expect(service.requireActiveRole('user-id', 'model-id', ['owner'])).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_VERSION_IMMUTABLE,
    });
  });

  it('resolves the search schema to the published runtime graph', async () => {
    repository.findAccessible.mockResolvedValue({ ...accessible, status: 'published' });
    runtime.getPublishedBinding.mockResolvedValue({ projectionRef: 'age:v1:pop_dr_1' });
    await expect(service.resolveSearchSchema('user-id', 'model-id')).resolves.toBe('pop_dr_1');
    expect(runtime.getPublishedBinding).toHaveBeenCalledWith('model-id', 'user-id');
  });

  it('keeps unpublished models out of chat', async () => {
    repository.findAccessible.mockResolvedValue({ ...accessible, status: 'draft' });
    runtime.getPublishedBinding.mockRejectedValue(new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND));
    await expect(service.resolveSearchSchema('user-id', 'model-id')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
    });
  });

  it('rejects archived models for semantic search', async () => {
    repository.findAccessible.mockResolvedValue(accessible);
    await expect(service.resolveSearchSchema('user-id', 'model-id')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND,
    });
  });
});

describe('SemanticModelService clone', () => {
  it('creates an independent graph with remapped relations and bindings', async () => {
    const repository = { findAccessible: jest.fn(), create: jest.fn() };
    const database = { query: jest.fn(), transaction: jest.fn() };
    const graphRepository = { getGraph: jest.fn(), apply: jest.fn() };
    const source = {
      id: 'source-model', role: 'owner', status: 'draft', description: 'Source',
      currentDraftVersionId: 'source-version', currentPublishedVersionId: null,
    };
    const sourceGraph = {
      modelId: source.id, versionId: 'source-version', revision: 4,
      nodes: [
        { id: 'node-a', key: 'a', label: 'A', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 } },
        { id: 'node-b', key: 'b', label: 'B', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [], attributes: [], position: { x: 100, y: 0 } },
      ],
      relations: [{ id: 'relation-ab', key: 'ab', label: 'links', inverseLabel: '', description: '', sourceNodeTypeId: 'node-a', targetNodeTypeId: 'node-b', cardinality: 'many_to_many', traversable: true, filterable: true, attributes: [] }],
      records: [
        { id: 'record-a', nodeTypeId: 'node-a', label: 'A1', values: { _entity_key: 'record-a' }, status: 'active', position: { x: 0, y: 0 } },
        { id: 'record-b', nodeTypeId: 'node-b', label: 'B1', values: {}, status: 'active', position: { x: 100, y: 0 } },
      ],
      recordRelations: [{ id: 'record-relation', relationTypeId: 'relation-ab', sourceRecordId: 'record-a', targetRecordId: 'record-b', values: {} }],
    };
    repository.findAccessible.mockResolvedValue(source);
    repository.create.mockResolvedValue({ id: 'clone-model', currentDraftVersionId: 'clone-version', description: 'Source', status: 'draft', role: 'owner' });
    graphRepository.getGraph.mockResolvedValue(sourceGraph);
    database.query
      .mockResolvedValueOnce({ rows: [{ revision: 4 }] })
      .mockResolvedValueOnce({ rows: [{ workspaceId: 'workspace-1' }] })
      .mockResolvedValueOnce({ rows: [{ targetKind: 'node_type', targetId: 'node-a', resourceKind: 'workspace', workspaceId: 'workspace-1', documentId: null, inclusionMode: 'dynamic', retrievalMode: 'broad', priority: 0, enabled: true, protected: false, availability: 'available' }] })
      .mockResolvedValueOnce({ rows: [] });
    const cloneClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    database.transaction.mockImplementation(async (work: (client: unknown) => Promise<unknown>) => work(cloneClient));
    const realtimeSignals = { enqueue: jest.fn() };
    const service = new SemanticModelService(database as never, repository as never, graphRepository as never, {} as never, realtimeSignals as never, {} as never);

    const clone = await service.clone('user-id', source.id, 'Source copy');

    expect(clone.id).toBe('clone-model');
    expect(repository.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ownerUserId: 'user-id', name: 'Source copy' }));
    expect(graphRepository.apply).toHaveBeenCalledTimes(6);
    expect(graphRepository.apply.mock.calls[2][3].entity.sourceNodeTypeId).not.toBe('node-a');
    expect(graphRepository.apply.mock.calls[5][3].entity.sourceRecordId).not.toBe('record-a');
  });
});
