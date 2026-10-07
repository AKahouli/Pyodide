/**
 * P6 backfill — Mongo evaluation module → Postgres agent_evaluation schema.
 *
 *   datasets            → agent_evaluation.datasets
 *   scenarios           → agent_evaluation.scenarios
 *   evaluations         → agent_evaluation.evaluations
 *   evaluation_settings → agent_evaluation.settings (singleton)
 *
 * Ids are preserved (lower-cased ObjectId hex). Datasets go first: scenarios and
 * evaluations reference them. Idempotent: ON CONFLICT DO NOTHING on the id.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-agent-evaluation.ts [--dry-run] [--verify] [--checksum] [--only=datasets|scenarios|evaluations|settings]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { stripNul } from '../../src/common/postgres/json';
import { runBackfill, BackfillError, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;

const HEX = /^[0-9a-f]{24}$/;
const RUN_MODES = new Set(['strict', 'non_strict']);
const RUN_STATUSES = new Set(['processing', 'completed', 'failed']);

const s = (v: unknown): string | null => (v == null ? null : String(v));
const d = (v: unknown): Date => {
  const date = v instanceof Date ? v : new Date(String(v ?? ''));
  return Number.isNaN(date.getTime()) ? new Date() : date;
};
const n = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback);

const hexId = (v: unknown, label: string, docId: string): string => {
  const raw = v == null ? '' : String(v).toLowerCase();
  if (!HEX.test(raw)) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return raw;
};
const hexIdOrNull = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const raw = String(v).toLowerCase();
  return HEX.test(raw) ? raw : null;
};

/** Strip BSON / undefined / U+0000 so jsonb accepts the value. */
const jsonSafe = <T>(v: unknown, fallback: T): T => {
  try {
    return stripNul(JSON.parse(JSON.stringify(v ?? fallback)) as T);
  } catch {
    return fallback;
  }
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

  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const run = (unit: string, fn: () => Promise<void>): Promise<void> => (!only || only === unit ? fn() : Promise.resolve());
  const existsIn = (table: string) => async (id: string): Promise<boolean> =>
    (await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount! > 0;
  const idsOf = (table: string) => async (): Promise<string[]> =>
    (await pool.query(`SELECT id FROM ${table}`)).rows.map((r) => String(r.id));
  const countOf = (table: string) => async (): Promise<number> =>
    (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  const byId = (rows: Row[]): Map<string, Record<string, unknown>> => new Map(rows.map((r) => [String(r.id), r]));

  // ---- datasets ----------------------------------------------------------
  await run('datasets', async () => {
    await runBackfill({
      collection: mdb.collection('datasets'),
      build: (doc: MongoDoc): Row => {
        const id = hexId(doc._id, '_id', String(doc._id));
        const rawItems = Array.isArray(doc.items) ? (doc.items as Array<Record<string, unknown>>) : [];
        return {
          id,
          name: String(doc.name ?? '').trim(),
          items: jsonSafe(rawItems.map((i) => ({ question: String(i.question ?? ''), reference_answer: String(i.reference_answer ?? '') })), []),
          created_by: hexId(doc.createdBy, 'createdBy', id),
          workspace_id: hexIdOrNull(doc.workspaceId),
          created_at: d(doc.createdAt),
          updated_at: d(doc.updatedAt),
        };
      },
      validate: (unit) => (unit.name ? null : 'empty name'),
      unitId: (unit) => unit.id as string,
      exists: existsIn('agent_evaluation.datasets'),
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO agent_evaluation.datasets (id, name, items, created_by, workspace_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [unit.id, unit.name, JSON.stringify(unit.items), unit.created_by, unit.workspace_id, unit.created_at, unit.updated_at],
        );
      },
      verify: async (units) => {
        const issues = new Map<string, string>();
        for (const unit of units) {
          const r = await pool.query('SELECT name, created_by FROM agent_evaluation.datasets WHERE id = $1', [unit.id]);
          if (r.rowCount === 0) issues.set(String(unit.id), 'missing in PG');
          else if (r.rows[0].name !== unit.name) issues.set(String(unit.id), 'name mismatch');
        }
        return issues;
      },
      checksumRows: async (ids) =>
        byId((await pool.query(
          `SELECT id, name, items, created_by, workspace_id, created_at, updated_at
           FROM agent_evaluation.datasets WHERE id = ANY($1::char(24)[])`,
          [ids],
        )).rows),
      pgCount: countOf('agent_evaluation.datasets'),
      pgIds: idsOf('agent_evaluation.datasets'),
    });
  });

  // ---- scenarios ---------------------------------------------------------
  await run('scenarios', async () => {
    await runBackfill({
      collection: mdb.collection('scenarios'),
      build: (doc: MongoDoc): Row => {
        const id = hexId(doc._id, '_id', String(doc._id));
        const mode = String(doc.mode ?? 'non_strict');
        if (!RUN_MODES.has(mode)) throw new BackfillError(`invalid mode ${mode}`, id);
        return {
          id,
          name: String(doc.name ?? ''),
          agent_id: hexId(doc.agentId, 'agentId', id),
          dataset_id: hexId(doc.datasetId, 'datasetId', id),
          num_runs: n(doc.numRuns, 1),
          mode,
          created_at: d(doc.createdAt),
          updated_at: d(doc.updatedAt),
        };
      },
      validate: (unit) => (unit.name ? null : 'empty name'),
      unitId: (unit) => unit.id as string,
      exists: existsIn('agent_evaluation.scenarios'),
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO agent_evaluation.scenarios (id, name, agent_id, dataset_id, num_runs, mode, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [unit.id, unit.name, unit.agent_id, unit.dataset_id, unit.num_runs, unit.mode, unit.created_at, unit.updated_at],
        );
      },
      verify: async (units) => {
        const issues = new Map<string, string>();
        for (const unit of units) {
          const r = await pool.query('SELECT agent_id, dataset_id FROM agent_evaluation.scenarios WHERE id = $1', [unit.id]);
          if (r.rowCount === 0) issues.set(String(unit.id), 'missing in PG');
          else if (r.rows[0].agent_id !== unit.agent_id || r.rows[0].dataset_id !== unit.dataset_id) issues.set(String(unit.id), 'reference mismatch');
        }
        return issues;
      },
      checksumRows: async (ids) =>
        byId((await pool.query(
          `SELECT id, name, agent_id, dataset_id, num_runs, mode, created_at, updated_at
           FROM agent_evaluation.scenarios WHERE id = ANY($1::char(24)[])`,
          [ids],
        )).rows),
      pgCount: countOf('agent_evaluation.scenarios'),
      pgIds: idsOf('agent_evaluation.scenarios'),
    });
  });

  // ---- evaluations -------------------------------------------------------
  await run('evaluations', async () => {
    await runBackfill({
      collection: mdb.collection('evaluations'),
      build: (doc: MongoDoc): Row => {
        const id = hexId(doc._id, '_id', String(doc._id));
        const mode = String(doc.mode ?? 'non_strict');
        const status = String(doc.status ?? 'processing');
        if (!RUN_MODES.has(mode)) throw new BackfillError(`invalid mode ${mode}`, id);
        if (!RUN_STATUSES.has(status)) throw new BackfillError(`invalid status ${status}`, id);
        return {
          id,
          agent_id: hexId(doc.agentId, 'agentId', id),
          scenario_name: String(doc.scenarioName ?? ''),
          dataset_id: hexIdOrNull(doc.datasetId),
          mode,
          results: jsonSafe(Array.isArray(doc.results) ? doc.results : [], []),
          // Mongoose defaulted these on read; older documents simply lack them.
          num_runs: n(doc.numRuns, 1),
          completed_runs: n(doc.completedRuns, 0),
          status,
          created_by: hexId(doc.createdBy, 'createdBy', id),
          error: doc.error == null ? null : stripNul(String(doc.error)),
          created_at: d(doc.createdAt),
          updated_at: d(doc.updatedAt),
        };
      },
      validate: (unit) => (unit.scenario_name ? null : 'empty scenarioName'),
      unitId: (unit) => unit.id as string,
      exists: existsIn('agent_evaluation.evaluations'),
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO agent_evaluation.evaluations (
             id, agent_id, scenario_name, dataset_id, mode, results, num_runs, completed_runs,
             status, created_by, error, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.agent_id, unit.scenario_name, unit.dataset_id, unit.mode,
            JSON.stringify(unit.results), unit.num_runs, unit.completed_runs, unit.status,
            unit.created_by, unit.error, unit.created_at, unit.updated_at,
          ],
        );
      },
      verify: async (units) => {
        const issues = new Map<string, string>();
        for (const unit of units) {
          const r = await pool.query(
            'SELECT status, jsonb_array_length(results)::int AS n FROM agent_evaluation.evaluations WHERE id = $1',
            [unit.id],
          );
          if (r.rowCount === 0) issues.set(String(unit.id), 'missing in PG');
          else if (r.rows[0].status !== unit.status) issues.set(String(unit.id), 'status mismatch');
          else if (r.rows[0].n !== (unit.results as unknown[]).length) issues.set(String(unit.id), 'results length mismatch');
        }
        return issues;
      },
      checksumRows: async (ids) =>
        byId((await pool.query(
          `SELECT id, agent_id, scenario_name, dataset_id, mode, results, num_runs, completed_runs,
                  status, created_by, error, created_at, updated_at
           FROM agent_evaluation.evaluations WHERE id = ANY($1::char(24)[])`,
          [ids],
        )).rows),
      pgCount: countOf('agent_evaluation.evaluations'),
      pgIds: idsOf('agent_evaluation.evaluations'),
    });
  });

  // ---- settings (singleton) ---------------------------------------------
  await run('settings', async () => {
    await runBackfill({
      collection: mdb.collection('evaluation_settings'),
      filter: { key: 'global' },
      build: (doc: MongoDoc): Row => ({
        id: hexId(doc._id, '_id', String(doc._id)),
        singleton: true,
        response_reliability: jsonSafe(doc.responseReliability, {}),
        created_at: d(doc.createdAt),
        updated_at: d(doc.updatedAt),
      }),
      unitId: () => 'evaluation_settings_singleton',
      exists: async () => (await pool.query('SELECT 1 FROM agent_evaluation.settings LIMIT 1')).rowCount! > 0,
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO agent_evaluation.settings (id, singleton, response_reliability, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (singleton) DO NOTHING`,
          [unit.id, true, JSON.stringify(unit.response_reliability), unit.created_at, unit.updated_at],
        );
      },
      checksumRows: async () => {
        const r = await pool.query(
          'SELECT id, singleton, response_reliability, created_at, updated_at FROM agent_evaluation.settings LIMIT 1',
        );
        return r.rows.length ? new Map([['evaluation_settings_singleton', r.rows[0] as Row]]) : new Map();
      },
      pgCount: countOf('agent_evaluation.settings'),
    });
  });

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
