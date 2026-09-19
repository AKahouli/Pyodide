import { resolveQueryable, withTransaction } from './transaction';

/**
 * Fake drizzle db/tx that records SQL-ish events. Like drizzle, a tx's
 * `.transaction()` opens a SAVEPOINT, releases it on success and rolls back
 * to it on error (rethrowing).
 */
interface FakeTx {
  id: string;
  transaction: (cb: (tx: FakeTx) => Promise<unknown>) => Promise<unknown>;
}

interface FakeDb {
  log: string[];
  opened: number;
  transaction: (cb: (tx: FakeTx) => Promise<unknown>) => Promise<unknown>;
}

function makeFakeDb(): FakeDb {
  const log: string[] = [];
  let sp = 0;
  const makeTx = (id: string): FakeTx => ({
    id,
    transaction: async (cb) => {
      sp += 1;
      const name = `sp${sp}`;
      log.push(`SAVEPOINT ${name}`);
      try {
        const r = await cb(makeTx(`${id}/${name}`));
        log.push(`RELEASE ${name}`);
        return r;
      } catch (e) {
        log.push(`ROLLBACK TO ${name}`);
        throw e;
      }
    },
  });
  const db: FakeDb = {
    log,
    opened: 0,
    transaction: async (cb) => {
      db.opened += 1;
      log.push('BEGIN');
      try {
        const r = await cb(makeTx(`tx${db.opened}`));
        log.push('COMMIT');
        return r;
      } catch (e) {
        log.push('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}

describe('withTransaction', () => {
  it('nested success runs in a savepoint of the single outer transaction', async () => {
    const db = makeFakeDb();
    const seen: string[] = [];
    await withTransaction(db as never, async (outer) => {
      seen.push((outer as unknown as FakeTx).id);
      await withTransaction(db as never, (inner) => {
        seen.push((inner as unknown as FakeTx).id);
        // Ambient queryable points at the nested tx while fn runs.
        seen.push((resolveQueryable(db as never) as unknown as FakeTx).id);
        return Promise.resolve();
      });
      seen.push((resolveQueryable(db as never) as unknown as FakeTx).id);
    });
    expect(db.opened).toBe(1);
    expect(seen).toEqual(['tx1', 'tx1/sp1', 'tx1/sp1', 'tx1']);
    expect(db.log).toEqual(['BEGIN', 'SAVEPOINT sp1', 'RELEASE sp1', 'COMMIT']);
  });

  it('nested error caught by the caller rolls back to the savepoint and the outer tx still commits', async () => {
    const db = makeFakeDb();
    const result = await withTransaction(db as never, async () => {
      await withTransaction(db as never, () => Promise.reject(new Error('unique violation'))).catch(
        () => undefined,
      );
      return 'outer-ok';
    });
    expect(result).toBe('outer-ok');
    expect(db.log).toEqual(['BEGIN', 'SAVEPOINT sp1', 'ROLLBACK TO sp1', 'COMMIT']);
  });

  it('nested error left uncaught rolls back the whole transaction', async () => {
    const db = makeFakeDb();
    await expect(
      withTransaction(db as never, async () => {
        await withTransaction(db as never, () => Promise.reject(new Error('boom')));
      }),
    ).rejects.toThrow('boom');
    expect(db.log).toEqual(['BEGIN', 'SAVEPOINT sp1', 'ROLLBACK TO sp1', 'ROLLBACK']);
  });

  it('opens a second transaction when the nested call uses a different db', async () => {
    const dbA = makeFakeDb();
    const dbB = makeFakeDb();
    await withTransaction(dbA as never, async () => {
      await withTransaction(dbB as never, () => Promise.resolve());
    });
    expect(dbA.opened).toBe(1);
    expect(dbB.opened).toBe(1);
    expect(dbA.log).toEqual(['BEGIN', 'COMMIT']);
  });

  it('propagates the return value', async () => {
    const db = makeFakeDb();
    const result = await withTransaction(db as never, () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('re-throws callback errors after the transaction unwinds', async () => {
    const db = makeFakeDb();
    await expect(withTransaction(db as never, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
