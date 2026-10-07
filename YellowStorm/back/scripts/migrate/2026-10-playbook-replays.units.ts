/**
 * Mongo → Postgres mapping of the replay baselines, replay run reports and evaluations (roadmap P5,
 * package D): playbook_flow_validated_replays → playbook.validated_replays, playbook_flow_replay_run_reports
 * → playbook.replay_run_reports, playbook_flow_evaluation_baselines → playbook.evaluation_baselines and
 * playbook_flow_evaluation_executions → playbook.evaluation_executions. Kept apart from the runner so a
 * spec can drive the same mapping, validation and insert with fabricated documents (the dev data has no
 * evaluations at all).
 *
 * A unit is one Postgres row keyed by the Postgres column names; `columns` is both the insert list and
 * the checksum read-back list. The replay and report tables promote what the services filter on to
 * columns and keep the rest of the document, as stored, in `doc`.
 */
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

/** Flow ids present in Postgres: the foreign keys reject a row whose flow is gone. */
export interface PlaybookReplayRefs {
  flows: ReadonlySet<string>;
}

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

const HEX = /^[0-9a-f]{24}$/i;
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const dNow = (v: unknown): Date => d(v) ?? new Date();
const s = (v: unknown): string | null => (v == null ? null : stripNul(String(v)));
const sReq = (v: unknown): string => stripNul(String(v ?? ''));
const sDefault = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? stripNul(v) : fallback);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
/** Plain JSON, as jsonb will hold it: Dates become ISO strings, ObjectIds hex strings, U+0000 is stripped. */
const plainJson = <T>(v: T): T => stripNul(JSON.parse(JSON.stringify(v ?? null))) as T;
const jsonArray = (v: unknown): unknown[] => (Array.isArray(v) ? plainJson(v) : []);
const jsonObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? plainJson(v as Record<string, unknown>) : {});
const hexId = (v: unknown, label: string, docId: string): string => {
  const raw = v == null ? '' : String(v).toLowerCase();
  if (!HEX.test(raw)) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return raw;
};
/** A soft reference (a run or user that may be gone): kept as stored, lower-cased when it is an ObjectId. */
const softRef = (v: unknown): string => {
  const raw = sReq(v);
  return HEX.test(raw) ? raw.toLowerCase() : raw;
};
const softRefOrNull = (v: unknown): string | null => (v == null || v === '' ? null : softRef(v));

const stamps = (doc: MongoDoc) => ({ created_at: dNow(doc.createdAt), updated_at: dNow(doc.updatedAt) });
const idOf = (doc: MongoDoc): string => hexId(doc._id, '_id', String(doc._id));

/** The document minus its id, version key, timestamps and the promoted fields: what goes to `doc`. */
const rest = (doc: MongoDoc, promoted: readonly string[]): Record<string, unknown> => {
  const skip = new Set(['_id', '__v', 'createdAt', 'updatedAt', ...promoted]);
  return plainJson(Object.fromEntries(Object.entries(doc).filter(([key, value]) => !skip.has(key) && value !== undefined)));
};

const oneOf = (value: unknown, allowed: readonly string[], label: string): string | null =>
  allowed.includes(String(value)) ? null : `${label} '${value}' is not one of ${allowed.join('|')}`;
const oneOfOrNull = (value: unknown, allowed: readonly string[], label: string): string | null => (value === null ? null : oneOf(value, allowed, label));
const firstReason = (...reasons: Array<string | null>): string | null => reasons.find((r) => r !== null) ?? null;
const flowGone = (row: Row, refs: PlaybookReplayRefs): string | null =>
  refs.flows.has(String(row.flow_id)) ? null : `dangling flow_id ${row.flow_id} (flow gone from PG; FK would reject)`;

export const REPLAY_STATUSES = ['active', 'inactive', 'archived'] as const;
/** `strict_replay` is the legacy spelling of replay_strict: kept as stored, the services normalise it. */
export const REPLAY_MODES = ['replay_strict', 'replay_flex', 'replay_adaptive', 'strict_replay'] as const;
export const REPORT_VERDICTS = ['pass', 'warning', 'fail', 'unknown'] as const;
export const BASELINE_SOURCE_MODES = ['selected_execution', 'current_inputs'] as const;
export const EVALUATION_MODES = ['semantic', 'reference', 'hybrid'] as const;
export const EVALUATION_STATUSES = ['running', 'completed', 'failed'] as const;
export const EVALUATION_VERDICTS = ['pass', 'warning', 'fail'] as const;

// ---------------------------------------------------------------- columns

export const REPLAY_COLUMNS = [
  'id', 'flow_id', 'task_id', 'iteration', 'task_title', 'created_by', 'reference_execution_id', 'reference_execution_number', 'validation_version',
  'status', 'mode', 'is_stale', 'label', 'doc', 'created_at', 'updated_at',
];
export const REPORT_COLUMNS = [
  'id', 'execution_id', 'flow_id', 'task_id', 'iteration', 'replay_id', 'validation_version', 'mode', 'verdict', 'overall_score', 'doc', 'created_at', 'updated_at',
];
export const BASELINE_COLUMNS = [
  'id', 'flow_id', 'task_id', 'iteration', 'source_execution_id', 'source_mode', 'input_snapshots', 'created_by_user_id', 'replaced_at', 'created_at', 'updated_at',
];
export const EVALUATION_COLUMNS = [
  'id', 'flow_id', 'execution_id', 'task_id', 'iteration', 'task_title', 'baseline_id', 'mode', 'status', 'score', 'verdict', 'semantic_score', 'reference_score',
  'artifact_score', 'format_score', 'evidence_score', 'execution_health_score', 'expectation', 'rubric_version', 'judge_model', 'summary', 'findings', 'metrics',
  'started_at', 'completed_at', 'error', 'created_at', 'updated_at',
];

/** Columns written as jsonb: an array must be stringified, or the driver sends it as a Postgres array. */
const JSON_COLUMNS = new Set(['doc', 'input_snapshots', 'findings', 'metrics']);

// ---------------------------------------------------------------- validated replays

const REPLAY_PROMOTED = [
  'flowId', 'taskId', 'iteration', 'taskTitle', 'createdBy', 'referenceExecutionId', 'referenceExecutionNumber', 'validationVersion', 'status', 'mode', 'isStale', 'label',
];

/**
 * A validated replay row. `reference_execution_id` is a soft reference (a baseline outlives its run);
 * the template body (tool calls, reasoning outline, fingerprints, ...) goes to `doc` as stored.
 */
export const buildReplay = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    flow_id: hexId(doc.flowId, 'flowId', id),
    task_id: sReq(doc.taskId),
    iteration: int(doc.iteration) ?? 0,
    task_title: sReq(doc.taskTitle),
    created_by: softRef(doc.createdBy),
    reference_execution_id: softRef(doc.referenceExecutionId),
    reference_execution_number: int(doc.referenceExecutionNumber) ?? 1,
    validation_version: int(doc.validationVersion) ?? 1,
    status: sDefault(doc.status, 'active'),
    mode: sDefault(doc.mode, 'replay_strict'),
    is_stale: bool(doc.isStale, false),
    label: s(doc.label),
    doc: rest(doc, REPLAY_PROMOTED),
    ...stamps(doc),
  };
};

export const validateReplay = (row: Row, refs: PlaybookReplayRefs): string | null =>
  firstReason(
    flowGone(row, refs),
    String(row.task_id) === '' ? 'task_id is empty' : null,
    oneOf(row.status, REPLAY_STATUSES, 'status'),
    oneOf(row.mode, REPLAY_MODES, 'mode'),
  );

// ---------------------------------------------------------------- replay run reports

const REPORT_PROMOTED = ['executionId', 'flowId', 'taskId', 'iteration', 'replayId', 'validationVersion', 'mode', 'verdict', 'overallScore'];

/**
 * A replay run report row. `execution_id` and `replay_id` are soft references. The removed eligibility
 * gate's `skipped` verdict becomes `unknown`, which is what every read of it already returned; its other
 * legacy fields stay in `doc` (the service strips them on read).
 */
export const buildReport = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    execution_id: softRef(doc.executionId),
    flow_id: hexId(doc.flowId, 'flowId', id),
    task_id: sReq(doc.taskId),
    iteration: int(doc.iteration) ?? 0,
    replay_id: softRef(doc.replayId),
    validation_version: int(doc.validationVersion) ?? 0,
    mode: sReq(doc.mode),
    verdict: doc.verdict === 'skipped' ? 'unknown' : s(doc.verdict),
    overall_score: num(doc.overallScore),
    doc: rest(doc, REPORT_PROMOTED),
    ...stamps(doc),
  };
};

export const validateReport = (row: Row, refs: PlaybookReplayRefs): string | null =>
  firstReason(
    flowGone(row, refs),
    String(row.task_id) === '' ? 'task_id is empty' : null,
    String(row.mode) === '' ? 'mode is empty' : null,
    oneOfOrNull(row.verdict, REPORT_VERDICTS, 'verdict'),
  );

// ---------------------------------------------------------------- evaluation baselines

export const buildBaseline = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    flow_id: hexId(doc.flowId, 'flowId', id),
    task_id: sReq(doc.taskId),
    iteration: int(doc.iteration) ?? 0,
    source_execution_id: softRef(doc.sourceExecutionId),
    source_mode: sReq(doc.sourceMode),
    input_snapshots: jsonArray(doc.inputSnapshots),
    created_by_user_id: softRef(doc.createdByUserId),
    replaced_at: d(doc.replacedAt),
    ...stamps(doc),
  };
};

export const validateBaseline = (row: Row, refs: PlaybookReplayRefs): string | null =>
  firstReason(flowGone(row, refs), oneOf(row.source_mode, BASELINE_SOURCE_MODES, 'source_mode'));

// ---------------------------------------------------------------- evaluation executions

export const buildEvaluation = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    flow_id: hexId(doc.flowId, 'flowId', id),
    execution_id: softRef(doc.executionId),
    task_id: sReq(doc.taskId),
    iteration: int(doc.iteration) ?? 0,
    task_title: sReq(doc.taskTitle),
    baseline_id: softRefOrNull(doc.baselineId),
    mode: sReq(doc.mode),
    status: sDefault(doc.status, 'completed'),
    score: num(doc.score),
    verdict: s(doc.verdict),
    semantic_score: num(doc.semanticScore),
    reference_score: num(doc.referenceScore),
    artifact_score: num(doc.artifactScore),
    format_score: num(doc.formatScore),
    evidence_score: num(doc.evidenceScore),
    execution_health_score: num(doc.executionHealthScore),
    expectation: typeof doc.expectation === 'string' ? stripNul(doc.expectation) : '',
    rubric_version: sDefault(doc.rubricVersion, 'evaluation-node-v1'),
    judge_model: s(doc.judgeModel),
    summary: s(doc.summary),
    findings: jsonArray(doc.findings),
    metrics: jsonObject(doc.metrics),
    started_at: d(doc.startedAt),
    completed_at: d(doc.completedAt),
    error: s(doc.error),
    ...stamps(doc),
  };
};

export const validateEvaluation = (row: Row, refs: PlaybookReplayRefs): string | null =>
  firstReason(
    flowGone(row, refs),
    oneOf(row.mode, EVALUATION_MODES, 'mode'),
    oneOf(row.status, EVALUATION_STATUSES, 'status'),
    oneOfOrNull(row.verdict, EVALUATION_VERDICTS, 'verdict'),
  );

// ---------------------------------------------------------------- insert

/**
 * INSERT ... ON CONFLICT (id) DO NOTHING. jsonb columns are stringified here so the unit keeps the plain
 * value the checksum compares. Another unique index (two replays with the same version of a task) is not
 * swallowed: the violation is recorded as a failure of that row.
 */
export async function insertRow(pool: Queryable, table: string, columns: string[], row: Row): Promise<void> {
  await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    columns.map((c) => (JSON_COLUMNS.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c])),
  );
}

/** SELECT list for the checksum read-back (every numeric column here is double precision, read as a number). */
export const checksumSelect = (columns: string[]): string => columns.join(', ');
