/**
 * P5 backfill — Mongo playbook_flow_dynamic_reasoning_attempts → Postgres playbook.dynamic_reasoning_attempts.
 *
 * The mapping lives in 2026-10-playbook-attempts.units.ts. Ids are preserved (lower-cased ObjectId
 * hex). Runs after the executions pass: an attempt whose execution is not in Postgres is reported as
 * a failure with the reason (the foreign key would reject it), never inserted. `flow_id` is kept as
 * is. Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-playbook-attempts.ts [--dry-run] [--verify] [--checksum]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill } from './harness';
import {
  ATTEMPT_COLLECTION,
  ATTEMPT_COLUMNS,
  ATTEMPT_TABLE,
  buildAttempt,
  insertAttempt,
  validateAttempt,
  type Row,
} from './2026-10-playbook-attempts.units';

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

  const executions = new Set((await pool.query('SELECT id FROM playbook.executions')).rows.map((r) => String(r.id)));
  console.log(`\n##### attempts: ${ATTEMPT_COLLECTION} → ${ATTEMPT_TABLE} (${executions.size} executions in PG)`);
  await runBackfill({
    collection: mdb.collection(ATTEMPT_COLLECTION),
    build: buildAttempt,
    validate: (row: Row) => validateAttempt(row, { executions }),
    unitId: (row: Row) => String(row.id),
    exists: async (id) => (await pool.query(`SELECT 1 FROM ${ATTEMPT_TABLE} WHERE id = $1`, [id])).rowCount! > 0,
    insert: (row) => insertAttempt(pool, row),
    verify: async (rows) => {
      const issues = new Map<string, string>();
      for (const row of rows) {
        if (!executions.has(String(row.execution_id))) continue; // reported by the main pass
        if ((await pool.query(`SELECT 1 FROM ${ATTEMPT_TABLE} WHERE id = $1`, [row.id])).rowCount === 0) issues.set(String(row.id), 'missing in PG');
      }
      return issues;
    },
    checksumRows: async (ids) =>
      new Map((await pool.query(`SELECT ${ATTEMPT_COLUMNS.join(', ')} FROM ${ATTEMPT_TABLE} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
    pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${ATTEMPT_TABLE}`)).rows[0].n,
    pgIds: async () => (await pool.query(`SELECT id FROM ${ATTEMPT_TABLE}`)).rows.map((r) => String(r.id)),
  });

  const softReferences = (await pool.query(
    `SELECT count(*)::int AS n FROM ${ATTEMPT_TABLE} a WHERE NOT EXISTS (SELECT 1 FROM playbook.flows f WHERE f.id = a.flow_id)`,
  )).rows[0].n;
  console.log(`=== soft references === ${softReferences} attempt(s) name a flow that is not in Postgres (kept)`);

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
