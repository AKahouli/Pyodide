import { PostgresConnectionService } from './postgres-connection.service';
import type { Pool } from 'pg';

function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
}

describe('PostgresConnectionService', () => {
  it('ping() returns true when SELECT 1 succeeds', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }), release: jest.fn() };
    const pool = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const svc = new PostgresConnectionService(pool, {} as any, loggerStub());
    await expect(svc.ping()).resolves.toBe(true);
    expect(client.query).toHaveBeenNthCalledWith(1, 'SET statement_timeout TO 1500');
    expect(client.query).toHaveBeenNthCalledWith(2, 'SELECT 1');
    expect(client.query).toHaveBeenNthCalledWith(3, 'SET statement_timeout TO DEFAULT');
    expect(client.release).toHaveBeenCalled();
  });

  it('ping() returns false when the query throws', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const svc = new PostgresConnectionService(pool, {} as any, loggerStub());
    await expect(svc.ping()).resolves.toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('getPool() and getDb() return the injected instances', () => {
    const pool = {} as Pool;
    const db = {} as any;
    const svc = new PostgresConnectionService(pool, db, loggerStub());
    expect(svc.getPool()).toBe(pool);
    expect(svc.getDb()).toBe(db);
  });
});
