import { PgTtlSweeper } from './pg-ttl-sweeper.service';

class FakeDb {
  /** Lock results per transaction (default true when exhausted). */
  lockResults: boolean[] = [];
  /** Row counts returned by successive DELETE calls (default 0 when exhausted). */
  deleteRowCounts: number[] = [];
  executeCalls = 0;
  transactions = 0;
  deleteSql: string[] = [];
  throwOnCall: number | null = null;

  async transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
    this.transactions += 1;
    let callInTx = 0;
    const tx = {
      execute: (query: { queryChunks?: unknown[] }): Promise<{ rows: { acquired: boolean }[]; rowCount: number | null }> => {
        this.executeCalls += 1;
        callInTx += 1;
        if (this.throwOnCall !== null && this.executeCalls === this.throwOnCall) {
          return Promise.reject(new Error('connection reset'));
        }
        if (callInTx === 1) {
          return Promise.resolve({ rows: [{ acquired: this.lockResults.shift() ?? true }], rowCount: null });
        }
        this.deleteSql.push(JSON.stringify(query.queryChunks ?? []));
        return Promise.resolve({ rows: [], rowCount: this.deleteRowCounts.shift() ?? 0 });
      },
    };
    return cb(tx);
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
    db.lockResults = [false];
    const { sweeper } = makeSweeper(db);
    const deleted = await sweeper.sweepTable({ schema: 's', table: 't', column: 'expires_at' });
    expect(deleted).toBeNull();
    expect(db.executeCalls).toBe(1);
    expect(db.transactions).toBe(1);
  });

  it('runs each batch in its own short transaction and stops below batchSize', async () => {
    const db = new FakeDb();
    db.deleteRowCounts = [1000, 5];
    const { sweeper } = makeSweeper(db);
    const deleted = await sweeper.sweepTable({ schema: 's', table: 't', column: 'expires_at' });
    expect(deleted).toBe(1005);
    expect(db.transactions).toBe(2);
    expect(db.executeCalls).toBe(4); // (lock + delete) per batch
    expect(db.deleteSql[0]).toContain('ctid = ANY(ARRAY(');
  });

  it('caps the number of batches per run', async () => {
    const db = new FakeDb();
    db.deleteRowCounts = Array.from({ length: 200 }, () => 10);
    const { sweeper } = makeSweeper(db);
    const deleted = await sweeper.sweepTable({ schema: 's', table: 't', column: 'expires_at', batchSize: 10 });
    expect(db.transactions).toBe(100);
    expect(deleted).toBe(1000);
  });

  it('stops (keeping progress) when the lock is lost between batches', async () => {
    const db = new FakeDb();
    db.lockResults = [true, false];
    db.deleteRowCounts = [1000];
    const { sweeper } = makeSweeper(db);
    const deleted = await sweeper.sweepTable({ schema: 's', table: 't', column: 'expires_at' });
    expect(deleted).toBe(1000);
    expect(db.transactions).toBe(2);
  });

  it('returns null and logs when the delete fails', async () => {
    const db = new FakeDb();
    db.throwOnCall = 2;
    const { sweeper, errors } = makeSweeper(db);
    const deleted = await sweeper.sweepTable({ schema: 's', table: 't', column: 'expires_at' });
    expect(deleted).toBeNull();
    expect(errors).toHaveLength(1);
  });
});
