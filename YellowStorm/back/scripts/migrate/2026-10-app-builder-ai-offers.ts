/**
 * P8 backfill — Mongo app_builder_ai_offers + user offer fields → Postgres.
 *
 * Order: offers → identity.users offer columns (FK integrity).
 * Offer ids are preserved (24-char hex).
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-app-builder-ai-offers.ts [--dry-run] [--verify] [--only=offers|users]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, BackfillError, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const isObjectId = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);

type Row = Record<string, unknown>;

const s = (v: unknown): string | null => (v == null ? null : String(v));
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const b = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const n = (v: unknown, fallback: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(mongoUri);
  const mdb = mongoose.connection.db!;
  const col = (name: string): mongoose.mongo.Collection => mdb.collection(name);

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 5,
  });

  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const run = (unit: string, fn: () => Promise<void>): Promise<void> =>
    (!only || only === unit) ? fn() : Promise.resolve();

  const offerIds = new Set<string>(
    (await pool.query('SELECT id FROM catalog.app_builder_ai_offers')).rows.map(
      (r) => String(r.id).trim().toLowerCase(),
    ),
  );

  // ---- offers ------------------------------------------------------------
  await run('offers', async () => {
    await runBackfill({
      collection: col('app_builder_ai_offers'),
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id).toLowerCase();
        if (!isObjectId(id)) throw new BackfillError('offer id is not 24-char hex', id);
        const slug = String(doc.slug ?? '').trim().toLowerCase();
        if (!slug) throw new BackfillError('missing slug', id);
        return {
          id,
          name: String(doc.name ?? ''),
          slug,
          description: s(doc.description),
          token_limit: n(doc.tokenLimit, 0),
          window_hours: Math.max(1, n(doc.windowHours, 24)),
          requests_per_minute: n(doc.requestsPerMinute, 60),
          max_tokens_per_request: n(doc.maxTokensPerRequest, -1),
          priority: n(doc.priority, 0),
          is_active: b(doc.isActive, true),
          is_default: b(doc.isDefault),
          display_order: n(doc.displayOrder, 0),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
        };
      },
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM catalog.app_builder_ai_offers WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        // Clear other defaults when inserting a default (partial unique index).
        if (unit.is_default) {
          await pool.query(
            'UPDATE catalog.app_builder_ai_offers SET is_default = false WHERE is_default = true',
          );
        }
        await pool.query(
          `INSERT INTO catalog.app_builder_ai_offers (
            id, name, slug, description, token_limit, window_hours, requests_per_minute,
            max_tokens_per_request, priority, is_active, is_default, display_order,
            created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
          ) ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.name, unit.slug, unit.description, unit.token_limit, unit.window_hours,
            unit.requests_per_minute, unit.max_tokens_per_request, unit.priority,
            unit.is_active, unit.is_default, unit.display_order, unit.created_at, unit.updated_at,
          ],
        );
        offerIds.add(unit.id as string);
      },
      pgCount: async () =>
        (await pool.query('SELECT count(*)::int AS n FROM catalog.app_builder_ai_offers')).rows[0].n,
      pgIds: async () =>
        (await pool.query('SELECT id FROM catalog.app_builder_ai_offers')).rows.map(
          (r) => String(r.id).trim().toLowerCase(),
        ),
    });
  });

  for (const id of (await pool.query('SELECT id FROM catalog.app_builder_ai_offers')).rows.map(
    (r) => String(r.id).trim().toLowerCase(),
  )) {
    offerIds.add(id);
  }

  // ---- users (offer assignment columns) ----------------------------------
  await run('users', async () => {
    let skippedMissingUser = 0;
    let skippedUnknownOffer = 0;
    await runBackfill({
      collection: col('users'),
      filter: { appBuilderAiOfferId: { $exists: true, $ne: null } },
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id).toLowerCase();
        if (!isObjectId(id)) throw new BackfillError('user id is not 24-char hex', id);
        const offerId = String(doc.appBuilderAiOfferId ?? '').toLowerCase();
        if (!isObjectId(offerId)) throw new BackfillError('appBuilderAiOfferId invalid', id);
        if (!offerIds.has(offerId)) {
          skippedUnknownOffer += 1;
          throw new BackfillError(`unknown offer ${offerId}`, id);
        }
        return {
          id,
          app_builder_ai_offer_id: offerId,
          app_builder_ai_offer_started_at: d(doc.appBuilderAiOfferStartedAt),
        };
      },
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query(
          'SELECT 1 FROM identity.users WHERE id = $1 AND app_builder_ai_offer_id IS NOT NULL',
          [id],
        );
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        const r = await pool.query(
          `UPDATE identity.users
           SET app_builder_ai_offer_id = $2,
               app_builder_ai_offer_started_at = $3,
               updated_at = now()
           WHERE id = $1`,
          [unit.id, unit.app_builder_ai_offer_id, unit.app_builder_ai_offer_started_at],
        );
        if (r.rowCount === 0) {
          skippedMissingUser += 1;
          throw new BackfillError('user missing in identity.users', String(unit.id));
        }
      },
      pgCount: async () =>
        (await pool.query(
          'SELECT count(*)::int AS n FROM identity.users WHERE app_builder_ai_offer_id IS NOT NULL',
        )).rows[0].n,
    });
    console.warn(JSON.stringify({
      label: 'user offer assignment skips',
      skippedMissingUser,
      skippedUnknownOffer,
    }));
  });

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
