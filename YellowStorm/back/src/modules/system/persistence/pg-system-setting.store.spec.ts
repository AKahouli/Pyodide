import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgSystemSettingStore } from './pg-system-setting.store';

describeIntegration('PgSystemSettingStore (integration)', () => {
  const { db, close } = makeTestDb();
  const store = new PgSystemSettingStore(db as NodePgDatabase<typeof schema>);
  const tag = newObjectId().slice(-8);
  const k = (s: string) => `spec-${tag}-${s}`;
  const keys = [k('a'), k('b'), k('c'), k('race')];

  afterAll(async () => {
    await db.delete(schema.catalogSystemSettings).where(inArray(schema.catalogSystemSettings.key, keys));
    await close();
  });

  it('upsert inserts then overwrites the value and bumps updatedAt', async () => {
    const first = await store.upsert(k('a'), { n: 1 });
    expect(first.value).toEqual({ n: 1 });
    const second = await store.upsert(k('a'), 'text');
    expect(second.value).toBe('text');
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
    expect((await store.get(k('a')))?.value).toBe('text');
  });

  it('get returns null for a missing key; getMany returns only existing keys', async () => {
    expect(await store.get(k('missing'))).toBeNull();
    await store.upsert(k('b'), true);
    await store.upsert(k('c'), [1, 2]);
    const many = await store.getMany([k('b'), k('c'), k('missing')]);
    expect(many.map((r) => r.key).sort()).toEqual([k('b'), k('c')]);
    expect(await store.getMany([])).toEqual([]);
  });

  it('delete removes the key and is a no-op when absent', async () => {
    await store.upsert(k('b'), 1);
    await store.delete(k('b'));
    expect(await store.get(k('b'))).toBeNull();
    await expect(store.delete(k('b'))).resolves.toBeUndefined();
  });

  it('parallel upserts of one key converge on a single row', async () => {
    await Promise.all([store.upsert(k('race'), 1), store.upsert(k('race'), 2), store.upsert(k('race'), 3)]);
    const rows = await db.select().from(schema.catalogSystemSettings).where(inArray(schema.catalogSystemSettings.key, [k('race')]));
    expect(rows).toHaveLength(1);
  });
});
