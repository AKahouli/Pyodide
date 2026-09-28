/**
 * P7 backfill — Mongo worky_* collections → Postgres worky.* tables.
 *
 * The mapping lives in 2026-10-worky.units.ts. Ids are preserved (lower-cased ObjectId hex).
 * Passes run in dependency order (policies, streams and their shares, tasks, plan deltas, messages,
 * everything that hangs off a stream or a task). Each pass loads the ids already in Postgres, plus
 * the ids the earlier passes accepted, so a --dry-run of a child sees its parents.
 *
 *   - rows whose stream, task or user is gone are reported as failures (the foreign keys would
 *     reject them), never silently dropped;
 *   - rows whose stream id was stored as a string were never matched by any query (the Electric
 *     consumer wrote them before it converted ids): reported and skipped;
 *   - a soft reference to a task, message, delta, worker, proposal or user that is gone is nulled,
 *     which is what the ON DELETE SET NULL keys do.
 * Not migrated (no code reads or writes them any more): worky_idempotency_records,
 * worky_execution_snapshots, worky_whatsapp_integrations, worky_whatsapp_system_bot.
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * Stop the Electric consumers (every backend instance) before the final run and start them again
 * after the cutover: the copied cursors let them resume where the Mongo-backed ones stopped.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-worky.ts [--dry-run] [--verify] [--checksum] [--only=<pass>]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';
import * as u from './2026-10-worky.units';
import type { Row, WorkyRefs } from './2026-10-worky.units';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface Pass {
  key: string;
  collection: string;
  table: string;
  columns: string[];
  build: (doc: MongoDoc) => Row;
  validate?: (row: Row, refs: WorkyRefs) => string | null;
  /** Soft references nulled when their target is gone. */
  fixup?: (row: Row, refs: WorkyRefs) => Row;
  insert?: (pool: Pool, row: Row, refs: WorkyRefs) => Promise<void>;
  /** The reference set this pass feeds. */
  provides?: keyof WorkyRefs;
  primaryKey?: string;
}

const PASSES: Pass[] = [
  { key: 'policies', collection: 'worky_governance_policies', table: 'worky.governance_policies', columns: u.POLICY_COLUMNS, build: u.buildPolicy, validate: (row) => u.validatePolicy(row), provides: 'policies' },
  { key: 'streams', collection: 'worky_streams', table: 'worky.streams', columns: u.STREAM_COLUMNS, build: u.buildStream, validate: u.validateStream, insert: (pool, row, refs) => u.insertStream(pool, row, refs), provides: 'streams' },
  { key: 'tasks', collection: 'worky_tasks', table: 'worky.tasks', columns: u.TASK_COLUMNS, build: u.buildTask, validate: u.validateTask, fixup: (row, refs) => (row.assignee_id !== null && !refs.users.has(String(row.assignee_id)) ? { ...row, assignee_id: null } : row), provides: 'tasks' },
  { key: 'deltas', collection: 'worky_plan_deltas', table: 'worky.plan_deltas', columns: u.DELTA_COLUMNS, build: u.buildDelta, validate: u.validateDelta, provides: 'deltas' },
  { key: 'messages', collection: 'worky_messages', table: 'worky.messages', columns: u.MESSAGE_COLUMNS, build: u.buildMessage, validate: u.validateMessage, fixup: u.withLiveDelta, provides: 'messages' },
  { key: 'versions', collection: 'worky_plan_versions', table: 'worky.plan_versions', columns: u.VERSION_COLUMNS, build: u.buildVersion, validate: u.validateVersion, fixup: u.withLiveMessage },
  { key: 'projections', collection: 'worky_plan_projections', table: 'worky.plan_projections', columns: u.PROJECTION_COLUMNS, build: u.buildProjection, validate: u.validateInStream },
  { key: 'message_components', collection: 'worky_message_components', table: 'worky.message_components', columns: u.MESSAGE_COMPONENT_COLUMNS, build: u.buildMessageComponent, validate: u.validateInStream },
  { key: 'step_components', collection: 'worky_plan_step_components', table: 'worky.plan_step_components', columns: u.STEP_COMPONENT_COLUMNS, build: u.buildStepComponent, validate: u.validateInStream },
  { key: 'step_artifacts', collection: 'worky_plan_step_artifacts', table: 'worky.plan_step_artifacts', columns: u.STEP_ARTIFACT_COLUMNS, build: u.buildStepArtifact, validate: u.validateInStream },
  { key: 'interactions', collection: 'worky_interactions', table: 'worky.interactions', columns: u.INTERACTION_COLUMNS, build: u.buildInteraction, validate: u.validateInteraction, fixup: u.withLiveInteractionRefs },
  { key: 'workers', collection: 'worky_ephemeral_workers', table: 'worky.ephemeral_workers', columns: u.WORKER_COLUMNS, build: u.buildWorker, validate: u.validateWorker, provides: 'workers' },
  { key: 'results', collection: 'worky_task_results', table: 'worky.task_results', columns: u.RESULT_COLUMNS, build: u.buildResult, validate: u.validateResult, fixup: u.withLiveWorker },
  { key: 'traces', collection: 'worky_traces', table: 'worky.traces', columns: u.TRACE_COLUMNS, build: u.buildTrace, validate: u.validateTrace },
  { key: 'reservations', collection: 'worky_budget_reservations', table: 'worky.budget_reservations', columns: u.RESERVATION_COLUMNS, build: u.buildReservation, validate: u.validateReservation },
  { key: 'cost_events', collection: 'worky_cost_events', table: 'worky.cost_events', columns: u.COST_COLUMNS, build: u.buildCostEvent, validate: u.validateCostEvent, fixup: u.withLiveTask },
  { key: 'ledger', collection: 'worky_mail_event_ledger', table: 'worky.mail_event_ledger', columns: u.LEDGER_COLUMNS, build: u.buildLedger, validate: u.validateInStream, fixup: u.withLiveTask },
  { key: 'scheduled', collection: 'worky_scheduled_events', table: 'worky.scheduled_events', columns: u.SCHEDULED_COLUMNS, build: u.buildScheduled, validate: u.validateScheduled, fixup: u.withLiveTask },
  { key: 'reports', collection: 'worky_execution_reports', table: 'worky.execution_reports', columns: u.REPORT_COLUMNS, build: u.buildReport, validate: u.validateReport },
  { key: 'audit', collection: 'worky_audit_events', table: 'worky.audit_events', columns: u.AUDIT_COLUMNS, build: u.buildAudit },
  { key: 'proposals', collection: 'worky_memory_proposals', table: 'worky.memory_proposals', columns: u.PROPOSAL_COLUMNS, build: u.buildProposal, validate: u.validateProposal, fixup: u.withLiveMemorySources, provides: 'proposals' },
  { key: 'entries', collection: 'worky_memory_entries', table: 'worky.memory_entries', columns: u.ENTRY_COLUMNS, build: u.buildEntry, validate: u.validateEntry, fixup: u.withLiveMemorySources },
  { key: 'subscriptions', collection: 'worky_mail_subscriptions', table: 'worky.mail_subscriptions', columns: u.SUBSCRIPTION_COLUMNS, build: u.buildSubscription, validate: u.validateSubscription },
  { key: 'cursors', collection: 'worky_electric_cursors', table: 'worky.electric_cursors', columns: u.CURSOR_COLUMNS, build: u.buildCursor, primaryKey: 'shape' },
];

const NOT_MIGRATED = ['worky_idempotency_records', 'worky_execution_snapshots', 'worky_whatsapp_integrations', 'worky_whatsapp_system_bot'];

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
  /** Ids accepted by earlier passes: a dry-run writes nothing, but its children still need their parents. */
  const accepted: Record<keyof WorkyRefs, Set<string>> = {
    users: new Set(), streams: new Set(), tasks: new Set(), messages: new Set(), deltas: new Set(), policies: new Set(), workers: new Set(), proposals: new Set(),
  };
  const loadRefs = async (): Promise<WorkyRefs> => {
    const [users, streams, tasks, messages, deltas, policies, workers, proposals] = await Promise.all([
      idSet('SELECT id FROM identity.users'),
      idSet('SELECT id FROM worky.streams'),
      idSet('SELECT id FROM worky.tasks'),
      idSet('SELECT id FROM worky.messages'),
      idSet('SELECT id FROM worky.plan_deltas'),
      idSet('SELECT id FROM worky.governance_policies'),
      idSet('SELECT id FROM worky.ephemeral_workers'),
      idSet('SELECT id FROM worky.memory_proposals'),
    ]);
    const merge = (pg: Set<string>, key: keyof WorkyRefs): Set<string> => new Set([...pg, ...accepted[key]]);
    return {
      users,
      streams: merge(streams, 'streams'),
      tasks: merge(tasks, 'tasks'),
      messages: merge(messages, 'messages'),
      deltas: merge(deltas, 'deltas'),
      policies: merge(policies, 'policies'),
      workers: merge(workers, 'workers'),
      proposals: merge(proposals, 'proposals'),
    };
  };

  for (const pass of PASSES) {
    if (only && only !== pass.key) continue;
    const refs = await loadRefs();
    console.log(`\n##### ${pass.key}: ${pass.collection} → ${pass.table}`);
    const key = pass.primaryKey ?? 'id';
    const keyCast = key === 'id' ? 'char(24)[]' : 'text[]';
    await runBackfill({
      collection: mdb.collection(pass.collection),
      build: pass.build,
      validate: (row) => {
        const reason = pass.validate?.(row, refs) ?? null;
        if (!reason && pass.provides) accepted[pass.provides].add(String(row[key]));
        return reason;
      },
      insert: async (row) => {
        const fixed = pass.fixup ? pass.fixup(row, refs) : row;
        if (pass.insert) await pass.insert(pool, fixed, refs);
        else await u.insertRow(pool, pass.table, pass.columns, fixed, key);
      },
      unitId: (row) => String(row[key]),
      exists: async (id) => (await pool.query(`SELECT 1 FROM ${pass.table} WHERE ${key} = $1`, [id])).rowCount! > 0,
      verify: async (rows) => {
        const issues = new Map<string, string>();
        for (const row of rows) {
          if ((await pool.query(`SELECT 1 FROM ${pass.table} WHERE ${key} = $1`, [row[key]])).rowCount === 0) issues.set(String(row[key]), 'missing in PG');
        }
        return issues;
      },
      checksumRows: async (ids) =>
        new Map((await pool.query(`SELECT ${u.checksumSelect(pass.columns)} FROM ${pass.table} WHERE ${key} = ANY($1::${keyCast})`, [ids])).rows.map((r) => [String(r[key]), r as Row])),
      pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${pass.table}`)).rows[0].n,
      pgIds: async () => (await pool.query(`SELECT ${key} AS id FROM ${pass.table}`)).rows.map((r) => String(r.id)),
    });

    if (pass.key === 'streams') {
      const mongoShares = (await mdb.collection('worky_streams').aggregate([{ $group: { _id: null, n: { $sum: { $size: { $ifNull: ['$shares', []] } } } } }]).toArray())[0]?.n ?? 0;
      const pgShares = (await pool.query('SELECT count(*)::int AS n FROM worky.stream_shares')).rows[0].n;
      console.log(`=== shares === mongo ${mongoShares} embedded, postgres ${pgShares} rows`);
    }
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
