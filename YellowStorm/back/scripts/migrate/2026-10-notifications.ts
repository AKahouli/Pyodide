/**
 * Step 1B.1.5 backfill — Mongo notifications → Postgres ops.notifications.
 * Already-expired rows are skipped (the TTL sweeper would have removed them).
 * Idempotent via ON CONFLICT DO NOTHING (id preserved).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-notifications.ts [--dry-run]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const mdb = mongoose.connection.db!;

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 5,
  });

  await runBackfill({
    collection: mdb.collection('notifications'),
    filter: { 'metadata.expiresAt': { $gt: new Date() } },
    build: (doc: MongoDoc): Row => {
      const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
      return {
        id: String(doc._id),
        user_id: s(doc.userId),
        type: String(doc.type),
        title: String(doc.title),
        message: String(doc.message),
        data: (doc.data as Record<string, unknown>) ?? null,
        actions: JSON.stringify(Array.isArray(doc.actions) ? doc.actions : []),
        destination: String(doc.destination ?? 'user'),
        status: String(doc.status ?? 'pending'),
        source_module: String(metadata.sourceModule ?? 'system'),
        priority: String(metadata.priority ?? 'normal'),
        expires_at: metadata.expiresAt ? new Date(String(metadata.expiresAt)) : null,
        metadata_extra: (metadata.extra as Record<string, unknown>) ?? null,
        sent_at: doc.sentAt ? new Date(String(doc.sentAt)) : null,
        read_at: doc.readAt ? new Date(String(doc.readAt)) : null,
        retry_count: typeof doc.retryCount === 'number' ? doc.retryCount : 0,
        last_error: s(doc.lastError),
        created_at: doc.createdAt ? new Date(String(doc.createdAt)) : new Date(),
        updated_at: doc.updatedAt ? new Date(String(doc.updatedAt)) : new Date(),
      };
    },
    validate: (unit) =>
      !['info', 'warning', 'error', 'success', 'system'].includes(String(unit.type)) ? `invalid type ${unit.type}` : null,
    unitId: (unit) => String(unit.id),
    exists: async (id) => {
      const r = await pool.query('SELECT 1 FROM ops.notifications WHERE id = $1', [id]);
      return r.rowCount! > 0;
    },
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO ops.notifications (id, user_id, type, title, message, data, actions, destination, status,
          source_module, priority, expires_at, metadata_extra, sent_at, read_at, retry_count, last_error, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (id) DO NOTHING`,
        [
          unit.id, unit.user_id, unit.type, unit.title, unit.message, unit.data ? JSON.stringify(unit.data) : null,
          unit.actions as string, unit.destination, unit.status, unit.source_module, unit.priority,
          unit.expires_at, unit.metadata_extra ? JSON.stringify(unit.metadata_extra) : null,
          unit.sent_at, unit.read_at, unit.retry_count, unit.last_error, unit.created_at, unit.updated_at,
        ],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT status, type FROM ops.notifications WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].status !== unit.status || r.rows[0].type !== unit.type) map.set(String(unit.id), 'field mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM ops.notifications')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM ops.notifications')).rows.map((r) => r.id),
  });

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
