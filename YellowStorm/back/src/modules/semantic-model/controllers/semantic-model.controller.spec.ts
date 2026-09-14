import { SemanticModelController } from './semantic-model.controller';

jest.mock('@modules/authorization', () => ({
  Permissions: new Proxy({}, { get: (_target, property) => String(property) }),
  PermissionsGuard: class PermissionsGuard {},
  RequirePermissions: () => () => undefined,
}));

describe('SemanticModelController validation synchronization', () => {
  it('rebuilds and indexes the graph before returning validation results', async () => {
    const graph = { validate: jest.fn().mockResolvedValue({ issues: [] }) };
    const mapping = { rebuildAgeGraph: jest.fn().mockResolvedValue({}) };
    const controller = new SemanticModelController(
      {} as never,
      graph as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      mapping as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.validate({ _id: { toString: () => 'user-id' } } as never, 'model-id'))
      .resolves.toEqual({ issues: [] });

    expect(mapping.rebuildAgeGraph).toHaveBeenCalledWith('user-id', 'model-id');
    expect(graph.validate).toHaveBeenCalledWith('user-id', 'model-id');
    expect(mapping.rebuildAgeGraph.mock.invocationCallOrder[0])
      .toBeLessThan(graph.validate.mock.invocationCallOrder[0]);
  });
});
