/**
 * P6 backfill — Mongo integration_events outbox → Postgres ops.integration_events (+ deliveries).
 *
 * The mapping lives in 2026-10-integration-events.units.ts. Ids are preserved (lower-cased ObjectId hex)
 * and every status is kept as it is: completed events stay audit history, dead letters stay visible for
 * triage, and a still-pending or failed event resumes on the Postgres dispatcher. A `processing` event
 * keeps its claim and is taken over once the claim is older than two minutes. Idempotent: an event whose
 * id is already there is skipped, deliveries included.
 *
 * Run it with the Mongo dispatchers stopped (or right after the cutover deploy): an event that a stale
 * dispatcher completes in Mongo after the copy would be delivered a second time.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-integration-events.ts [--dry-run] [--verify] [--checksum]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill } from './harness';
import { buildEvent, deliveriesOf, EVENT_COLUMNS, insertEvent, validateEvent, type Row } from './2026-10-integration-events.units';

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

  await runBackfill({
    collection: mdb.collection('integration_events'),
    build: buildEvent,
    validate: validateEvent,
    unitId: (row: Row) => String(row.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM ops.integration_events WHERE id = $1', [id])).rowCount! > 0,
    insert: (row) => insertEvent(pool, row),
    verify: async (rows) => {
      const issues = new Map<string, string>();
      for (const row of rows) {
        const stored = await pool.query('SELECT (SELECT count(*)::int FROM ops.integration_event_deliveries WHERE integration_event_id = e.id) AS deliveries FROM ops.integration_events e WHERE e.id = $1', [row.id]);
        if (stored.rowCount === 0) issues.set(String(row.id), 'missing in PG');
        else if (stored.rows[0].deliveries !== deliveriesOf(row).length) issues.set(String(row.id), `deliveries: PG has ${stored.rows[0].deliveries}, Mongo ${deliveriesOf(row).length}`);
      }
      return issues;
    },
    checksumRows: async (ids) =>
      new Map((await pool.query(`SELECT ${EVENT_COLUMNS.join(', ')} FROM ops.integration_events WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM ops.integration_events')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM ops.integration_events')).rows.map((r) => String(r.id)),
  });

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
