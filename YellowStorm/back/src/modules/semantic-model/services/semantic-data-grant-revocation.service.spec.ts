import { SemanticDataGrantRevocationService } from './semantic-data-grant-revocation.service';

describe('SemanticDataGrantRevocationService', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  const database = {
    acquireClient: jest.fn().mockResolvedValue(client),
  };
  const service = new SemanticDataGrantRevocationService(database as never);

  beforeEach(() => {
    jest.clearAllMocks();
    client.query.mockResolvedValue({ rows: [], rowCount: 1 });
    client.release.mockClear();
  });

  it('holds the workspace lock across the access mutation and grant revocation', async () => {
    const order: string[] = [];
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_advisory_lock')) order.push('lock');
      else if (sql === 'BEGIN') order.push('begin');
      else if (sql.includes('UPDATE semantic_access')) order.push('revoke');
      else if (sql === 'COMMIT') order.push('commit');
      else if (sql.includes('pg_advisory_unlock')) order.push('unlock');
      return { rows: [], rowCount: 1 };
    });

    await service.runWithWorkspaceRevocation('workspace-1', 'actor-1', async () => {
      order.push('mutation');
    });

    expect(order).toEqual(['lock', 'begin', 'revoke', 'commit', 'mutation', 'unlock']);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('source_row.workspace_id=$2'),
      ['actor-1', 'workspace-1'],
    );
  });

  it.each(['UPDATE semantic_access', 'COMMIT'])('does not expose the workspace mutation when %s fails', async (failurePoint) => {
    const mutation = jest.fn();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes(failurePoint)) throw new Error('agentstore unavailable');
      return { rows: [], rowCount: 1 };
    });

    await expect(service.runWithWorkspaceRevocation('workspace-1', 'actor-1', mutation))
      .rejects.toThrow('agentstore unavailable');

    expect(mutation).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
