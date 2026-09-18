import { PgTtlSweeper } from './pg-ttl-sweeper.service';

class FakeDb {
  lockAcquired = true;
  /** Row counts returned by successive DELETE calls (default 0 when exhausted). */
  deleteRowCounts: number[] = [];
  executeCalls = 0;
  throwOnCall: number | null = null;

  private readonly tx = {
    execute: (): Promise<{ rows: { acquired: boolean }[]; rowCount: number | null }> => {
      this.executeCalls += 1;
      if (this.throwOnCall !== null && this.executeCalls === this.throwOnCall) {
        return Promise.reject(new Error('connection reset'));
      }
      if (this.executeCalls === 1) {
        return Promise.resolve({ rows: [{ acquired: this.lockAcquired }], rowCount: null });
      }
      return Promise.resolve({ rows: [], rowCount: this.deleteRowCounts.shift() ?? 0 });
    },
  };

  async transaction<T>(cb: (tx: typeof this.tx) => Promise<T>): Promise<T> {
    return cb(this.tx);
  }
}

function makeSweeper(db: FakeDb): { sweeper: PgTtlSweeper; errors: string[] } {
  const errors: string[] = [];
  const logger = {
    setContext: (): void => undefined,
    log: (): void => undefined,
    error: (message: string): void => {
      errors.push(message);
    },
  } as never;
  const sweeper = new PgTtlSweeper(db as never, logger);
  sweeper.register({ schema: 's', table: 't', column: 'expires_at', batchSize: 1000 });
  return { sweeper, errors };
}

describe('PgTtlSweeper', () => {
  it('skips the table when another replica holds the advisory lock', async () => {
    const db = new FakeDb();
    db.lockAcquired = false;
    const { sweeper } = makeSweeper(db);
    const deleted = await sweeper.sweepTable({ schema: 's', table: 't', column: 'expires_at' });
    expect(deleted).toBeNull();
    expect(db.executeCalls).toBe(1);
  });

  it('batches deletes and stops below batchSize', async () => {
    const db = new FakeDb();
    db.deleteRowCounts = [1000, 5];
    const { sweeper } = makeSweeper(db);
    const deleted = await sweeper.sweepTable({ schema: 's', table: 't', column: 'expires_at' });
    expect(deleted).toBe(1005);
    expect(db.executeCalls).toBe(3); // 1 lock + 2 delete batches
  });

  it('returns null and logs when the delete fails', async () => {
    const db = new FakeDb();
    db.deleteRowCounts = [0];
    db.throwOnCall = 2;
    const { sweeper, errors } = makeSweeper(db);
    const deleted = await sweeper.sweepTable({ schema: 's', table: 't', column: 'expires_at' });
    expect(deleted).toBeNull();
    expect(errors).toHaveLength(1);
  });
});
