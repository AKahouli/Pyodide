import { SemanticGraphIndexWorkerService } from './semantic-graph-index-worker.service';

describe('SemanticGraphIndexWorkerService advisory lock release', () => {
  const target = { modelId: 'm1', versionId: 'v1', revision: 1 };

  function build(unlock: () => Promise<unknown>) {
    const lockClient = {
      query: jest.fn((q: string) =>
        q.includes('pg_advisory_unlock') ? unlock() : Promise.resolve({ rows: [{ acquired: false }] }),
      ),
      release: jest.fn(),
    };
    const database = {
      acquireClient: jest.fn().mockResolvedValue(lockClient),
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const svc = new SemanticGraphIndexWorkerService(
      database as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
    );
    const index = (svc as unknown as { index: (t: typeof target) => Promise<void> }).index.bind(svc);
    return { index, lockClient };
  }

  it('returns the client to the pool when unlock succeeds', async () => {
    const { index, lockClient } = build(() => Promise.resolve({ rows: [] }));
    await index(target);
    expect(lockClient.release).toHaveBeenCalledTimes(1);
    expect(lockClient.release).toHaveBeenCalledWith(undefined);
  });

  it('destroys the client (release(err)) when unlock fails', async () => {
    const err = new Error('unlock failed');
    const { index, lockClient } = build(() => Promise.reject(err));
    await index(target);
    expect(lockClient.release).toHaveBeenCalledTimes(1);
    expect(lockClient.release).toHaveBeenCalledWith(err);
  });

  it('does not project after runtime ownership supersedes the claimed job', async () => {
    const lockClient = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [] }),
      release: jest.fn(),
    };
    const ageGraph = { dropGraph: jest.fn(), buildGraph: jest.fn() };
    const svc = new SemanticGraphIndexWorkerService(
      { acquireClient: jest.fn().mockResolvedValue(lockClient) } as never,
      {} as never,
      ageGraph as never,
      {} as never,
      { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    );

    await (svc as unknown as { index: (t: typeof target) => Promise<void> }).index(target);

    expect(ageGraph.dropGraph).not.toHaveBeenCalled();
    expect(ageGraph.buildGraph).not.toHaveBeenCalled();
    expect(lockClient.release).toHaveBeenCalledWith(undefined);
  });
});
