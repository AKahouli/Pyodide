/**
 * Mongo → Postgres mapping of the playbook runs (roadmap P5): flowexecutions → playbook.executions,
 * flowtaskresults → playbook.task_results, flowrouterdecisions → playbook.router_decisions.
 * Kept apart from the runner so a spec can drive the same mapping, validation and insert with
 * fabricated documents.
 *
 * A unit is one Postgres row keyed by the Postgres column names; the `*_COLUMNS` lists are both the
 * insert list and the checksum read-back list.
 *
 *   - `flow_id` / `owner_id` of a run and `execution_id` of a task result or router decision are foreign
 *     keys: a row whose parent is not in Postgres (635 dev runs belong to flows deleted without their
 *     runs) is reported as a failure with the reason, never inserted. Mongo stored these ids as
 *     strings; they are compared lower-cased.
 *   - Document-shaped fields become jsonb as JSON (dates as ISO strings, ObjectIds as hex), without
 *     U+0000. `executionMode` null → 'live', `advisorScoringMode` null → 'llm', as the column defaults.
 *   - Task results are big (up to 4.7 MB): their document columns travel beside the unit (see
 *     `buildTaskResult`), and the unit carries their sha256 instead, so a --checksum run never holds
 *     the collection in memory.
 */
import { createHash } from 'node:crypto';
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';
import { stableStringify } from './reconcile';

export type Row = Record<string, unknown>;

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

/** Ids present in Postgres (plus those an earlier pass of the same run accepted). */
export interface ExecutionRefs {
  users: ReadonlySet<string>;
  flows: ReadonlySet<string>;
  executions: ReadonlySet<string>;
}

export const EXECUTION_COLLECTION = 'flowexecutions';
export const EXECUTION_TABLE = 'playbook.executions';
export const TASK_RESULT_COLLECTION = 'flowtaskresults';
export const TASK_RESULT_TABLE = 'playbook.task_results';
export const ROUTER_DECISION_COLLECTION = 'flowrouterdecisions';
export const ROUTER_DECISION_TABLE = 'playbook.router_decisions';

export const EXECUTION_COLUMNS = [
  'id', 'flow_id', 'owner_id', 'schema_version', 'status', 'started_at', 'ended_at', 'error', 'recursion_limit', 'max_parallelism',
  'playbook_execution_settings', 'planner_snapshot', 'input_context', 'snapshot', 'idempotency_key', 'pending_approval', 'hitl_events',
  'queue_position', 'thread_id', 'single_step_task_id', 'advisor_autopilot_enabled', 'advisor_autopilot_target_score',
  'advisor_autopilot_max_turns', 'reflection_enabled', 'advisor_scoring_mode', 'seeded_task_outputs', 'execution_mode',
  'step_execution_modes', 'replay_planning_by_task', 'model_id_override', 'replay_source', 'created_at', 'updated_at',
];
const EXECUTION_JSON_COLUMNS = new Set([
  'playbook_execution_settings', 'planner_snapshot', 'input_context', 'snapshot', 'pending_approval', 'hitl_events', 'seeded_task_outputs',
  'step_execution_modes', 'replay_planning_by_task', 'replay_source',
]);

/** The task-result columns read and compared as they are. */
export const TASK_RESULT_LIGHT_COLUMNS = [
  'id', 'execution_id', 'task_id', 'parent_task_id', 'runtime_subgraph_id', 'generated_local_node_id', 'generated_node_title', 'iteration',
  'status', 'error', 'started_at', 'ended_at', 'judge_status', 'judge_scoring_mode', 'judge_error', 'created_at', 'updated_at',
];
/** The document columns of a task result: inserted from the side payload, compared through `content_sha256`. */
export const TASK_RESULT_HEAVY_COLUMNS = [
  'output', 'display_text', 'outputs', 'artifacts', 'components', 'iterator_iterations', 'tool_trace', 'reasoning_chain', 'llm_prompt_trace',
  'usage', 'semantic_match', 'trace_metadata', 'judge_result', 'judge_history',
];
export const TASK_RESULT_COLUMNS = [...TASK_RESULT_LIGHT_COLUMNS, ...TASK_RESULT_HEAVY_COLUMNS];
const TASK_RESULT_JSON_COLUMNS = new Set(TASK_RESULT_HEAVY_COLUMNS.filter((c) => c !== 'display_text'));

export const ROUTER_DECISION_COLUMNS = ['id', 'execution_id', 'router_node_id', 'iteration', 'label', 'decided_at'];

export const EXECUTION_STATUSES = ['queued', 'running', 'pending_approval', 'completed', 'failed', 'cancelled'];
export const EXECUTION_MODES = ['live', 'inherit', 'replay_strict', 'replay_flex', 'replay_adaptive'];
export const SCORING_MODES = ['llm', 'heuristic'];
export const TASK_RESULT_STATUSES = ['pending', 'running', 'interrupted', 'completed', 'failed', 'skipped', 'cancelled'];
export const JUDGE_STATUSES = ['idle', 'evaluating', 'evaluated', 'failed'];

const HEX = /^[0-9a-f]{24}$/;
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const s = (v: unknown): string | null => (v == null ? null : stripNul(String(v)));
const sDefault = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? stripNul(v) : fallback);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const hexId = (v: unknown, label: string, docId: string): string => {
  const raw = v == null ? '' : String(v).toLowerCase();
  if (!HEX.test(raw)) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return raw;
};
/** A Mixed value as jsonb keeps it: plain JSON (dates as ISO strings, ObjectIds as hex), no U+0000. */
const json = (v: unknown): unknown => (v == null ? null : stripNul(JSON.parse(JSON.stringify(v)) as unknown));
const jsonObject = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? json(v) : null);
const jsonArray = (v: unknown): unknown => (Array.isArray(v) ? json(v) : null);
const idOf = (doc: MongoDoc): string => hexId(doc._id, '_id', String(doc._id));
/** The creation time; the ObjectId's own timestamp when Mongo has none (never "now": re-runs must map identically). */
const createdAt = (doc: MongoDoc): Date => {
  const created = d(doc.createdAt);
  if (created) return created;
  const id = doc._id as { getTimestamp?: () => Date } | undefined;
  return id?.getTimestamp?.() ?? d(doc.updatedAt) ?? new Date(0);
};
const stamps = (doc: MongoDoc) => {
  const created = createdAt(doc);
  return { created_at: created, updated_at: d(doc.updatedAt) ?? created };
};

const oneOf = (value: unknown, allowed: string[], label: string): string | null =>
  allowed.includes(String(value)) ? null : `${label} '${value}' is not one of ${allowed.join('|')}`;
const firstReason = (...reasons: Array<string | null>): string | null => reasons.find((r) => r !== null) ?? null;
const dangling = (set: ReadonlySet<string>, id: unknown, label: string, gone: string): string | null =>
  set.has(String(id)) ? null : `dangling ${label} ${id} (${gone}; FK would reject)`;

/** SHA-256 of the canonical form of the task-result document columns (null columns and keys dropped). */
export const contentSha256 = (heavy: Row): string =>
  createHash('sha256').update(stableStringify(Object.fromEntries(TASK_RESULT_HEAVY_COLUMNS.map((c) => [c, heavy[c]])))).digest('hex');

// ---------------------------------------------------------------- executions

export const buildExecution = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    flow_id: hexId(doc.flowId, 'flowId', id),
    owner_id: hexId(doc.ownerId, 'ownerId', id),
    schema_version: int(doc.schemaVersion) ?? 1,
    status: sDefault(doc.status, 'queued'),
    started_at: d(doc.startedAt),
    ended_at: d(doc.endedAt),
    error: s(doc.error),
    recursion_limit: int(doc.recursionLimit) ?? 25,
    max_parallelism: int(doc.maxParallelism) ?? 5,
    playbook_execution_settings: jsonObject(doc.playbookExecutionSettings),
    planner_snapshot: jsonObject(doc.playbookPlannerSnapshot),
    input_context: jsonObject(doc.inputContext),
    snapshot: jsonObject(doc.snapshot),
    idempotency_key: s(doc.idempotencyKey),
    pending_approval: jsonObject(doc.pendingApproval),
    hitl_events: jsonArray(doc.hitlEvents) ?? [],
    queue_position: int(doc.queuePosition) ?? 0,
    thread_id: s(doc.threadId),
    single_step_task_id: s(doc.singleStepTaskId),
    advisor_autopilot_enabled: bool(doc.advisorAutopilotEnabled, false),
    advisor_autopilot_target_score: num(doc.advisorAutopilotTargetScore),
    advisor_autopilot_max_turns: int(doc.advisorAutopilotMaxTurns),
    reflection_enabled: bool(doc.reflectionEnabled, false),
    advisor_scoring_mode: sDefault(doc.advisorScoringMode, 'llm'),
    seeded_task_outputs: jsonArray(doc.seededTaskOutputs) ?? [],
    execution_mode: sDefault(doc.executionMode, 'live'),
    step_execution_modes: jsonObject(doc.stepExecutionModes) ?? {},
    replay_planning_by_task: jsonObject(doc.replayPlanningByTask) ?? {},
    model_id_override: s(doc.modelIdOverride),
    replay_source: jsonObject(doc.replaySource),
    ...stamps(doc),
  };
};

export const validateExecution = (row: Row, refs: ExecutionRefs): string | null =>
  firstReason(
    dangling(refs.flows, row.flow_id, 'flow_id', 'flow deleted without its runs'),
    dangling(refs.users, row.owner_id, 'owner_id', 'user gone from PG'),
    oneOf(row.status, EXECUTION_STATUSES, 'status'),
    oneOf(row.execution_mode, EXECUTION_MODES, 'execution_mode'),
    oneOf(row.advisor_scoring_mode, SCORING_MODES, 'advisor_scoring_mode'),
  );

// ---------------------------------------------------------------- task results

/**
 * A task result as its light unit (compared column by column, plus `content_sha256`) and the document
 * columns that are inserted beside it.
 */
export const buildTaskResult = (doc: MongoDoc): { row: Row; heavy: Row } => {
  const id = idOf(doc);
  const heavy: Row = {
    output: json(doc.output),
    display_text: s(doc.displayText),
    outputs: jsonObject(doc.outputs),
    artifacts: jsonArray(doc.artifacts),
    components: jsonArray(doc.components),
    iterator_iterations: jsonArray(doc.iteratorIterations),
    tool_trace: jsonArray(doc.toolTrace) ?? [],
    reasoning_chain: jsonArray(doc.reasoningChain) ?? [],
    llm_prompt_trace: jsonArray(doc.llmPromptTrace) ?? [],
    usage: jsonObject(doc.usage),
    semantic_match: jsonObject(doc.semanticMatch),
    trace_metadata: jsonObject(doc.traceMetadata) ?? {},
    judge_result: jsonObject(doc.judgeResult),
    judge_history: jsonArray(doc.judgeHistory) ?? [],
  };
  const row: Row = {
    id,
    execution_id: hexId(doc.executionId, 'executionId', id),
    task_id: stripNul(String(doc.taskId ?? '')),
    parent_task_id: s(doc.parentTaskId),
    runtime_subgraph_id: s(doc.runtimeSubgraphId),
    generated_local_node_id: s(doc.generatedLocalNodeId),
    generated_node_title: s(doc.generatedNodeTitle),
    iteration: int(doc.iteration) ?? 0,
    status: sDefault(doc.status, 'pending'),
    error: s(doc.error),
    started_at: d(doc.startedAt),
    ended_at: d(doc.endedAt),
    judge_status: sDefault(doc.judgeStatus, 'idle'),
    judge_scoring_mode: s(doc.judgeScoringMode),
    judge_error: s(doc.judgeError),
    ...stamps(doc),
    content_sha256: contentSha256(heavy),
  };
  return { row, heavy };
};

export const validateTaskResult = (row: Row, refs: Pick<ExecutionRefs, 'executions'>): string | null =>
  firstReason(
    dangling(refs.executions, row.execution_id, 'execution_id', 'run gone from PG'),
    String(row.task_id) === '' ? 'task_id is empty' : null,
    oneOf(row.status, TASK_RESULT_STATUSES, 'status'),
    oneOf(row.judge_status, JUDGE_STATUSES, 'judge_status'),
    row.judge_scoring_mode === null ? null : oneOf(row.judge_scoring_mode, SCORING_MODES, 'judge_scoring_mode'),
  );

/** The checksum form of a task result read back from Postgres with all its columns. */
export const taskResultChecksumRow = (pgRow: Row): Row => {
  const heavy = Object.fromEntries(TASK_RESULT_HEAVY_COLUMNS.map((c) => [c, pgRow[c]]));
  return { ...Object.fromEntries(TASK_RESULT_LIGHT_COLUMNS.map((c) => [c, pgRow[c]])), content_sha256: contentSha256(heavy) };
};

// ---------------------------------------------------------------- router decisions

export const buildRouterDecision = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    execution_id: hexId(doc.executionId, 'executionId', id),
    router_node_id: stripNul(String(doc.routerNodeId ?? '')),
    iteration: int(doc.iteration) ?? 0,
    label: stripNul(String(doc.label ?? '')),
    decided_at: d(doc.decidedAt) ?? createdAt(doc),
  };
};

export const validateRouterDecision = (row: Row, refs: Pick<ExecutionRefs, 'executions'>): string | null =>
  firstReason(
    dangling(refs.executions, row.execution_id, 'execution_id', 'run gone from PG'),
    String(row.router_node_id) === '' ? 'router_node_id is empty' : null,
  );

// ---------------------------------------------------------------- insert

/**
 * INSERT ... ON CONFLICT (id) DO NOTHING. jsonb columns are stringified here so the unit keeps the
 * plain value the checksum compares. Another unique index (a task twice in one run and iteration) is
 * not swallowed: the violation is recorded as a failure of that row.
 */
async function insertRow(pool: Queryable, table: string, columns: string[], jsonColumns: ReadonlySet<string>, row: Row): Promise<void> {
  await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    columns.map((c) => (jsonColumns.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c])),
  );
}

export const insertExecution = (pool: Queryable, row: Row): Promise<void> =>
  insertRow(pool, EXECUTION_TABLE, EXECUTION_COLUMNS, EXECUTION_JSON_COLUMNS, row);

export const insertTaskResult = (pool: Queryable, row: Row, heavy: Row): Promise<void> =>
  insertRow(pool, TASK_RESULT_TABLE, TASK_RESULT_COLUMNS, TASK_RESULT_JSON_COLUMNS, { ...row, ...heavy });

export const insertRouterDecision = (pool: Queryable, row: Row): Promise<void> =>
  insertRow(pool, ROUTER_DECISION_TABLE, ROUTER_DECISION_COLUMNS, new Set(), row);

/** SELECT list for the task-result checksum read-back: every column, `output` as returned by the driver. */
export const TASK_RESULT_CHECKSUM_SELECT = TASK_RESULT_COLUMNS.join(', ');
