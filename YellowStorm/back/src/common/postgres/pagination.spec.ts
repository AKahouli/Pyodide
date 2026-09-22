import { PgDialect, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { keysetAfter, pageOf, pageParams } from './pagination';

describe('pageParams', () => {
  it('applies defaults', () => {
    expect(pageParams({})).toEqual({ limit: 20, offset: 0 });
  });

  it('clamps limit into [1, 100] and offset to >= 0', () => {
    expect(pageParams({ limit: 0 })).toEqual({ limit: 1, offset: 0 });
    expect(pageParams({ limit: 5000 })).toEqual({ limit: 100, offset: 0 });
    expect(pageParams({ limit: 10, offset: -5 })).toEqual({ limit: 10, offset: 0 });
  });

  it('honors in-range values', () => {
    expect(pageParams({ limit: 50, offset: 100 })).toEqual({ limit: 50, offset: 100 });
  });
});

describe('pageOf', () => {
  it('strips the total column and coerces the bigint count', async () => {
    const { items, total } = await pageOf([
      { id: 'a', total: '2' },
      { id: 'b', total: '2' },
    ]);
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(total).toBe(2);
  });

  it('reports total 0 for an empty first page without counting', async () => {
    const count = jest.fn().mockResolvedValue('7');
    expect(await pageOf([], { offset: 0, count })).toEqual({ items: [], total: 0 });
    expect(count).not.toHaveBeenCalled();
  });

  it('falls back to a separate count when the page is past the end', async () => {
    const count = jest.fn().mockResolvedValue('7');
    expect(await pageOf([], { offset: 40, count })).toEqual({ items: [], total: 7 });
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('does not count when rows are present', async () => {
    const count = jest.fn();
    await pageOf([{ id: 'a', total: 3 }], { offset: 20, count });
    expect(count).not.toHaveBeenCalled();
  });
});

describe('keysetAfter', () => {
  const t = pgTable('t', { createdAt: timestamp('created_at').notNull(), id: text('id').notNull() });
  const dialect = new PgDialect();

  it('builds a row-value comparison for DESC ordering', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const q = dialect.sqlToQuery(keysetAfter([t.createdAt, t.id], [at, 'abc']));
    expect(q.sql).toBe('("t"."created_at", "t"."id") < ($1, $2)');
    expect(q.params).toEqual([at, 'abc']);
  });

  it('rejects mismatched arity', () => {
    expect(() => keysetAfter([t.id], [])).toThrow();
  });
});
