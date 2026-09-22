import { SemanticExecutionOwnershipService } from './semantic-execution-ownership.service';

describe('SemanticExecutionOwnershipService', () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn((work: (transactionClient: typeof client) => Promise<unknown>) => work(client)),
  };
  const models = { requireActiveRole: jest.fn(), audit: jest.fn() };
  const service = new SemanticExecutionOwnershipService(database as never, models as never);

  beforeEach(() => {
    jest.clearAllMocks();
    models.requireActiveRole.mockResolvedValue({});
  });

  it('rejects legacy writes after runtime ownership is active', async () => {
    database.query.mockResolvedValue({ rows: [{ owner: 'runtime' }] });
    await expect(service.assertLegacyWriteAllowed('model-1', 'AGE indexing')).rejects.toThrow(
      'Legacy AGE indexing is disabled',
    );
  });

  it('claims ownership only when the expected revision has a valid runtime projection', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ revision: 4, owner: 'legacy', versionId: 'version-1' }] })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ revision: 5 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(service.claimRuntimeOwnership('actor-1', 'model-1', 4)).resolves.toEqual({
      executionOwner: 'runtime',
      revision: 5,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("SET status='superseded'"), ['model-1']);
    expect(models.audit).toHaveBeenCalledWith(
      client,
      'model-1',
      'version-1',
      'actor-1',
      'runtime.ownership_claimed',
      { previousOwner: 'legacy' },
    );
  });

  it('rejects a claim without a valid runtime projection', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ revision: 4, owner: 'legacy', versionId: 'version-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.claimRuntimeOwnership('actor-1', 'model-1', 4)).rejects.toThrow(
      'valid projected runtime population',
    );
  });
});
