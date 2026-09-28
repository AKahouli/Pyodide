/**
 * P5 backfill — Mongo flowexecutions, flowtaskresults and flowrouterdecisions → Postgres
 * playbook.executions, playbook.task_results and playbook.router_decisions.
 *
 * The mapping lives in 2026-10-playbook-executions.units.ts. Ids are preserved (lower-cased ObjectId
 * hex). Runs after the flows pass and before the passes of the other execution satellites (attempts,
 * idempotency). Passes run in order: executions, then task results and router decisions; each loads
 * the parent ids already in Postgres plus those the executions pass accepted, so a --dry-run of a child
 * sees its parents.
 *
 *   - a run of a flow that no longer exists (635 in dev: the Mongo flow delete kept its runs), of a user
 *     who is gone, and a task result or decision of a run that is not migrated, are reported as
 *     failures with the reason, never inserted;
 *   - task results are streamed one document at a time: their document columns never outlive the
 *     insert of that row, and --checksum compares them through a per-row sha256.
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-playbook-executions.ts [--dry-run] [--verify] [--checksum] [--only=<pass>]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';
import * as u from './2026-10-playbook-executions.units';
import type { Row } from './2026-10-playbook-executions.units';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

/** Ids per checksum query for task results: the rows are read with their document columns. */
const TASK_RESULT_CHECKSUM_CHUNK = 10;

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

  const idSet = async (sql: string): Promise<Set<string>> => new Set((await pool.query(sql)).rows.map((r) => String(r.id)));
  const exists = (table: string) => async (id: string): Promise<boolean> => (await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount! > 0;
  const verifyPresent = (table: string, parentOk: (row: Row) => boolean) => async (rows: Row[]): Promise<Map<string, string>> => {
    const issues = new Map<string, string>();
    for (const row of rows) {
      if (!parentOk(row)) continue; // reported as a failure by the main pass
      if ((await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [row.id])).rowCount === 0) issues.set(String(row.id), 'missing in PG');
    }
    return issues;
  };
  const counts = (table: string) => ({
    pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number,
    pgIds: async () => (await pool.query(`SELECT id FROM ${table}`)).rows.map((r) => String(r.id)),
  });

  /** Runs the executions pass accepted: a dry-run writes nothing, but its children still need their parents. */
  const acceptedExecutions = new Set<string>();

  if (!only || only === 'executions') {
    const refs: u.ExecutionRefs = {
      users: await idSet('SELECT id FROM identity.users'),
      flows: await idSet('SELECT id FROM playbook.flows'),
      executions: new Set(),
    };
    console.log(`\n##### executions: ${u.EXECUTION_COLLECTION} → ${u.EXECUTION_TABLE} (${refs.flows.size} flows in PG)`);
    await runBackfill({
      collection: mdb.collection(u.EXECUTION_COLLECTION),
      build: u.buildExecution,
      validate: (row: Row) => {
        const reason = u.validateExecution(row, refs);
        if (!reason) acceptedExecutions.add(String(row.id));
        return reason;
      },
      unitId: (row: Row) => String(row.id),
      exists: exists(u.EXECUTION_TABLE),
      insert: (row) => u.insertExecution(pool, row),
      verify: verifyPresent(u.EXECUTION_TABLE, (row) => u.validateExecution(row, refs) === null),
      checksumRows: async (ids) =>
        new Map((await pool.query(`SELECT ${u.EXECUTION_COLUMNS.join(', ')} FROM ${u.EXECUTION_TABLE} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
      ...counts(u.EXECUTION_TABLE),
    });
  }

  const executionRefs = async (): Promise<Pick<u.ExecutionRefs, 'executions'>> => ({
    executions: new Set([...(await idSet(`SELECT id FROM ${u.EXECUTION_TABLE}`)), ...acceptedExecutions]),
  });

  if (!only || only === 'task_results') {
    const refs = await executionRefs();
    console.log(`\n##### task_results: ${u.TASK_RESULT_COLLECTION} → ${u.TASK_RESULT_TABLE} (${refs.executions.size} runs)`);
    // The document being processed: the harness handles one document at a time (build, validate, insert).
    let inFlight: { id: string; heavy: Row } | null = null;
    await runBackfill({
      collection: mdb.collection(u.TASK_RESULT_COLLECTION),
      build: (doc: MongoDoc) => {
        const { row, heavy } = u.buildTaskResult(doc);
        inFlight = { id: String(row.id), heavy };
        return row;
      },
      validate: (row: Row) => u.validateTaskResult(row, refs),
      unitId: (row: Row) => String(row.id),
      exists: exists(u.TASK_RESULT_TABLE),
      insert: async (row) => {
        const current = inFlight;
        if (!current || current.id !== row.id) throw new Error('task result document columns are not in flight');
        inFlight = null;
        await u.insertTaskResult(pool, row, current.heavy);
      },
      verify: verifyPresent(u.TASK_RESULT_TABLE, (row) => refs.executions.has(String(row.execution_id))),
      checksumRows: async (ids) => {
        const rows = new Map<string, Row>();
        for (let i = 0; i < ids.length; i += TASK_RESULT_CHECKSUM_CHUNK) {
          const chunk = await pool.query(
            `SELECT ${u.TASK_RESULT_CHECKSUM_SELECT} FROM ${u.TASK_RESULT_TABLE} WHERE id = ANY($1::char(24)[])`,
            [ids.slice(i, i + TASK_RESULT_CHECKSUM_CHUNK)],
          );
          for (const r of chunk.rows) rows.set(String(r.id), u.taskResultChecksumRow(r as Row));
        }
        return rows;
      },
      ...counts(u.TASK_RESULT_TABLE),
    });
  }

  if (!only || only === 'router_decisions') {
    const refs = await executionRefs();
    console.log(`\n##### router_decisions: ${u.ROUTER_DECISION_COLLECTION} → ${u.ROUTER_DECISION_TABLE} (${refs.executions.size} runs)`);
    await runBackfill({
      collection: mdb.collection(u.ROUTER_DECISION_COLLECTION),
      build: u.buildRouterDecision,
      validate: (row: Row) => u.validateRouterDecision(row, refs),
      unitId: (row: Row) => String(row.id),
      exists: exists(u.ROUTER_DECISION_TABLE),
      insert: (row) => u.insertRouterDecision(pool, row),
      verify: verifyPresent(u.ROUTER_DECISION_TABLE, (row) => refs.executions.has(String(row.execution_id))),
      checksumRows: async (ids) =>
        new Map((await pool.query(`SELECT ${u.ROUTER_DECISION_COLUMNS.join(', ')} FROM ${u.ROUTER_DECISION_TABLE} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
      ...counts(u.ROUTER_DECISION_TABLE),
    });
  }

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
