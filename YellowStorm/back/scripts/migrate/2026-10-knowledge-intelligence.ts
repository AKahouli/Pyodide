/**
 * P6 backfill — Mongo knowledge-intelligence → Postgres governance.knowledge_* tables.
 *
 *   knowledge_extraction_jobs   → governance.knowledge_extraction_jobs
 *   temporal_candidate_records  → governance.temporal_candidate_records
 *   knowledge_alerts            → governance.knowledge_alerts
 *   knowledge_assessments       → governance.knowledge_assessments
 *   knowledge_recommendations   → governance.knowledge_recommendations
 *   metadata_candidates         → governance.metadata_candidates
 *
 * The mapping lives in 2026-10-knowledge-intelligence.units.ts. Ids are preserved (lower-cased
 * ObjectId hex). Jobs go before the temporal records that reference them. Rows whose program,
 * document, connector or job no longer exists are reported as failures (the foreign keys reject
 * them), never silently dropped. The collections are empty in dev; this exists for environments
 * that hold data. Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-knowledge-intelligence.ts [--dry-run] [--verify] [--checksum] [--only=jobs|temporal|alerts|assessments|recommendations|metadata]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill } from './harness';
import { insertKnowledgeRow, KNOWLEDGE_UNITS, type Row } from './2026-10-knowledge-intelligence.units';

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
  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

  for (const unit of KNOWLEDGE_UNITS) {
    if (only && only !== unit.name) continue;
    await runBackfill({
      collection: mdb.collection(unit.mongo),
      build: unit.build,
      unitId: (row) => row.id as string,
      exists: async (id) => (await pool.query(`SELECT 1 FROM ${unit.table} WHERE id = $1`, [id])).rowCount! > 0,
      insert: (row) => insertKnowledgeRow(pool, unit, row),
      verify: async (rows) => {
        const issues = new Map<string, string>();
        for (const row of rows) {
          const r = await pool.query(`SELECT 1 FROM ${unit.table} WHERE id = $1`, [row.id]);
          if (r.rowCount === 0) issues.set(String(row.id), 'missing in PG');
        }
        return issues;
      },
      checksumRows: async (ids) =>
        new Map((await pool.query(`SELECT ${unit.columns.join(', ')} FROM ${unit.table} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
      pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${unit.table}`)).rows[0].n,
      pgIds: async () => (await pool.query(`SELECT id FROM ${unit.table}`)).rows.map((r) => String(r.id)),
    });
  }

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
