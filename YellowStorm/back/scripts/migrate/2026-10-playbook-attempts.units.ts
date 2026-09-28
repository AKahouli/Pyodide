/**
 * Mongo → Postgres mapping of the dynamic-reasoning attempts (roadmap P5):
 * playbook_flow_dynamic_reasoning_attempts → playbook.dynamic_reasoning_attempts.
 * Kept apart from the runner so a spec can drive the same mapping, validation and insert with
 * fabricated documents.
 *
 * A unit is one Postgres row keyed by the Postgres column names; `ATTEMPT_COLUMNS` is both the insert
 * list and the checksum read-back list.
 *
 *   - `execution_id` is a foreign key (the run owns its attempts): an attempt whose execution is not in
 *     Postgres (deleted in Mongo, or dropped with a flow that is gone) is reported, never inserted.
 *   - `flow_id` is a plain column without a foreign key: kept as is even when the flow is gone.
 *   - The document-shaped fields (`revisions` included) become jsonb as JSON: dates as ISO strings.
 */
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

/** Execution ids present in Postgres (plus those an earlier pass of the same run accepted). */
export interface AttemptRefs {
  executions: ReadonlySet<string>;
}

export const ATTEMPT_TABLE = 'playbook.dynamic_reasoning_attempts';
export const ATTEMPT_COLLECTION = 'playbook_flow_dynamic_reasoning_attempts';

export const ATTEMPT_COLUMNS = [
  'id', 'execution_id', 'flow_id', 'parent_task_id', 'parent_iteration', 'attempt', 'subgraph_id', 'status', 'task_fingerprint',
  'context_fingerprint', 'input_context_summary', 'policy_snapshot', 'planner_snapshot', 'decision', 'revisions', 'accepted_revision',
  'accepted_plan', 'fallback_reason', 'error', 'planning_started_at', 'accepted_at', 'completed_at', 'created_at', 'updated_at',
];

/** Columns written as jsonb: stringified on insert, or the driver sends an array as a Postgres array. */
const JSON_COLUMNS = new Set(['input_context_summary', 'policy_snapshot', 'planner_snapshot', 'decision', 'revisions', 'accepted_plan', 'error']);

export const ATTEMPT_STATUSES = ['planning', 'direct', 'running', 'completed', 'failed'];

const HEX = /^[0-9a-f]{24}$/;
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const s = (v: unknown): string | null => (v == null ? null : stripNul(String(v)));
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const hexId = (v: unknown, label: string, docId: string): string => {
  const raw = v == null ? '' : String(v).toLowerCase();
  if (!HEX.test(raw)) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return raw;
};
/** A Mixed value as jsonb keeps it: plain JSON (dates as ISO strings, ObjectIds as hex), no U+0000. */
const json = (v: unknown): unknown => (v == null ? null : stripNul(JSON.parse(JSON.stringify(v)) as unknown));

export const buildAttempt = (doc: MongoDoc): Row => {
  const id = hexId(doc._id, '_id', String(doc._id));
  const now = new Date();
  return {
    id,
    execution_id: hexId(doc.executionId, 'executionId', id),
    flow_id: hexId(doc.flowId, 'flowId', id),
    parent_task_id: stripNul(String(doc.parentTaskId ?? '')),
    parent_iteration: int(doc.parentIteration) ?? 0,
    attempt: int(doc.attempt) ?? 0,
    subgraph_id: s(doc.subgraphId),
    status: typeof doc.status === 'string' && doc.status !== '' ? doc.status : 'planning',
    task_fingerprint: s(doc.taskFingerprint),
    context_fingerprint: s(doc.contextFingerprint),
    input_context_summary: json(doc.inputContextSummary),
    policy_snapshot: json(doc.policySnapshot),
    planner_snapshot: json(doc.plannerSnapshot),
    decision: json(doc.decision),
    revisions: Array.isArray(doc.revisions) ? json(doc.revisions) : [],
    accepted_revision: int(doc.acceptedRevision),
    accepted_plan: json(doc.acceptedPlan),
    fallback_reason: s(doc.fallbackReason),
    error: json(doc.error),
    planning_started_at: d(doc.planningStartedAt),
    accepted_at: d(doc.acceptedAt),
    completed_at: d(doc.completedAt),
    created_at: d(doc.createdAt) ?? now,
    updated_at: d(doc.updatedAt) ?? d(doc.createdAt) ?? now,
  };
};

export const validateAttempt = (row: Row, refs: AttemptRefs): string | null => {
  if (!refs.executions.has(String(row.execution_id))) {
    return `dangling execution_id ${row.execution_id} (execution gone from PG; FK would reject)`;
  }
  if (!ATTEMPT_STATUSES.includes(String(row.status))) return `status '${row.status}' is not one of ${ATTEMPT_STATUSES.join('|')}`;
  if (!row.parent_task_id) return 'parentTaskId is empty';
  return null;
};

/**
 * INSERT ... ON CONFLICT (id) DO NOTHING: a re-run inserts nothing. An attempt that clashes with
 * another on (execution, parent task, iteration, attempt) or on its subgraph id is a unique
 * violation, recorded as a failure of that row.
 */
export async function insertAttempt(pool: Queryable, row: Row): Promise<void> {
  await pool.query(
    `INSERT INTO ${ATTEMPT_TABLE} (${ATTEMPT_COLUMNS.join(', ')}) VALUES (${ATTEMPT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    ATTEMPT_COLUMNS.map((c) => (JSON_COLUMNS.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c])),
  );
}
