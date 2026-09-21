import { SemanticGraphIndexJobService } from './semantic-graph-index-job.service';

describe('SemanticGraphIndexJobService ownership fence', () => {
  const client = { query: jest.fn() };
  const database = {
    transaction: jest.fn((work: (transactionClient: typeof client) => Promise<unknown>) => work(client)),
  };
  const ownership = { assertLegacyWriteAllowed: jest.fn() };
  const service = new SemanticGraphIndexJobService(database as never, ownership as never);

  beforeEach(() => {
    jest.clearAllMocks();
    ownership.assertLegacyWriteAllowed.mockResolvedValue(undefined);
    client.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('serializes the ownership check and enqueue on the model lock', async () => {
    await service.enqueue('model-1', 'version-1', 3);

    expect(client.query.mock.calls[0]).toEqual(['SELECT pg_advisory_xact_lock(hashtext($1))', ['model-1']]);
    expect(ownership.assertLegacyWriteAllowed).toHaveBeenCalledWith('model-1', 'AGE indexing', client);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO semantic_model.graph_index_jobs'), ['model-1', 'version-1', 3]);
  });

  it('does not enqueue after runtime takes ownership', async () => {
    ownership.assertLegacyWriteAllowed.mockRejectedValue(new Error('runtime owned'));

    await expect(service.enqueue('model-1', 'version-1', 3)).rejects.toThrow('runtime owned');
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
