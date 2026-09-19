import { SemanticModelDatabaseService } from './semantic-model-database.service';

describe('SemanticModelDatabaseService', () => {
  it('runs relational transactions without loading AGE', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };
    const service = new SemanticModelDatabaseService(
      {} as never,
      { setContext: jest.fn() } as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
    );
    (service as unknown as { pool: { connect: () => Promise<typeof client> } }).pool = {
      connect: async () => client,
    };

    await service.transaction(async () => 'result');

    expect(client.query.mock.calls.map(([query]) => query)).toEqual([
      'BEGIN',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  function withClient(client: { query: jest.Mock; release: jest.Mock }) {
    const service = new SemanticModelDatabaseService(
      {} as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
    );
    (service as unknown as { pool: { connect: () => Promise<typeof client> } }).pool = {
      connect: async () => client,
    };
    return service;
  }

  it('rolls back and releases the client normally when work fails', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const service = withClient(client);
    await expect(service.transaction(() => Promise.reject(new Error('work failed')))).rejects.toThrow('work failed');
    expect(client.query.mock.calls.map(([q]) => q)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('rethrows the ORIGINAL error and destroys the client when ROLLBACK fails', async () => {
    const rollbackErr = new Error('connection lost');
    const client = {
      query: jest.fn((q: string) => (q === 'ROLLBACK' ? Promise.reject(rollbackErr) : Promise.resolve({ rows: [] }))),
      release: jest.fn(),
    };
    const service = withClient(client);
    await expect(service.transaction(() => Promise.reject(new Error('work failed')))).rejects.toThrow('work failed');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(rollbackErr);
  });
});

