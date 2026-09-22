import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { DEFAULT_ADMIN_GUARDRAILS_SETTINGS, type AdminGuardrailsSettings } from '../services/guardrails-settings.service';
import { PgGuardrailsSettingsStore } from './pg-guardrails-settings.store';

describeIntegration('PgGuardrailsSettingsStore (integration)', () => {
  const { db, close } = makeTestDb();
  const store = new PgGuardrailsSettingsStore(db as NodePgDatabase<typeof schema>);
  let original: Awaited<ReturnType<PgGuardrailsSettingsStore['find']>> = null;

  beforeAll(async () => { original = await store.find(); });

  afterAll(async () => {
    // Singleton: restore what was there, or remove the single row this spec created.
    if (original) await store.upsert(original as unknown as AdminGuardrailsSettings);
    else await db.delete(schema.catalogGuardrailsSettings);
    await close();
  });

  it('upsert keeps a single singleton row and find returns the latest values', async () => {
    const a: AdminGuardrailsSettings = { ...DEFAULT_ADMIN_GUARDRAILS_SETTINGS, forceActivation: true };
    const b: AdminGuardrailsSettings = {
      ...DEFAULT_ADMIN_GUARDRAILS_SETTINGS,
      forceActivation: false,
      promptInjection: { ...DEFAULT_ADMIN_GUARDRAILS_SETTINGS.promptInjection, inputEnabled: true, mode: 'strict' },
    };
    await store.upsert(a);
    expect((await store.find())?.forceActivation).toBe(true);
    await store.upsert(b);
    const found = await store.find();
    expect(found?.forceActivation).toBe(false);
    expect(found?.promptInjection).toMatchObject({ inputEnabled: true, mode: 'strict' });
    expect(await db.select().from(schema.catalogGuardrailsSettings)).toHaveLength(1);
  });

  it('parallel writes do not create a second row', async () => {
    await Promise.all([
      store.upsert(DEFAULT_ADMIN_GUARDRAILS_SETTINGS),
      store.upsert({ ...DEFAULT_ADMIN_GUARDRAILS_SETTINGS, forceActivation: true }),
    ]);
    expect(await db.select().from(schema.catalogGuardrailsSettings)).toHaveLength(1);
  });
});
