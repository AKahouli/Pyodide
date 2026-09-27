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
    );

    await expect(controller.validate({ _id: { toString: () => 'user-id' } } as never, 'model-id'))
      .resolves.toEqual({ issues: [] });

    expect(graph.validate).toHaveBeenCalledWith('user-id', 'model-id');
  });
});
