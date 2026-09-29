import { SemanticModelWorkspaceService } from './semantic-model-workspace.service';

describe('SemanticModelWorkspaceService', () => {
  it('promotes the first connected workspace to origin', async () => {
    const client = { query: jest.fn(async () => ({ rows: [] })) };
    const database = {
      transaction: jest.fn(async (callback: (connection: typeof client) => Promise<number>) => callback(client)),
    };
    const models = {
      requireActiveRole: jest.fn(async () => ({ id: 'model-1', originWorkspaceId: null })),
      advanceRevision: jest.fn(async () => 2),
    };
    const service = new SemanticModelWorkspaceService(
      database as any,
      models as any,
      { findById: jest.fn(async () => ({ id: 'workspace-1' })) } as any,
      { hasAccess: jest.fn(async () => true) } as any,
      {} as any,
    );

    await expect(service.connect('user-1', 'model-1', {
      workspaceId: 'workspace-1', expectedRevision: 1, addToDocumentsFallback: false,
    })).resolves.toEqual({ workspaceId: 'workspace-1', enabled: true, revision: 2 });

    expect(client.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SET origin_workspace_id=$2'), ['model-1', 'workspace-1']);
    expect(client.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('ON CONFLICT(model_id,workspace_id)'),
      ['model-1', 'workspace-1', 'origin', 'user-1']);
  });

  it('keeps another workspace connected when the model already has an origin', async () => {
    const client = { query: jest.fn(async () => ({ rows: [] })) };
    const database = {
      query: jest.fn(async () => ({ rows: [] })),
      transaction: jest.fn(async (callback: (connection: typeof client) => Promise<number>) => callback(client)),
    };
    const models = {
      requireActiveRole: jest.fn(async () => ({ id: 'model-1', originWorkspaceId: 'workspace-origin' })),
      advanceRevision: jest.fn(async () => 2),
    };
    const service = new SemanticModelWorkspaceService(
      database as any,
      models as any,
      { findById: jest.fn(async () => ({ id: 'workspace-2' })) } as any,
      { hasAccess: jest.fn(async () => true) } as any,
      {} as any,
    );

    await service.connect('user-1', 'model-1', {
      workspaceId: 'workspace-2', expectedRevision: 1, addToDocumentsFallback: false,
    });

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT(model_id,workspace_id)'),
      ['model-1', 'workspace-2', 'connected', 'user-1'],
    );
  });

  it('answers without a revision check when the workspace is already linked', async () => {
    const database = { query: jest.fn(async () => ({ rows: [{ revision: 11 }] })), transaction: jest.fn() };
    const models = {
      requireActiveRole: jest.fn(async () => ({ id: 'model-1', originWorkspaceId: 'workspace-origin' })),
      advanceRevision: jest.fn(),
    };
    const service = new SemanticModelWorkspaceService(
      database as any,
      models as any,
      { findById: jest.fn(async () => ({ id: 'workspace-origin' })) } as any,
      { hasAccess: jest.fn(async () => true) } as any,
      {} as any,
    );

    await expect(service.connect('user-1', 'model-1', {
      workspaceId: 'workspace-origin', expectedRevision: 10, addToDocumentsFallback: false,
    })).resolves.toEqual({ workspaceId: 'workspace-origin', enabled: true, revision: 11 });
    expect(database.transaction).not.toHaveBeenCalled();
    expect(models.advanceRevision).not.toHaveBeenCalled();
  });
});
