import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgAppearanceLogoStore } from './pg-appearance-logo.store';
import type { AppearanceLogoRecord } from './appearance-logo.store';

describeIntegration('PgAppearanceLogoStore (integration)', () => {
  const { db, close } = makeTestDb();
  const store = new PgAppearanceLogoStore(db as NodePgDatabase<typeof schema>);
  const tag = newObjectId().slice(-8);
  const created: string[] = [];

  const input = (n: number) => ({ name: `spec-${tag}-${n}`, contentType: 'image/png', width: 8, height: 8, data: Buffer.from([1, 2, 3, n]) });
  const track = (r: AppearanceLogoRecord | null): AppearanceLogoRecord | null => {
    if (r) created.push(r.id);
    return r;
  };

  afterAll(async () => {
    if (created.length) await db.delete(schema.catalogAppearanceLogos).where(inArray(schema.catalogAppearanceLogos.id, created));
    await close();
  });

  it('creates, reads data, updates and deletes a logo', async () => {
    const logo = track(await store.createWithinCap(input(0), 1_000_000));
    expect(logo).toMatchObject({ name: `spec-${tag}-0`, contentType: 'image/png' });
    expect((await store.findWithData(logo!.id))?.data.equals(Buffer.from([1, 2, 3, 0]))).toBe(true);
    expect((await store.update(logo!.id, { name: `spec-${tag}-renamed` }))?.name).toBe(`spec-${tag}-renamed`);
    expect(await store.update(newObjectId(), { name: 'x' })).toBeNull();
    expect(await store.delete(logo!.id)).toBe(true);
    expect(await store.delete(logo!.id)).toBe(false);
    expect(await store.findWithData(logo!.id)).toBeNull();
  });

  it('returns null when the cap is already reached', async () => {
    const current = (await store.list()).length;
    expect(await store.createWithinCap(input(1), current)).toBeNull();
  });

  it('N+3 PARALLEL creates against a cap of N yield exactly N rows (advisory lock)', async () => {
    const existing = (await store.list()).length;
    const room = 3;
    const cap = existing + room;
    const results = await Promise.all(Array.from({ length: room + 3 }, (_, i) => store.createWithinCap(input(10 + i), cap)));
    results.forEach(track);
    expect(results.filter((r) => r !== null)).toHaveLength(room);
    expect((await store.list()).length).toBe(cap);
  });
});
