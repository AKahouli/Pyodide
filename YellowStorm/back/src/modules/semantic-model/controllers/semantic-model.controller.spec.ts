import { SemanticModelController } from './semantic-model.controller';

jest.mock('@modules/authorization', () => ({
  Permissions: new Proxy({}, { get: (_target, property) => String(property) }),
  PermissionsGuard: class PermissionsGuard { },
  RequirePermissions: () => () => undefined,
}));

describe('SemanticModelController validation synchronization', () => {
  // P1.6: validation is read-only; explicit Prepare/Refresh rebuilds the graph.
  it('validates without rebuilding the graph', async () => {
    const graph = { validate: jest.fn().mockResolvedValue({ issues: [] }) };
    const controller = new SemanticModelController(
      {} as never,
      graph as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.validate({ _id: { toString: () => 'user-id' } } as never, 'model-id'))
      .resolves.toEqual({ issues: [] });

    expect(graph.validate).toHaveBeenCalledWith('user-id', 'model-id');
  });
});

describe('SemanticModelController graph search', () => {
  it('passes the person, model and request to the graph search service', async () => {
    const graphSearch = {
      search: jest.fn().mockResolvedValue({ status: 'found' }),
      expand: jest.fn().mockResolvedValue({ status: 'found' }),
      indexStatus: jest.fn().mockResolvedValue({ index: { state: 'ready' } }),
      ensureIndex: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
    };
    const unused = {} as never;
    const controller = new SemanticModelController(
      unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, graphSearch as never,
    );
    const user = { _id: { toString: () => 'user-id' } } as never;

    await controller.search(user, 'model-id', { environment: 'production', query: 'acme' } as never);
    await controller.expandSearch(user, 'model-id', { environment: 'draft', seedEntityIds: ['e-1'], steps: [{}] } as never);
    await controller.searchIndex(user, 'model-id', { environment: 'production' } as never);
    await controller.ensureSearchIndex(user, 'model-id', { environment: 'draft' } as never);

    expect(graphSearch.search).toHaveBeenCalledWith('user-id', 'model-id', { environment: 'production', query: 'acme' });
    expect(graphSearch.expand).toHaveBeenCalledWith('user-id', 'model-id', { environment: 'draft', seedEntityIds: ['e-1'], steps: [{}] });
    expect(graphSearch.indexStatus).toHaveBeenCalledWith('user-id', 'model-id', 'production');
    expect(graphSearch.ensureIndex).toHaveBeenCalledWith('user-id', 'model-id', 'draft');
  });
});
