import { PostgresConnectionService } from './postgres-connection.service';
import type { Pool } from 'pg';

function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
}

describe('PostgresConnectionService', () => {
  it('ping() returns true when SELECT 1 succeeds', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) } as unknown as Pool;
    const svc = new PostgresConnectionService(pool, {} as any, loggerStub());
    await expect(svc.ping()).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('ping() returns false when the query throws', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('down')) } as unknown as Pool;
    const svc = new PostgresConnectionService(pool, {} as any, loggerStub());
    await expect(svc.ping()).resolves.toBe(false);
  });

  it('getPool() and getDb() return the injected instances', () => {
    const pool = {} as Pool;
    const db = {} as any;
    const svc = new PostgresConnectionService(pool, db, loggerStub());
    expect(svc.getPool()).toBe(pool);
    expect(svc.getDb()).toBe(db);
  });
});
