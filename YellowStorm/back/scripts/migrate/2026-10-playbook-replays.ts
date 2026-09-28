/**
 * P5 backfill (package D) — Mongo replay baselines, replay run reports and evaluations → Postgres
 * playbook.validated_replays, playbook.replay_run_reports, playbook.evaluation_baselines and
 * playbook.evaluation_executions. Run after the flows backfill (every row belongs to a flow).
 *
 * The mapping lives in 2026-10-playbook-replays.units.ts. Ids are preserved (lower-cased ObjectId hex).
 *
 *   - a row whose flow is gone is reported as a failure (the foreign key would reject it), never
 *     silently dropped (dev, 2026-09-25: 8 of the 18 validated replays);
 *   - references to a run, a replay, a baseline or a user are soft and kept as they are, even when the
 *     target is gone (dev: 4 replays' reference executions, the 3 reports' executions);
 *   - the legacy replay mode `strict_replay` is kept as stored (the column allows it, the services
 *     normalise it); a report's legacy `skipped` verdict becomes `unknown`, what every read returned.
 * Not migrated (no code reads them): playbook_validated_replays, playbook_replay_run_reports,
 * playbook_evaluation_baselines, playbook_evaluation_executions.
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-playbook-replays.ts [--dry-run] [--verify] [--checksum] [--only=<replays|reports|baselines|evaluations>]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';
import * as u from './2026-10-playbook-replays.units';
import type { PlaybookReplayRefs, Row } from './2026-10-playbook-replays.units';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface Pass {
  key: string;
  collection: string;
  table: string;
  columns: string[];
  build: (doc: MongoDoc) => Row;
  validate: (row: Row, refs: PlaybookReplayRefs) => string | null;
}

const PASSES: Pass[] = [
  { key: 'replays', collection: 'playbook_flow_validated_replays', table: 'playbook.validated_replays', columns: u.REPLAY_COLUMNS, build: u.buildReplay, validate: u.validateReplay },
  { key: 'reports', collection: 'playbook_flow_replay_run_reports', table: 'playbook.replay_run_reports', columns: u.REPORT_COLUMNS, build: u.buildReport, validate: u.validateReport },
  { key: 'baselines', collection: 'playbook_flow_evaluation_baselines', table: 'playbook.evaluation_baselines', columns: u.BASELINE_COLUMNS, build: u.buildBaseline, validate: u.validateBaseline },
  { key: 'evaluations', collection: 'playbook_flow_evaluation_executions', table: 'playbook.evaluation_executions', columns: u.EVALUATION_COLUMNS, build: u.buildEvaluation, validate: u.validateEvaluation },
];

const NOT_MIGRATED = ['playbook_validated_replays', 'playbook_replay_run_reports', 'playbook_evaluation_baselines', 'playbook_evaluation_executions'];

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
  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

  for (const pass of PASSES) {
    if (only && only !== pass.key) continue;
    const refs: PlaybookReplayRefs = { flows: new Set((await pool.query('SELECT id FROM playbook.flows')).rows.map((r) => String(r.id))) };
    console.log(`\n##### ${pass.key}: ${pass.collection} → ${pass.table}`);
    await runBackfill({
      collection: mdb.collection(pass.collection),
      build: pass.build,
      validate: (row) => pass.validate(row, refs),
      insert: (row) => u.insertRow(pool, pass.table, pass.columns, row),
      unitId: (row) => String(row.id),
      exists: async (id) => (await pool.query(`SELECT 1 FROM ${pass.table} WHERE id = $1`, [id])).rowCount! > 0,
      verify: async (rows) => {
        const issues = new Map<string, string>();
        for (const row of rows) {
          if ((await pool.query(`SELECT 1 FROM ${pass.table} WHERE id = $1`, [row.id])).rowCount === 0) issues.set(String(row.id), 'missing in PG');
        }
        return issues;
      },
      checksumRows: async (ids) =>
        new Map((await pool.query(`SELECT ${u.checksumSelect(pass.columns)} FROM ${pass.table} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
      pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${pass.table}`)).rows[0].n,
      pgIds: async () => (await pool.query(`SELECT id FROM ${pass.table}`)).rows.map((r) => String(r.id)),
    });
  }

  console.log('\n=== not migrated (legacy collections nothing reads any more) ===');
  for (const name of NOT_MIGRATED) console.log(`  ${name}: ${await mdb.collection(name).estimatedDocumentCount()} docs`);

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
