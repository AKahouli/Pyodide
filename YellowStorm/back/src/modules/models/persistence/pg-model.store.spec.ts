import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgModelStore } from './pg-model.store';

describeIntegration('PgModelStore (integration)', () => {
  const { db, close } = makeTestDb();
  const store = new PgModelStore(db as NodePgDatabase<typeof schema>);
  const tag = newObjectId().slice(-8);
  const modelIds: string[] = [];
  let priorDefault: string[] = [];
  let priorV2Default: string[] = [];

  const row = (suffix: string) => {
    const modelId = `spec-${tag}-${suffix}`;
    modelIds.push(modelId);
    return { modelId, name: `Spec ${suffix}`, chef: 'Spec', chefSlug: 'spec' };
  };

  beforeAll(async () => {
    // setExclusiveFlag clears the flag on EVERY row; remember holders to restore them.
    priorDefault = (await db.select({ id: schema.catalogAiModels.id }).from(schema.catalogAiModels).where(eq(schema.catalogAiModels.isDefault, true))).map((r) => r.id);
    priorV2Default = (await db.select({ id: schema.catalogAiModels.id }).from(schema.catalogAiModels).where(eq(schema.catalogAiModels.isConversationV2Default, true))).map((r) => r.id);
  });

  afterAll(async () => {
    if (modelIds.length) await db.delete(schema.catalogAiModels).where(inArray(schema.catalogAiModels.modelId, modelIds));
    if (priorDefault.length) await db.update(schema.catalogAiModels).set({ isDefault: true }).where(inArray(schema.catalogAiModels.id, priorDefault));
    if (priorV2Default.length) await db.update(schema.catalogAiModels).set({ isConversationV2Default: true }).where(inArray(schema.catalogAiModels.id, priorV2Default));
    await close();
  });

  it('insertIfAbsent returns true then false for the same modelId and keeps the first row', async () => {
    const r = row('once');
    expect(await store.insertIfAbsent(r)).toBe(true);
    expect(await store.insertIfAbsent({ ...r, name: 'Other name' })).toBe(false);
    expect((await store.findByModelId(r.modelId))?.name).toBe(r.name);
  });

  it('two parallel insertIfAbsent of one modelId: exactly one true', async () => {
    const r = row('race');
    const results = await Promise.all([store.insertIfAbsent(r), store.insertIfAbsent(r), store.insertIfAbsent(r)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it.each(['isDefault', 'isConversationV2Default'] as const)('setExclusiveFlag(%s) leaves a single holder', async (flag) => {
    const a = row(`${flag}-a`);
    const b = row(`${flag}-b`);
    await store.insertIfAbsent(a);
    await store.insertIfAbsent(b);

    expect((await store.setExclusiveFlag(a.modelId, flag))?.[flag]).toBe(true);
    expect((await store.setExclusiveFlag(b.modelId, flag))?.[flag]).toBe(true);

    expect((await store.findByModelId(a.modelId))?.[flag]).toBe(false);
    expect((await store.findByModelId(b.modelId))?.[flag]).toBe(true);
    const col = schema.catalogAiModels[flag];
    const holders = await db.select({ id: schema.catalogAiModels.id }).from(schema.catalogAiModels).where(eq(col, true));
    expect(holders).toHaveLength(1);
  });

  it('setExclusiveFlag on an unknown model returns null and does not leave two holders', async () => {
    expect(await store.setExclusiveFlag(`spec-${tag}-missing`, 'isDefault')).toBeNull();
    const holders = await db.select({ id: schema.catalogAiModels.id }).from(schema.catalogAiModels).where(eq(schema.catalogAiModels.isDefault, true));
    expect(holders.length).toBeLessThanOrEqual(1);
  });

  it('the unique partial index rejects a second default written around the store', async () => {
    const a = row('idx-a');
    const b = row('idx-b');
    await store.insertIfAbsent(a);
    await store.insertIfAbsent(b);
    await store.setExclusiveFlag(a.modelId, 'isDefault');
    await expect(
      db.update(schema.catalogAiModels).set({ isDefault: true }).where(eq(schema.catalogAiModels.modelId, b.modelId)),
    ).rejects.toThrow();
  });

  it('two parallel setExclusiveFlag calls never leave two holders (or fail only on the unique index)', async () => {
    const a = row('par-a');
    const b = row('par-b');
    await store.insertIfAbsent(a);
    await store.insertIfAbsent(b);
    await Promise.allSettled([store.setExclusiveFlag(a.modelId, 'isDefault'), store.setExclusiveFlag(b.modelId, 'isDefault')]);
    const holders = await db.select({ id: schema.catalogAiModels.id }).from(schema.catalogAiModels).where(eq(schema.catalogAiModels.isDefault, true));
    expect(holders.length).toBeLessThanOrEqual(1);
  });

  it('deactivateNotIn([]) is a no-op returning 0', async () => {
    const r = row('keep');
    await store.insertIfAbsent(r);
    expect(await store.deactivateNotIn([])).toBe(0);
    expect((await store.findByModelId(r.modelId))?.isActive).toBe(true);
  });
});
