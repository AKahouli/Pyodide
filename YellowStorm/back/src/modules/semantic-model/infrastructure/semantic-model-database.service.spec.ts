import { SemanticModelDatabaseService } from './semantic-model-database.service';

describe('SemanticModelDatabaseService', () => {
  it('sets the AGE search path inside the transaction', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };
    const service = new SemanticModelDatabaseService(
      { enabled: false } as never,
      { setContext: jest.fn() } as never,
    );
    (service as unknown as { pool: { connect: () => Promise<typeof client> } }).pool = {
      connect: async () => client,
    };

    await service.transaction(async () => 'result');

    expect(client.query.mock.calls.map(([query]) => query)).toEqual([
      'BEGIN',
      "LOAD 'age'",
      'SET LOCAL search_path = ag_catalog, "$user", public',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalled();
  });
});
