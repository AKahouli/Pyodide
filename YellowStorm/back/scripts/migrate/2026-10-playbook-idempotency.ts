/**
 * P5 backfill — Mongo flowidempotencyrecords → Postgres playbook.idempotency_records.
 *
 * The mapping lives in 2026-10-playbook-idempotency.units.ts. Ids are preserved (lower-cased ObjectId
 * hex). Only records that have not expired are copied; an execution id pointing at an execution that
 * is gone is kept (soft reference, no foreign key). flowexecutionleases is transient and not migrated:
 * its count is printed for the record. Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * No parent pass is needed (the table has no foreign key), so it can run at any point of the ordered
 * playbook backfill.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-playbook-idempotency.ts [--dry-run] [--verify] [--checksum]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill } from './harness';
import {
  buildIdempotencyRecord,
  IDEMPOTENCY_COLLECTION,
  IDEMPOTENCY_COLUMNS,
  IDEMPOTENCY_TABLE,
  insertIdempotencyRecord,
  LEASE_COLLECTION,
  liveIdempotencyFilter,
  validateIdempotencyRecord,
  type Row,
} from './2026-10-playbook-idempotency.units';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

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

  const now = new Date();
  const collection = mdb.collection(IDEMPOTENCY_COLLECTION);
  console.log(`\n##### idempotency: ${IDEMPOTENCY_COLLECTION} → ${IDEMPOTENCY_TABLE} (live at ${now.toISOString()})`);
  await runBackfill({
    collection,
    filter: liveIdempotencyFilter(now),
    build: buildIdempotencyRecord,
    validate: validateIdempotencyRecord,
    unitId: (row: Row) => String(row.id),
    exists: async (id) => (await pool.query(`SELECT 1 FROM ${IDEMPOTENCY_TABLE} WHERE id = $1`, [id])).rowCount! > 0,
    insert: (row) => insertIdempotencyRecord(pool, row),
    verify: async (rows) => {
      const issues = new Map<string, string>();
      for (const row of rows) {
        if ((await pool.query(`SELECT 1 FROM ${IDEMPOTENCY_TABLE} WHERE id = $1`, [row.id])).rowCount === 0) issues.set(String(row.id), 'missing in PG');
      }
      return issues;
    },
    checksumRows: async (ids) =>
      new Map((await pool.query(`SELECT ${IDEMPOTENCY_COLUMNS.join(', ')} FROM ${IDEMPOTENCY_TABLE} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
    pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${IDEMPOTENCY_TABLE}`)).rows[0].n,
    pgIds: async () => (await pool.query(`SELECT id FROM ${IDEMPOTENCY_TABLE}`)).rows.map((r) => String(r.id)),
  });

  const softReferences = (await pool.query(
    `SELECT count(*)::int AS n FROM ${IDEMPOTENCY_TABLE} r WHERE r.execution_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM playbook.executions e WHERE e.id = r.execution_id)`,
  )).rows[0].n;
  console.log(`=== soft references === ${softReferences} record(s) point at an execution that is not in Postgres (kept)`);

  console.log('\n=== not migrated ===');
  console.log(`  ${IDEMPOTENCY_COLLECTION}: ${await collection.countDocuments({ expiresAt: { $lte: now } })} expired record(s) (the TTL would have removed them)`);
  console.log(`  ${LEASE_COLLECTION}: ${await mdb.collection(LEASE_COLLECTION).estimatedDocumentCount()} transient lease(s)`);

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
