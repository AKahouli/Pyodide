import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PgScopeStore } from './pg-scope.store';
import { PgBindingStore } from './pg-binding.store';
import { PgGovernanceDocumentStore, normalizeBusinessStatus } from './pg-document.store';

type Call = { method: string; args: unknown[] };

/** Chainable drizzle stand-in: records every builder call and resolves to `rows`. */
function fakeDb(rows: unknown[] = []) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(rows);
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return chain;
        };
      },
    },
  );
  const db = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'transaction') return (fn: (tx: unknown) => unknown) => fn(chain);
        return (chain as Record<string, unknown>)[prop];
      },
    },
  );
  return { db, calls };
}

const dialect = new PgDialect();
const render = (cond: unknown) => dialect.sqlToQuery(cond as SQL);
const argOf = (calls: Call[], method: string) => calls.find((call) => call.method === method)?.args[0];

describe('governance pg stores (query shape)', () => {
  it('PgScopeStore.update persists audienceMode when the audience is patched', async () => {
    const { db, calls } = fakeDb([{ id: 's1', audienceMode: 'all_authenticated', metadata: {} }]);
    const store = new PgScopeStore(db as never);
    await store.update('s1', { audience: { mode: 'all_authenticated', userIds: [], groupIds: [] } });
    expect(argOf(calls, 'set')).toEqual(expect.objectContaining({ audienceMode: 'all_authenticated' }));
  });

  it('PgScopeStore.update leaves audienceMode untouched when audience is not patched', async () => {
    const { db, calls } = fakeDb([{ id: 's1', audienceMode: 'restricted', metadata: {} }]);
    await new PgScopeStore(db as never).update('s1', { name: 'renamed' });
    expect(argOf(calls, 'set')).not.toHaveProperty('audienceMode');
  });

  it('PgBindingStore.listEnabled with no scope ids only matches program_shared bindings (no empty IN ())', async () => {
    const { db, calls } = fakeDb([]);
    await new PgBindingStore(db as never).listEnabled('p1', []);
    const query = render(argOf(calls, 'where'));
    expect(query.sql).not.toMatch(/in \(\)/i);
    expect(query.sql).not.toMatch(/binding_scopes/i);
    expect(query.params).toEqual(expect.arrayContaining(['p1', 'program_shared']));
  });

  it('PgBindingStore.listEnabled with scope ids binds each id as a parameter', async () => {
    const { db, calls } = fakeDb([]);
    await new PgBindingStore(db as never).listEnabled('p1', ['a', 'b']);
    const query = render(argOf(calls, 'where'));
    expect(query.params).toEqual(expect.arrayContaining(['a', 'b', 'program_shared']));
  });

  it('markNeedsReviewIfUnchanged uses NULL-safe comparisons for an empty business status', async () => {
    const { db, calls } = fakeDb([{ id: 'd1' }]);
    await expect(new PgGovernanceDocumentStore(db as never).markNeedsReviewIfUnchanged('d1', '', null)).resolves.toBe(true);
    const query = render(argOf(calls, 'where'));
    expect(query.sql).toMatch(/"validity_business_status" IS NOT DISTINCT FROM \$\d+/);
    expect(query.sql).toMatch(/"validity_next_review_at" IS NOT DISTINCT FROM \$\d+::timestamptz/);
    expect(query.params).toEqual(['d1', null, null]);
  });

  it('normalizes business status identically on write and guard', () => {
    expect(normalizeBusinessStatus('')).toBeNull();
    expect(normalizeBusinessStatus(null)).toBeNull();
    expect(normalizeBusinessStatus(undefined)).toBeNull();
    expect(normalizeBusinessStatus('valid')).toBe('valid');
  });

  it('setMetadataField binds the key and value instead of splicing them into SQL', async () => {
    const { db, calls } = fakeDb([]);
    const hostileKey = "x}', '{}'); DROP TABLE t; --";
    await new PgGovernanceDocumentStore(db as never).setMetadataField('p1', 'doc1', hostileKey, { a: 1 });
    const set = argOf(calls, 'set') as { metadata: SQL };
    const query = render(set.metadata);
    expect(query.sql).not.toContain('DROP TABLE');
    expect(query.sql).toContain('ARRAY[$');
    expect(query.params).toEqual([hostileKey, JSON.stringify({ a: 1 })]);
  });
});
