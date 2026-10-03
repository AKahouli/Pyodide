import { ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticGraphSearchService } from './semantic-graph-search.service';

function setup(model: Record<string, unknown> = { id: 'model-1', role: 'viewer', status: 'published' }) {
  const database = { query: jest.fn().mockResolvedValue({ rows: [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-2' }] }) };
  const models = {
    requireRole: jest.fn(async (_user: string, _model: string, roles: string[]) => {
      if (!roles.includes(String(model.role))) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED);
      return model;
    }),
    requireActiveRole: jest.fn(async (_user: string, _model: string, roles: string[]) => {
      if (!roles.includes(String(model.role))) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED);
      return model;
    }),
  };
  const workspaceShares = { filterAccessible: jest.fn().mockResolvedValue(['ws-1']) };
  const runtime = {
    graphSearch: jest.fn().mockResolvedValue({ status: 'found', seeds: [] }),
    graphExpand: jest.fn().mockResolvedValue({ status: 'found', nodes: [], edges: [] }),
    getGraphSearchIndex: jest.fn().mockResolvedValue({ index: { state: 'ready' } }),
    ensureGraphSearchIndex: jest.fn().mockResolvedValue({ jobId: 'job-1', index: { state: 'queued' } }),
    recordsQuery: jest.fn().mockResolvedValue({ status: 'ok', modelVersionId: 'published-1', total: 0, records: [] }),
    recordsOverview: jest.fn().mockResolvedValue({ modelVersionId: 'published-1', concepts: [], relations: [] }),
  };
  const graphs = { getGraph: jest.fn().mockResolvedValue(versionGraph) };
  const service = new SemanticGraphSearchService(database as never, models as never, workspaceShares as never, runtime as never, graphs as never);
  return { service, database, models, workspaceShares, runtime, graphs };
}

const versionGraph = {
  modelId: 'model-1', versionId: 'published-1', revision: 0, records: [], recordRelations: [],
  nodes: [
    { id: 'n-1', key: 'invoice', label: 'Invoice', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null,
      aliases: ['Bill'], position: { x: 0, y: 0 },
      attributes: [{ key: 'amount', label: 'Amount', type: 'number', required: false, aliases: ['Total'], description: 'Incl. tax' }] },
    { id: 'n-2', key: 'documents', label: 'Documents', description: '', category: 'business_object', recordPolicy: 'optional',
      systemKey: 'workspace_documents', aliases: [], position: { x: 0, y: 0 }, attributes: [] },
  ],
  relations: [{ id: 'r-1', key: 'billed_to', label: 'billed to', inverseLabel: 'receives', description: '', sourceNodeTypeId: 'n-1',
    targetNodeTypeId: 'n-1', cardinality: 'many_to_one', traversable: true, filterable: true, attributes: [] }],
};

describe('SemanticGraphSearchService', () => {
  it('searches the published data with the workspaces the person may read', async () => {
    const { service, database, models, workspaceShares, runtime } = setup();
    await service.search('user-1', 'model-1', { environment: 'production', query: 'acme', concepts: ['Customer'], limit: 5 });
    expect(models.requireRole).toHaveBeenCalledWith('user-1', 'model-1', ['owner', 'editor', 'viewer']);
    expect(database.query.mock.calls[0][0]).toMatch(/source_mappings[\s\S]*UNION[\s\S]*workspace_links/);
    expect(workspaceShares.filterAccessible).toHaveBeenCalledWith('user-1', ['ws-1', 'ws-2']);
    expect(runtime.graphSearch).toHaveBeenCalledWith({
      actorUserId: 'user-1', modelId: 'model-1', environment: 'production', query: 'acme', concepts: ['Customer'], limit: 5,
      allowedWorkspaceIds: ['ws-1'],
    });
  });

  it('sends an empty allow-list when the model takes data from no workspace the person can read', async () => {
    const { service, database, workspaceShares, runtime } = setup();
    database.query.mockResolvedValueOnce({ rows: [] });
    await service.search('user-1', 'model-1', { environment: 'production', query: 'acme' });
    expect(workspaceShares.filterAccessible).not.toHaveBeenCalled();
    expect(runtime.graphSearch).toHaveBeenCalledWith(expect.objectContaining({ allowedWorkspaceIds: [] }));
  });

  it('keeps the draft data for the people who edit the model', async () => {
    const { service, runtime } = setup({ id: 'model-1', role: 'viewer', status: 'draft' });
    await expect(service.search('user-1', 'model-1', { environment: 'draft', query: 'acme' })).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED,
    });
    expect(runtime.graphSearch).not.toHaveBeenCalled();
  });

  it('asks to publish when there is no published data, and for a data update on the draft', async () => {
    const { service, runtime } = setup({ id: 'model-1', role: 'owner', status: 'draft' });
    runtime.graphSearch.mockRejectedValue(new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'model_not_published'));
    await expect(service.search('user-1', 'model-1', { environment: 'production', query: 'acme' })).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, message: 'Publish this semantic model to use it in chat',
    });
    runtime.graphExpand.mockRejectedValue(new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'active_binding_not_found'));
    await expect(service.expand('user-1', 'model-1', { environment: 'draft', seedEntityIds: ['e-1'], steps: [{}] })).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, message: expect.stringMatching(/data update/),
    });
  });

  it('rejects archived models', async () => {
    const { service, runtime } = setup({ id: 'model-1', role: 'owner', status: 'archived' });
    await expect(service.search('user-1', 'model-1', { environment: 'production', query: 'acme' })).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND,
    });
    expect(runtime.graphSearch).not.toHaveBeenCalled();
  });

  it('expands with the steps given and the allow-list', async () => {
    const { service, runtime } = setup({ id: 'model-1', role: 'editor', status: 'draft' });
    await service.expand('user-1', 'model-1', {
      environment: 'draft', seedEntityIds: ['e-1'], steps: [{ relations: ['signs'], direction: 'outgoing' }], maxNodes: 20, expectedDataRevisionId: 'dr-1',
    });
    expect(runtime.graphExpand).toHaveBeenCalledWith({
      actorUserId: 'user-1', modelId: 'model-1', environment: 'draft', seedEntityIds: ['e-1'],
      steps: [{ relations: ['signs'], direction: 'outgoing' }], maxNodes: 20, allowedWorkspaceIds: ['ws-1'], expectedDataRevisionId: 'dr-1',
    });
  });

  it('queries records with the published definitions, the allow-list and nothing else from the caller', async () => {
    const { service, runtime, graphs } = setup({ id: 'model-1', role: 'viewer', status: 'published', currentDraftVersionId: 'draft-2', currentPublishedVersionId: 'published-1' });
    const result = await service.queryRecords('user-1', 'model-1', {
      environment: 'production', concept: 'Invoice', filters: [{ field: 'Total', op: 'gt', value: 10 }], limit: 5,
    });
    expect(graphs.getGraph).toHaveBeenCalledWith('model-1', 'published-1', 0);
    expect(runtime.recordsQuery).toHaveBeenCalledWith({
      actorUserId: 'user-1', modelId: 'model-1', environment: 'production', allowedWorkspaceIds: ['ws-1'],
      concept: 'Invoice', filters: [{ field: 'Total', op: 'gt', value: 10 }], limit: 5,
      catalog: {
        concepts: [{ key: 'invoice', label: 'Invoice', aliases: ['Bill'], fields: [{ key: 'amount', label: 'Amount', type: 'number', aliases: ['Total'] }] }],
        relations: [{ key: 'billed_to', label: 'billed to', inverseLabel: 'receives' }],
      },
    });
    expect(result.definitionsVersionId).toBe('published-1');
  });

  it('reads the draft definitions for draft data, which only editors may query', async () => {
    const viewer = setup({ id: 'model-1', role: 'viewer', status: 'draft', currentDraftVersionId: 'draft-2' });
    await expect(viewer.service.queryRecords('user-1', 'model-1', { environment: 'draft', concept: 'Invoice' })).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED,
    });
    expect(viewer.runtime.recordsQuery).not.toHaveBeenCalled();
    const editor = setup({ id: 'model-1', role: 'editor', status: 'draft', currentDraftVersionId: 'draft-2', currentPublishedVersionId: null });
    await editor.service.queryRecords('user-1', 'model-1', { environment: 'draft', concept: 'Invoice' });
    expect(editor.graphs.getGraph).toHaveBeenCalledWith('model-1', 'draft-2', 0);
    // Nothing published: no definitions to send, and the runtime says the data is not bound.
    editor.runtime.recordsQuery.mockRejectedValue(new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'model_not_published'));
    editor.graphs.getGraph.mockClear();
    await expect(editor.service.queryRecords('user-1', 'model-1', { environment: 'production', concept: 'Invoice' })).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, message: 'Publish this semantic model to use it in chat',
    });
    expect(editor.graphs.getGraph).not.toHaveBeenCalled();
  });

  it('describes the bound data with its record counts and the definitions of its version', async () => {
    const { service, runtime } = setup({ id: 'model-1', role: 'viewer', status: 'published', currentPublishedVersionId: 'published-1' });
    const result = await service.dataOverview('user-1', 'model-1', 'production');
    expect(runtime.recordsOverview).toHaveBeenCalledWith({ actorUserId: 'user-1', modelId: 'model-1', environment: 'production', allowedWorkspaceIds: ['ws-1'] });
    expect(result.versionId).toBe('published-1');
    expect(result.graph?.nodes).toHaveLength(2);
  });

  it('reads the index state for readers and builds it only for editors', async () => {
    const viewer = setup();
    await expect(viewer.service.indexStatus('user-1', 'model-1', 'production')).resolves.toMatchObject({ index: { state: 'ready' } });
    expect(viewer.runtime.getGraphSearchIndex).toHaveBeenCalledWith('model-1', 'production', 'user-1');
    await expect(viewer.service.ensureIndex('user-1', 'model-1', 'production')).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED });

    const editor = setup({ id: 'model-1', role: 'editor', status: 'published' });
    await expect(editor.service.ensureIndex('user-1', 'model-1', 'production')).resolves.toMatchObject({ jobId: 'job-1' });
    expect(editor.models.requireActiveRole).toHaveBeenCalledWith('user-1', 'model-1', ['owner', 'editor']);
    expect(editor.runtime.ensureGraphSearchIndex).toHaveBeenCalledWith({ actorUserId: 'user-1', modelId: 'model-1', environment: 'production' });
  });
});
