import { PostgresConnectionService, RECOVERY_PROBE_INTERVAL_MS } from './postgres-connection.service';
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

  describe('recovery probe', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('registers a pool error handler on init', () => {
      const pool = { on: jest.fn() } as unknown as Pool;
      const svc = new PostgresConnectionService(pool, {} as any, loggerStub());
      svc.onModuleInit();
      expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('probes until the database answers and logs recovery', async () => {
      jest.useFakeTimers();
      let connectRejectedOnce = false;
      const failClient = {
        query: jest.fn().mockRejectedValue(new Error('Connection terminated unexpectedly')),
        release: jest.fn(),
      };
      const okClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
        release: jest.fn(),
      };
      const pool = {
        on: jest.fn(),
        connect: jest.fn().mockImplementation(async () => {
          if (!connectRejectedOnce) {
            connectRejectedOnce = true;
            return failClient;
          }
          return okClient;
        }),
      } as unknown as Pool;
      const logger = loggerStub();
      const svc = new PostgresConnectionService(pool, {} as any, logger);
      svc.onModuleInit();

      const onPoolError = (pool.on as jest.Mock).mock.calls[0][1] as (err: Error) => void;
      onPoolError(new Error('Connection terminated unexpectedly'));
      // Repeat errors within the same outage episode must not flood the log.
      onPoolError(new Error('Connection terminated unexpectedly'));

      await jest.advanceTimersByTimeAsync(RECOVERY_PROBE_INTERVAL_MS * 2);
      // One episode-start log plus the first failed probe; no flood from the
      // repeated pool error or the silent second probe.
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith('PostgreSQL connection error — recovery probe started', {
        error: 'Connection terminated unexpectedly',
      });
      expect(logger.log).toHaveBeenCalledWith('PostgreSQL connection recovered after 1 failed probe(s)');

      // Probe stops after recovery — further ticks must not ping again.
      const connectCallsAfterRecovery = (pool.connect as jest.Mock).mock.calls.length;
      await jest.advanceTimersByTimeAsync(RECOVERY_PROBE_INTERVAL_MS * 3);
      expect((pool.connect as jest.Mock).mock.calls.length).toBe(connectCallsAfterRecovery);

      svc.onModuleDestroy();
    });

    it('keeps probing while the database stays down and cleans up on destroy', async () => {
      jest.useFakeTimers();
      const failClient = {
        query: jest.fn().mockRejectedValue(new Error('Connection refused')),
        release: jest.fn(),
      };
      const pool = {
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(failClient),
      } as unknown as Pool;
      const logger = loggerStub();
      const svc = new PostgresConnectionService(pool, {} as any, logger);
      svc.onModuleInit();

      const onPoolError = (pool.on as jest.Mock).mock.calls[0][1] as (err: Error) => void;
      onPoolError(new Error('Connection refused'));

      await jest.advanceTimersByTimeAsync(RECOVERY_PROBE_INTERVAL_MS * 3);
      expect((pool.connect as jest.Mock).mock.calls.length).toBe(3);
      expect(logger.log).not.toHaveBeenCalledWith('PostgreSQL connection recovered');

      svc.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(RECOVERY_PROBE_INTERVAL_MS * 3);
      expect((pool.connect as jest.Mock).mock.calls.length).toBe(3);
    });
  });
});
