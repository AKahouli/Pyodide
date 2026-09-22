/**
 * Step 1B.2.5 backfill — Mongo → Postgres:
 *   system_settings     → catalog.system_settings     (value passed verbatim as jsonb)
 *   appearance_logos    → catalog.appearance_logos    (Buffer → bytea, sha256-verified)
 *   guardrails_settings → catalog.guardrails_settings (singleton row)
 * Idempotent: ON CONFLICT DO NOTHING on key/id/singleton.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-settings.ts [--dry-run]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;
const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');
const dateOf = (v: unknown): Date => (v ? new Date(String(v)) : new Date());
// Mongo driver wraps logo bytes in its Binary class ({ sub_type, buffer, position }).
const toBuffer = (v: unknown): Buffer => {
  if (Buffer.isBuffer(v)) return v;
  const raw = (v as { buffer?: unknown } | null)?.buffer;
  if (Buffer.isBuffer(raw)) return raw;
  if (v instanceof Uint8Array) return Buffer.from(v);
  throw new Error('logo data is not binary');
};

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

  // ── system_settings ─────────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('system_settings'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      key: String(doc.key),
      value: JSON.stringify(doc.value ?? {}),
      created_at: dateOf(doc.createdAt),
      updated_at: dateOf(doc.updatedAt),
    }),
    unitId: (unit) => String(unit.key),
    exists: async (key) => {
      const r = await pool.query('SELECT 1 FROM catalog.system_settings WHERE key = $1', [String(key)]);
      return r.rowCount! > 0;
    },
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.system_settings (id, key, value, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING`,
        [String(unit.id), String(unit.key), String(unit.value), unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const key = String(unit.key);
        const r = await pool.query('SELECT value FROM catalog.system_settings WHERE key = $1', [key]);
        if (r.rowCount === 0) map.set(key, 'missing in PG');
        else if (sha256(JSON.stringify(r.rows[0].value)) !== sha256(JSON.stringify(JSON.parse(String(unit.value))))) {
          map.set(key, 'value mismatch');
        }
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.system_settings')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT key AS id FROM catalog.system_settings')).rows.map((r) => r.id),
  });

  // ── appearance_logos (bytes verified by sha256) ─────────────────────
  await runBackfill({
    collection: mdb.collection('appearance_logos'),
    build: (doc: MongoDoc): Row => {
      const bytes = toBuffer(doc.data);
      return {
        id: String(doc._id),
        name: String(doc.name),
        content_type: String(doc.contentType),
        width: Number(doc.width),
        height: Number(doc.height),
        data: bytes,
        data_hash: sha256(bytes),
        created_at: dateOf(doc.createdAt),
        updated_at: dateOf(doc.updatedAt),
      };
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => {
      const r = await pool.query('SELECT 1 FROM catalog.appearance_logos WHERE id = $1', [id]);
      return r.rowCount! > 0;
    },
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.appearance_logos (id, name, content_type, width, height, data, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.name, unit.content_type, unit.width, unit.height, unit.data, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const id = String(unit.id);
        const r = await pool.query('SELECT data FROM catalog.appearance_logos WHERE id = $1', [id]);
        if (r.rowCount === 0) map.set(id, 'missing in PG');
        else if (sha256(r.rows[0].data) !== String(unit.data_hash)) map.set(id, 'byte mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.appearance_logos')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM catalog.appearance_logos')).rows.map((r) => r.id),
  });

  // ── guardrails_settings (singleton) ─────────────────────────────────
  await runBackfill({
    collection: mdb.collection('guardrails_settings'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      force_activation: doc.forceActivation === true,
      prompt_injection: JSON.stringify(doc.promptInjection ?? {}),
      tool_action_review: JSON.stringify(doc.toolActionReview ?? {}),
      created_at: dateOf(doc.createdAt),
      updated_at: dateOf(doc.updatedAt),
    }),
    unitId: () => 'guardrails_singleton',
    exists: async () => {
      const r = await pool.query('SELECT 1 FROM catalog.guardrails_settings LIMIT 1');
      return r.rowCount! > 0;
    },
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.guardrails_settings (id, singleton, force_activation, prompt_injection, tool_action_review, created_at, updated_at)
         VALUES ($1, TRUE, $2, $3, $4, $5, $6) ON CONFLICT (singleton) DO NOTHING`,
        [unit.id, unit.force_activation, unit.prompt_injection, unit.tool_action_review, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const id = String(unit.id);
        const r = await pool.query(
          'SELECT force_activation, prompt_injection, tool_action_review FROM catalog.guardrails_settings LIMIT 1',
        );
        if (r.rowCount === 0) {
          map.set(id, 'missing in PG');
        } else if (
          r.rows[0].force_activation !== unit.force_activation ||
          JSON.stringify(r.rows[0].prompt_injection) !== JSON.stringify(JSON.parse(String(unit.prompt_injection))) ||
          JSON.stringify(r.rows[0].tool_action_review) !== JSON.stringify(JSON.parse(String(unit.tool_action_review)))
        ) {
          map.set(id, 'field mismatch');
        }
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.guardrails_settings')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM catalog.guardrails_settings')).rows.map((r) => r.id),
  });

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
