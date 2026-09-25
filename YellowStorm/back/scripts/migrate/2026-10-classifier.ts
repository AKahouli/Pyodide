/**
 * P6 backfill — Mongo classifier collections → Postgres classifier.* tables.
 *
 *   classification_runs          → classifier.runs
 *   classifier_folders           → classifier.folders
 *   classifier_file_assignments  → classifier.file_assignments
 *   classifier_rules             → classifier.rules
 *
 * The mapping lives in 2026-10-classifier.units.ts. Ids are preserved (lower-cased ObjectId hex).
 * Runs go first (assignments reference them), then folders (parents before children), then the
 * assignments and rules. Rows whose workspace, document or user no longer exists are reported as
 * failures (the foreign keys would reject them), never silently dropped; an assignment whose
 * folder or run is gone keeps its file and loses only that reference. Idempotent:
 * ON CONFLICT (id) DO NOTHING.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-classifier.ts [--dry-run] [--verify] [--checksum] [--only=runs|folders|assignments|rules]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';
import {
  ASSIGNMENT_COLUMNS,
  buildAssignment,
  buildFolder,
  buildRule,
  buildRun,
  FOLDER_COLUMNS,
  FolderPlan,
  insertAssignment,
  insertRow,
  RULE_COLUMNS,
  RUN_COLUMNS,
  validateAssignment,
  validateRule,
  validateRun,
  type ClassifierRefs,
  type Row,
} from './2026-10-classifier.units';

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
  const wants = (unit: string): boolean => !only || only === unit;

  const idSet = async (sql: string): Promise<Set<string>> => new Set((await pool.query(sql)).rows.map((r) => String(r.id)));
  const refs: ClassifierRefs = {
    workspaces: await idSet('SELECT id FROM workspace.workspaces'),
    documents: await idSet('SELECT id FROM workspace.workspace_documents'),
    users: await idSet('SELECT id FROM identity.users'),
  };

  const common = (table: string, columns: string[]) => ({
    unitId: (row: Row) => String(row.id),
    exists: async (id: string) => (await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount! > 0,
    verify: async (rows: Row[]) => {
      const issues = new Map<string, string>();
      for (const row of rows) {
        if ((await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [row.id])).rowCount === 0) issues.set(String(row.id), 'missing in PG');
      }
      return issues;
    },
    checksumRows: async (ids: string[]) =>
      new Map((await pool.query(`SELECT ${columns.join(', ')} FROM ${table} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
    pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
    pgIds: async () => (await pool.query(`SELECT id FROM ${table}`)).rows.map((r) => String(r.id)),
  });

  if (wants('runs')) {
    await runBackfill({
      collection: mdb.collection('classification_runs'),
      build: buildRun,
      validate: (row) => validateRun(row, refs),
      insert: (row) => insertRow(pool, 'classifier.runs', RUN_COLUMNS, row),
      ...common('classifier.runs', RUN_COLUMNS),
    });
  }

  if (wants('folders')) {
    const plan = new FolderPlan((await mdb.collection('classifier_folders').find({}).toArray()) as MongoDoc[], refs);
    await runBackfill({
      collection: mdb.collection('classifier_folders'),
      build: buildFolder,
      validate: plan.validate,
      insert: (row) => plan.insert(pool, row),
      ...common('classifier.folders', FOLDER_COLUMNS),
    });
  }

  if (wants('assignments')) {
    const existingFolders = await idSet('SELECT id FROM classifier.folders');
    const existingRuns = await idSet('SELECT id FROM classifier.runs');
    await runBackfill({
      collection: mdb.collection('classifier_file_assignments'),
      build: buildAssignment,
      validate: (row) => validateAssignment(row, refs),
      insert: (row) => insertAssignment(pool, row, existingFolders, existingRuns),
      ...common('classifier.file_assignments', ASSIGNMENT_COLUMNS),
    });
  }

  if (wants('rules')) {
    await runBackfill({
      collection: mdb.collection('classifier_rules'),
      build: buildRule,
      validate: (row) => validateRule(row, refs),
      insert: (row) => insertRow(pool, 'classifier.rules', RULE_COLUMNS, row),
      ...common('classifier.rules', RULE_COLUMNS),
    });
  }

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
