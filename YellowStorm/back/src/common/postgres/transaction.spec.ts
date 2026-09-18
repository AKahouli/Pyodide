import { withTransaction } from './transaction';

interface FakeTx {
  id: number;
}

interface FakeDb {
  transaction: (cb: (tx: FakeTx) => Promise<unknown>) => Promise<unknown>;
  opened: number;
}

function makeFakeDb(): FakeDb {
  const db: FakeDb = {
    opened: 0,
    transaction: (cb) => {
      db.opened += 1;
      return cb({ id: db.opened });
    },
  };
  return db;
}

describe('withTransaction', () => {
  it('opens exactly one transaction when nested calls join', async () => {
    const db = makeFakeDb();
    const seen: number[] = [];
    await withTransaction(db as never, async (outer) => {
      seen.push((outer as unknown as FakeTx).id);
      await withTransaction(db as never, (inner) => {
        seen.push((inner as unknown as FakeTx).id);
        return Promise.resolve();
      });
    });
    expect(db.opened).toBe(1);
    expect(seen).toEqual([1, 1]);
  });

  it('opens a second transaction when the nested call uses a different db', async () => {
    const dbA = makeFakeDb();
    const dbB = makeFakeDb();
    await withTransaction(dbA as never, async () => {
      await withTransaction(dbB as never, () => Promise.resolve());
    });
    expect(dbA.opened).toBe(1);
    expect(dbB.opened).toBe(1);
  });

  it('propagates the return value', async () => {
    const db = makeFakeDb();
    const result = await withTransaction(db as never, () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('re-throws callback errors after the transaction unwinds', async () => {
    const db = makeFakeDb();
    await expect(
      withTransaction(db as never, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});
