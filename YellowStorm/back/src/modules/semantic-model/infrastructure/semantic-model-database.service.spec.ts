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
});
