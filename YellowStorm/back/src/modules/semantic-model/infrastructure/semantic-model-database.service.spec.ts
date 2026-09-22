import { SemanticModelDatabaseService, isSameConnection, splitAgeBootstrap } from './semantic-model-database.service';

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

  it('splits bootstrap SQL so agentstore-style databases never see LOAD age', () => {
    const sql = `-- 001\nCREATE TABLE t (id INT);\n-- 002 — AGE\nLOAD 'age';\nSELECT ag_catalog.create_graph('g');\n-- 003 —\nCREATE INDEX i ON t (id);`;
    const { definitions, ageSection } = splitAgeBootstrap(sql);
    expect(definitions).toContain('CREATE TABLE t');
    expect(definitions).toContain('CREATE INDEX i');
    expect(definitions).not.toContain("LOAD 'age'");
    expect(ageSection).toContain("LOAD 'age'");
    expect(ageSection).toContain('create_graph');
  });

  it('fails closed when the AGE section markers move', () => {
    expect(() => splitAgeBootstrap('CREATE TABLE t (id INT);')).toThrow('AGE section markers');
  });

  it('shares the pool only when the full connection tuple matches', () => {
    const base = { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' };
    expect(isSameConnection(base, { ...base })).toBe(true);
    expect(isSameConnection(base, { ...base, port: 5433 })).toBe(false);
    expect(isSameConnection(base, { ...base, password: 'other' })).toBe(false);
    expect(isSameConnection(base, { ...base, host: 'age-host' })).toBe(false);
    expect(isSameConnection(base, { ...base, database: 'graphs' })).toBe(false);
    expect(isSameConnection(base, { ...base, user: 'age-user' })).toBe(false);
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

