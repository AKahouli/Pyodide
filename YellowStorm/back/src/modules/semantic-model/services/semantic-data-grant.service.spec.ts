import { SemanticDataGrantService } from './semantic-data-grant.service';

describe('SemanticDataGrantService', () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn((work: (transactionClient: typeof client) => Promise<unknown>) => work(client)),
  };
  const models = { requireRole: jest.fn() };
  const workspaceShares = { filterAccessible: jest.fn() };
  const revocations = { lockWorkspaces: jest.fn() };
  const service = new SemanticDataGrantService(database as never, models as never, workspaceShares as never, revocations as never);

  beforeEach(() => {
    jest.clearAllMocks();
    models.requireRole.mockResolvedValue({});
    database.query.mockResolvedValue({
      rows: [
        { workspaceId: 'workspace-a', assetId: 'asset-1' },
        { workspaceId: 'workspace-b', assetId: 'asset-2' },
      ],
    });
    workspaceShares.filterAccessible.mockResolvedValue(['workspace-a']);
    client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    revocations.lockWorkspaces.mockResolvedValue(undefined);
  });

  it('persists only sources that the current actor can access', async () => {
    await service.issue('actor-1', 'model-1', 60);

    expect(workspaceShares.filterAccessible).toHaveBeenCalledWith('actor-1', ['workspace-a', 'workspace-b']);
    expect(revocations.lockWorkspaces).toHaveBeenCalledWith(client, ['workspace-a', 'workspace-b']);
    const sourceInsert = client.query.mock.calls.find(([sql]) => sql.includes('read_grant_sources'));
    expect(sourceInsert?.[1].slice(1)).toEqual(['workspace-a', 'asset-1']);
    expect(client.query.mock.calls.filter(([sql]) => sql.includes('read_grant_sources'))).toHaveLength(1);
  });

});
