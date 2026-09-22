import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgPlanStore } from './pg-plan.store';

describeIntegration('PgPlanStore (integration)', () => {
  const { db, close } = makeTestDb();
  const store = new PgPlanStore(db as NodePgDatabase<typeof schema>);
  const tag = newObjectId().slice(-8);
  const slugs: string[] = [];
  let priorDefaults: string[] = [];

  const data = (suffix: string, isDefault = false) => {
    const slug = `spec-${tag}-${suffix}`;
    slugs.push(slug);
    return { name: `spec-${tag}-${suffix}`, slug, tokenLimit: 100, windowHours: 24, priority: 0, priceMonthly: 9.5, isDefault };
  };
  const defaultHolders = async (): Promise<string[]> =>
    (await db.select({ slug: schema.catalogPlans.slug }).from(schema.catalogPlans).where(eq(schema.catalogPlans.isDefault, true))).map((r) => r.slug);

  beforeAll(async () => { priorDefaults = await defaultHolders(); });

  afterAll(async () => {
    if (slugs.length) await db.delete(schema.catalogPlans).where(inArray(schema.catalogPlans.slug, slugs));
    // Restore the default flag(s) the flip cleared on pre-existing rows.
    if (priorDefaults.length) await db.update(schema.catalogPlans).set({ isDefault: true }).where(inArray(schema.catalogPlans.slug, priorDefaults));
    await close();
  });

  it('inserts, maps numeric prices to numbers and finds by id/slug', async () => {
    const created = await store.insert(data('a'));
    expect(created).toMatchObject({ priceMonthly: 9.5, isDefault: false });
    expect((await store.findById(created!.id))?.slug).toBe(created!.slug);
    expect((await store.findBySlug(created!.slug))?.id).toBe(created!.id);
  });

  it('insert returns null on a duplicate slug', async () => {
    const d = data('dup');
    expect(await store.insert(d)).not.toBeNull();
    expect(await store.insert({ ...d, name: `${d.name}-2` })).toBeNull();
  });

  it('seed is idempotent per slug', async () => {
    const d = data('seed');
    await store.seed(d);
    await store.seed({ ...d, tokenLimit: 999 });
    expect((await store.findBySlug(d.slug))?.tokenLimit).toBe(100);
  });

  it('insert with isDefault flips the single default; update(isDefault) flips it back', async () => {
    const first = await store.insert(data('d1', true));
    expect(await defaultHolders()).toEqual([first!.slug]);
    const second = await store.insert(data('d2', true));
    expect(await defaultHolders()).toEqual([second!.slug]);
    expect((await store.findFlaggedDefault())?.id).toBe(second!.id);

    const updated = await store.update(first!.id, { isDefault: true });
    expect(updated?.isDefault).toBe(true);
    expect(await defaultHolders()).toEqual([first!.slug]);
  });

  it('update returns null for an unknown id', async () => {
    expect(await store.update(newObjectId(), { tokenLimit: 1 })).toBeNull();
  });
});
