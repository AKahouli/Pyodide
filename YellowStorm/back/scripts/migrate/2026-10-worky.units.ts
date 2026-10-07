/**
 * Mongo → Postgres mapping of the worky_* collections (roadmap P7).
 * Kept apart from the runner so a spec can drive the same mapping, validation and insert with
 * fabricated documents (string-typed stream ids, dangling parents, duplicate step ids) that the
 * small dev data only partly exercises.
 *
 * A unit is one Postgres row keyed by the Postgres column names; `columns` is both the insert
 * list and the checksum read-back list, so the two cannot drift apart. Numeric columns are read
 * back as float8 by the checksum so they compare with the numbers built here.
 */
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

/** Ids present in Postgres, loaded before each pass: the foreign keys reject a row whose parent is gone. */
export interface WorkyRefs {
  users: ReadonlySet<string>;
  streams: ReadonlySet<string>;
  tasks: ReadonlySet<string>;
  messages: ReadonlySet<string>;
  deltas: ReadonlySet<string>;
  policies: ReadonlySet<string>;
  workers: ReadonlySet<string>;
  proposals: ReadonlySet<string>;
}

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

const HEX = /^[0-9a-f]{24}$/;
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
const intMin0 = (v: unknown): number => Math.max(0, int(v) ?? 0);
const usd = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v * 1e8) / 1e8) : 0);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(stripNul) : []);
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
const hexIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(hexIdOrNull).filter((x): x is string => x !== null) : []);
const json = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (stripNul(v) as Record<string, unknown>) : {});

const stamps = (doc: MongoDoc) => ({ created_at: dNow(doc.createdAt), updated_at: dNow(doc.updatedAt) });
const idOf = (doc: MongoDoc): string => hexId(doc._id, '_id', String(doc._id));

/**
 * Before the ObjectId fix of the Electric consumer, mirrored rows were stored with the stream id as
 * a plain string. Every query matches an ObjectId, so those rows were never returned to anyone:
 * migrating them would surface stale content, so they are reported and skipped.
 */
const streamIdOf = (doc: MongoDoc, id: string): string => {
  if (typeof doc.streamId === 'string') throw new BackfillError('streamId is stored as a string: no query ever matched this row', id);
  return hexId(doc.streamId, 'streamId', id);
};

const STREAM_STATUSES = ['created', 'planning', 'start_requested', 'start_validation_failed', 'active', 'partially_blocked', 'waiting_for_owner', 'waiting_for_human', 'waiting_for_budget_decision', 'paused', 'stopped', 'completed', 'archived'];
const STREAM_CONTROL_STATES = ['active', 'pause_requested', 'paused', 'resume_requested', 'stop_requested', 'stopped'];
const LANES = ['backlog', 'ready', 'running', 'review', 'blocked', 'done', 'failed', 'canceled', 'superseded', 'archived'];
const PLANNING_STATUSES = ['pending', 'confirmed', 'rejected'];
const EXECUTION_STATES = ['not_started', 'scheduled', 'running', 'waiting_for_event', 'review', 'done', 'failed', 'canceled', 'superseded'];
const TASK_CONTROL_STATES = ['active', 'pause_requested', 'paused', 'stop_requested', 'stopped'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const ASSIGNEE_TYPES = ['ephemeral_ai_agent', 'human_agent', 'unassigned'];
const ACTION_CATEGORIES = ['internal_analysis', 'research', 'drafting', 'internal_artifact_write', 'internal_platform_notification', 'external_send', 'customer_facing_release', 'external_comms', 'budget_overrun', 'cancel_human_task', 'replanning'];
const LEVELS = ['off', 'notify', 'approval', 'hard_block'];
const PHASES = ['planning', 'execution', 'replan'];
const DELTA_STATUSES = ['pending', 'applied', 'rejected', 'superseded', 'pending_approval'];
const APPLY_MODES = ['auto', 'manual', 'pending_approval'];
const INTERACTION_TYPES = ['clarification', 'approval', 'review', 'missing_input', 'assignment_disambiguation', 'budget_decision', 'deadline_decision', 'escalation_decision', 'replan_review'];
const INTERACTION_STATUSES = ['pending', 'responded', 'canceled', 'expired'];
const WORKER_STATUSES = ['spawned', 'running', 'done', 'failed', 'canceled'];
const RESERVATION_STATUSES = ['reserved', 'released', 'consumed', 'denied'];
const COST_TYPES = ['llm', 'tool', 'embedding'];
const SCHEDULED_STATUSES = ['pending', 'claimed', 'fired', 'canceled'];
const REPORT_TYPES = ['summary', 'rich', 'lightweight'];
const REPORT_STATUSES = ['generating', 'ready', 'failed'];
const MEMORY_CATEGORIES = ['stream_summary', 'preference', 'person', 'decision_history', 'role_clarification'];
const MEMORY_STATUSES = ['pending', 'confirmed', 'rejected'];

const oneOf = (value: unknown, allowed: string[], label: string): string | null =>
  allowed.includes(String(value)) ? null : `${label} '${value}' is not one of ${allowed.join('|')}`;
const firstReason = (...reasons: Array<string | null>): string | null => reasons.find((r) => r !== null) ?? null;
const dangling = (set: ReadonlySet<string>, id: unknown, label: string, gone: string): string | null =>
  set.has(String(id)) ? null : `dangling ${label} ${id} (${gone}; FK would reject)`;
const streamGone = (row: Row, refs: WorkyRefs): string | null => dangling(refs.streams, row.stream_id, 'stream_id', 'stream gone from PG');
const taskGone = (row: Row, refs: WorkyRefs): string | null => dangling(refs.tasks, row.task_id, 'task_id', 'task gone from PG');

// ---------------------------------------------------------------- columns

export const POLICY_COLUMNS = ['id', 'workspace_id', 'scope', 'default_level', 'categories', 'allow_stream_owner_override', 'max_owner_relax_level', 'created_at', 'updated_at'];
export const STREAM_COLUMNS = [
  'id', 'owner_user_id', 'workspace_id', 'artifact_workspace_id', 'manager_agent_id', 'manager_model_id', 'worker_model_id', 'voice_prompt', 'ai_session_id',
  'governance_policy_ref', 'title', 'status', 'control_state', 'scheduler_enabled', 'current_plan_version', 'execution_plan_version', 'budget_limit_usd',
  'budget_limit_tokens', 'budget_spend_usd', 'budget_tokens_used', 'budget_enforcement', 'started_at', 'completed_at', 'active_duration_minutes', 'last_activity_at',
  'created_at', 'updated_at',
];
export const SHARE_COLUMNS = ['id', 'stream_id', 'user_id', 'permission', 'created_at', 'updated_at'];
export const TASK_COLUMNS = [
  'id', 'stream_id', 'external_id', 'ordinal', 'result', 'blocked_reason', 'wave', 'depends_on_step_ids', 'title', 'description', 'lane', 'planning_status',
  'execution_state', 'control_state', 'priority', 'assignee_type', 'assignee_id', 'assignee_key', 'kind', 'question', 'interrupt_id', 'assignee_name', 'assignee_role',
  'is_persona', 'is_dynamic_delegate', 'depends_on', 'required_tools', 'action_category', 'theoretical_deadline_at', 'acceptance_criteria', 'budget_estimate_usd',
  'budget_actual_usd', 'budget_tokens_estimate', 'budget_tokens_actual', 'wait_conditions', 'started_at', 'completed_at', 'duration_ms', 'created_at', 'updated_at',
];
export const DELTA_COLUMNS = ['id', 'stream_id', 'base_plan_version', 'result_plan_version', 'phase', 'trigger_event_id', 'status', 'apply_mode', 'reason', 'created_by', 'body', 'applied_at', 'approved_by', 'created_at', 'updated_at'];
export const MESSAGE_COLUMNS = ['id', 'stream_id', 'external_id', 'turn_id', 'role', 'content', 'plan_delta_ref', 'emitted_at', 'origin', 'created_at', 'updated_at'];
export const VERSION_COLUMNS = ['id', 'stream_id', 'version_number', 'phase', 'created_by', 'created_from_message_id', 'trigger_event_id', 'summary', 'created_at', 'updated_at'];
export const PROJECTION_COLUMNS = ['id', 'stream_id', 'title', 'goal', 'status', 'session_status', 'active_interrupt_id', 'created_at', 'updated_at'];
export const MESSAGE_COMPONENT_COLUMNS = ['id', 'stream_id', 'external_id', 'message_external_id', 'ordinal', 'type', 'data', 'created_at', 'updated_at'];
export const STEP_COMPONENT_COLUMNS = ['id', 'stream_id', 'external_id', 'step_external_id', 'ordinal', 'type', 'data', 'created_at', 'updated_at'];
export const STEP_ARTIFACT_COLUMNS = ['id', 'stream_id', 'external_id', 'step_external_id', 'file_path', 'filename', 'artifact_kind', 'mime_type', 'size', 'created_at', 'updated_at'];
export const INTERACTION_COLUMNS = ['id', 'stream_id', 'task_id', 'type', 'target_user_id', 'question', 'options', 'status', 'blocking_scope', 'blocks_task_ids', 'responded_at', 'response', 'metadata', 'created_at', 'updated_at'];
export const WORKER_COLUMNS = ['id', 'stream_id', 'task_id', 'agent_entity_id', 'role', 'status', 'adk_session_id', 'adk_invocation_id', 'last_checkpoint_at', 'created_at', 'updated_at'];
export const RESULT_COLUMNS = ['id', 'task_id', 'version', 'status', 'summary', 'payload', 'content_artifact_id', 'created_by_worker_id', 'created_at', 'updated_at'];
export const TRACE_COLUMNS = ['id', 'stream_id', 'task_id', 'kind', 'name', 'summary', 'raw_payload_uri', 'duration_ms', 'created_at', 'updated_at'];
export const RESERVATION_COLUMNS = ['id', 'stream_id', 'task_id', 'amount_usd', 'tokens', 'status', 'created_at', 'updated_at'];
export const COST_COLUMNS = ['id', 'stream_id', 'task_id', 'type', 'provider', 'model_id', 'input_tokens', 'output_tokens', 'cost_usd', 'created_at'];
export const LEDGER_COLUMNS = ['id', 'stream_id', 'task_id', 'kind', 'dedup_key', 'sent_at', 'created_at'];
export const SCHEDULED_COLUMNS = ['id', 'stream_id', 'task_id', 'event_type', 'fire_at', 'status', 'claim_token', 'claimed_at', 'fired_at', 'created_at', 'updated_at'];
export const REPORT_COLUMNS = ['id', 'stream_id', 'type', 'status', 'markdown_artifact_id', 'summary', 'markdown', 'metadata', 'generated_at', 'created_at', 'updated_at'];
export const AUDIT_COLUMNS = ['id', 'stream_id', 'actor_user_id', 'action', 'target_type', 'target_id', 'details', 'occurred_at'];
export const PROPOSAL_COLUMNS = ['id', 'owner_user_id', 'source_stream_id', 'category', 'title', 'content', 'status', 'decided_at', 'created_at', 'updated_at'];
export const ENTRY_COLUMNS = ['id', 'owner_user_id', 'source_proposal_id', 'source_stream_id', 'category', 'title', 'content', 'created_at', 'updated_at'];
export const SUBSCRIPTION_COLUMNS = ['id', 'user_id', 'mailbox_app_key', 'subscription_id', 'client_state', 'expires_at', 'notification_url', 'last_swept_at', 'created_at', 'updated_at'];
export const CURSOR_COLUMNS = ['shape', 'handle', 'log_offset', 'created_at', 'updated_at'];

/** Columns the checksum reads back as float8: node-pg returns numeric and bigint as strings. */
export const FLOAT_COLUMNS = new Set([
  'budget_limit_usd', 'budget_limit_tokens', 'budget_spend_usd', 'budget_tokens_used', 'budget_estimate_usd', 'budget_actual_usd', 'budget_tokens_estimate',
  'budget_tokens_actual', 'duration_ms', 'size', 'amount_usd', 'tokens', 'input_tokens', 'output_tokens', 'cost_usd',
]);
/** Columns written as jsonb: an array must be stringified, or the driver sends it as a Postgres array. */
const JSON_COLUMNS = new Set(['categories', 'body', 'data', 'payload', 'metadata', 'details']);

// ---------------------------------------------------------------- builders

export const buildPolicy = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  const categories = (Array.isArray(doc.categories) ? doc.categories : [])
    .filter((c): c is { category: string; level: string } => !!c && typeof (c as { category?: unknown }).category === 'string' && LEVELS.includes(String((c as { level?: unknown }).level)))
    .map((c) => ({ category: stripNul(c.category), level: c.level }));
  return {
    id,
    workspace_id: hexId(doc.workspaceId, 'workspaceId', id),
    scope: sDefault(doc.scope, 'workspace'),
    default_level: sDefault(doc.defaultLevel, 'off'),
    categories,
    allow_stream_owner_override: bool(doc.allowStreamOwnerOverride, true),
    max_owner_relax_level: sDefault(doc.maxOwnerRelaxLevel, 'notify'),
    ...stamps(doc),
  };
};

export const validatePolicy = (row: Row): string | null =>
  firstReason(oneOf(row.scope, ['workspace', 'stream'], 'scope'), oneOf(row.default_level, LEVELS, 'default_level'), oneOf(row.max_owner_relax_level, LEVELS, 'max_owner_relax_level'));

/** A stream row; its embedded shares ride along as a non-enumerable property (not part of the checksum). */
export const buildStream = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  const budget = (doc.budget ?? {}) as Record<string, unknown>;
  const row: Row = {
    id,
    owner_user_id: hexId(doc.ownerUserId, 'ownerUserId', id),
    workspace_id: hexId(doc.workspaceId, 'workspaceId', id),
    artifact_workspace_id: hexIdOrNull(doc.artifactWorkspaceId),
    manager_agent_id: hexIdOrNull(doc.managerAgentId),
    manager_model_id: s(doc.managerModelId),
    worker_model_id: s(doc.workerModelId),
    voice_prompt: s(doc.voicePrompt),
    ai_session_id: s(doc.aiSessionId),
    governance_policy_ref: hexIdOrNull(doc.governancePolicyRef),
    title: sReq(doc.title),
    status: sDefault(doc.status, 'created'),
    control_state: sDefault(doc.controlState, 'active'),
    scheduler_enabled: bool(doc.schedulerEnabled, false),
    current_plan_version: intMin0(doc.currentPlanVersion),
    execution_plan_version: int(doc.executionPlanVersion),
    budget_limit_usd: usd(budget.limitUsd),
    budget_limit_tokens: intMin0(budget.limitTokens),
    budget_spend_usd: usd(budget.spendUsd),
    budget_tokens_used: intMin0(budget.tokensUsed),
    budget_enforcement: sDefault(budget.enforcement, 'hard_stop'),
    started_at: d(doc.startedAt),
    completed_at: d(doc.completedAt),
    active_duration_minutes: typeof doc.activeDurationMinutes === 'number' && doc.activeDurationMinutes > 0 ? doc.activeDurationMinutes : 0,
    last_activity_at: dNow(doc.lastActivityAt ?? doc.updatedAt),
    ...stamps(doc),
  };
  const seenUsers = new Set<string>();
  const shares: Row[] = [];
  for (const share of Array.isArray(doc.shares) ? (doc.shares as MongoDoc[]) : []) {
    const userId = hexIdOrNull(share.userId);
    const shareId = hexIdOrNull(share._id);
    if (!userId || !shareId || seenUsers.has(userId)) continue;
    seenUsers.add(userId);
    shares.push({ id: shareId, stream_id: id, user_id: userId, permission: sDefault(share.permission, 'read'), ...stamps(share) });
  }
  Object.defineProperty(row, 'shares', { value: shares, enumerable: false });
  return row;
};

export const streamShares = (row: Row): Row[] => ((row as { shares?: Row[] }).shares ?? []);

export const validateStream = (row: Row, refs: WorkyRefs): string | null => {
  const title = String(row.title);
  return firstReason(
    dangling(refs.users, row.owner_user_id, 'owner_user_id', 'user gone from PG'),
    title.length < 1 || title.length > 200 ? `title length ${title.length} is outside 1..200` : null,
    oneOf(row.status, STREAM_STATUSES, 'status'),
    oneOf(row.control_state, STREAM_CONTROL_STATES, 'control_state'),
    oneOf(row.budget_enforcement, ['hard_stop', 'notify'], 'budget_enforcement'),
  );
};

/** A share of a user that no longer exists is dropped (the FK would reject it); the stream keeps its other shares. */
export const liveShares = (row: Row, refs: WorkyRefs): Row[] =>
  streamShares(row).filter((share) => refs.users.has(String(share.user_id)) && ['read', 'write'].includes(String(share.permission)));

export const buildTask = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  const budget = (doc.budget ?? {}) as Record<string, unknown>;
  return {
    id,
    stream_id: streamIdOf(doc, id),
    external_id: typeof doc.externalId === 'string' ? stripNul(doc.externalId) : null,
    ordinal: int(doc.ordinal),
    result: s(doc.result),
    blocked_reason: s(doc.blockedReason),
    wave: int(doc.wave),
    depends_on_step_ids: strings(doc.dependsOnStepIds),
    title: sReq(doc.title),
    description: sReq(doc.description),
    lane: sDefault(doc.lane, 'backlog'),
    planning_status: sDefault(doc.planningStatus, 'pending'),
    execution_state: sDefault(doc.executionState, 'not_started'),
    control_state: sDefault(doc.controlState, 'active'),
    priority: sDefault(doc.priority, 'medium'),
    assignee_type: sDefault(doc.assigneeType, 'unassigned'),
    assignee_id: hexIdOrNull(doc.assigneeId),
    assignee_key: s(doc.assigneeKey),
    kind: sDefault(doc.kind, 'execute'),
    question: s(doc.question),
    interrupt_id: s(doc.interruptId),
    assignee_name: s(doc.assigneeName),
    assignee_role: s(doc.assigneeRole),
    is_persona: bool(doc.isPersona, false),
    is_dynamic_delegate: bool(doc.isDynamicDelegate, false),
    depends_on: hexIds(doc.dependsOn),
    required_tools: strings(doc.requiredTools),
    action_category: sDefault(doc.actionCategory, 'internal_analysis'),
    theoretical_deadline_at: d(doc.theoreticalDeadlineAt),
    acceptance_criteria: strings(doc.acceptanceCriteria),
    budget_estimate_usd: usd(budget.estimateUsd),
    budget_actual_usd: usd(budget.actualUsd),
    budget_tokens_estimate: intMin0(budget.tokensEstimate),
    budget_tokens_actual: intMin0(budget.tokensActual),
    wait_conditions: strings(doc.waitConditions),
    started_at: d(doc.startedAt),
    completed_at: d(doc.completedAt),
    duration_ms: int(doc.durationMs) === null ? null : intMin0(doc.durationMs),
    ...stamps(doc),
  };
};

export const validateTask = (row: Row, refs: WorkyRefs): string | null =>
  firstReason(
    streamGone(row, refs),
    String(row.title).length < 1 ? 'title is empty' : null,
    oneOf(row.lane, LANES, 'lane'),
    oneOf(row.planning_status, PLANNING_STATUSES, 'planning_status'),
    oneOf(row.execution_state, EXECUTION_STATES, 'execution_state'),
    oneOf(row.control_state, TASK_CONTROL_STATES, 'control_state'),
    oneOf(row.priority, PRIORITIES, 'priority'),
    oneOf(row.assignee_type, ASSIGNEE_TYPES, 'assignee_type'),
    oneOf(row.action_category, ACTION_CATEGORIES, 'action_category'),
  );

export const buildDelta = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  const status = sDefault(doc.status, 'pending');
  return {
    id,
    stream_id: streamIdOf(doc, id),
    base_plan_version: intMin0(doc.basePlanVersion),
    result_plan_version: int(doc.resultPlanVersion),
    phase: sReq(doc.phase),
    trigger_event_id: sReq(doc.triggerEventId),
    status,
    apply_mode: sDefault(doc.applyMode, 'auto'),
    reason: sReq(doc.reason),
    created_by: hexId(doc.createdBy, 'createdBy', id),
    body: json(doc.body),
    applied_at: d(doc.appliedAt) ?? (status === 'applied' ? dNow(doc.updatedAt) : null),
    approved_by: hexIdOrNull(doc.approvedBy),
    ...stamps(doc),
  };
};

export const validateDelta = (row: Row, refs: WorkyRefs): string | null =>
  firstReason(streamGone(row, refs), oneOf(row.phase, PHASES, 'phase'), oneOf(row.status, DELTA_STATUSES, 'status'), oneOf(row.apply_mode, APPLY_MODES, 'apply_mode'));

export const buildMessage = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    external_id: typeof doc.externalId === 'string' ? stripNul(doc.externalId) : null,
    turn_id: typeof doc.turnId === 'string' ? stripNul(doc.turnId) : null,
    role: sReq(doc.role),
    content: sReq(doc.content),
    plan_delta_ref: hexIdOrNull(doc.planDeltaRef),
    emitted_at: d(doc.emittedAt),
    origin: doc.origin === 'voice' ? 'voice' : null,
    ...stamps(doc),
  };
};

export const validateMessage = (row: Row, refs: WorkyRefs): string | null =>
  firstReason(streamGone(row, refs), oneOf(row.role, ['owner', 'manager', 'system'], 'role'));

/** A message that points at a plan delta that is gone keeps its text and loses the reference (ON DELETE SET NULL). */
export const withLiveDelta = (row: Row, refs: WorkyRefs): Row =>
  row.plan_delta_ref !== null && !refs.deltas.has(String(row.plan_delta_ref)) ? { ...row, plan_delta_ref: null } : row;

export const buildVersion = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    version_number: int(doc.versionNumber) ?? 0,
    phase: sReq(doc.phase),
    created_by: hexId(doc.createdBy, 'createdBy', id),
    created_from_message_id: hexIdOrNull(doc.createdFromMessageId),
    trigger_event_id: s(doc.triggerEventId),
    summary: sReq(doc.summary),
    ...stamps(doc),
  };
};

export const validateVersion = (row: Row, refs: WorkyRefs): string | null =>
  firstReason(streamGone(row, refs), Number(row.version_number) < 1 ? 'version_number is below 1' : null, oneOf(row.phase, PHASES, 'phase'));

export const withLiveMessage = (row: Row, refs: WorkyRefs): Row =>
  row.created_from_message_id !== null && !refs.messages.has(String(row.created_from_message_id)) ? { ...row, created_from_message_id: null } : row;

export const buildProjection = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    title: sReq(doc.title),
    goal: sReq(doc.goal),
    status: sReq(doc.status),
    session_status: s(doc.sessionStatus),
    active_interrupt_id: s(doc.activeInterruptId),
    ...stamps(doc),
  };
};

export const buildMessageComponent = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    external_id: typeof doc.externalId === 'string' ? stripNul(doc.externalId) : null,
    message_external_id: sReq(doc.messageExternalId),
    ordinal: int(doc.ordinal) ?? 0,
    type: sReq(doc.type),
    data: json(doc.data),
    ...stamps(doc),
  };
};

export const buildStepComponent = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    external_id: typeof doc.externalId === 'string' ? stripNul(doc.externalId) : null,
    step_external_id: sReq(doc.stepExternalId),
    ordinal: int(doc.ordinal) ?? 0,
    type: sReq(doc.type),
    data: json(doc.data),
    ...stamps(doc),
  };
};

export const buildStepArtifact = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    external_id: typeof doc.externalId === 'string' ? stripNul(doc.externalId) : null,
    step_external_id: sReq(doc.stepExternalId),
    file_path: sReq(doc.filePath),
    filename: sReq(doc.filename),
    artifact_kind: s(doc.artifactKind),
    mime_type: s(doc.mimeType),
    size: int(doc.size),
    ...stamps(doc),
  };
};

export const validateInStream = (row: Row, refs: WorkyRefs): string | null => streamGone(row, refs);

export const buildInteraction = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    task_id: hexIdOrNull(doc.taskId),
    type: sReq(doc.type),
    target_user_id: hexIdOrNull(doc.targetUserId),
    question: sReq(doc.question),
    options: strings(doc.options),
    status: sDefault(doc.status, 'pending'),
    blocking_scope: sDefault(doc.blockingScope, 'stream'),
    blocks_task_ids: hexIds(doc.blocksTaskIds),
    responded_at: d(doc.respondedAt),
    response: s(doc.response),
    metadata: json(doc.metadata),
    ...stamps(doc),
  };
};

export const validateInteraction = (row: Row, refs: WorkyRefs): string | null =>
  firstReason(streamGone(row, refs), oneOf(row.type, INTERACTION_TYPES, 'type'), oneOf(row.status, INTERACTION_STATUSES, 'status'));

/** An interaction keeps its question when its task or target user is gone (ON DELETE SET NULL). */
export const withLiveInteractionRefs = (row: Row, refs: WorkyRefs): Row => ({
  ...row,
  task_id: row.task_id !== null && !refs.tasks.has(String(row.task_id)) ? null : row.task_id,
  target_user_id: row.target_user_id !== null && !refs.users.has(String(row.target_user_id)) ? null : row.target_user_id,
});

export const buildWorker = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    task_id: hexId(doc.taskId, 'taskId', id),
    agent_entity_id: hexId(doc.agentEntityId, 'agentEntityId', id),
    role: sReq(doc.role),
    status: sDefault(doc.status, 'spawned'),
    adk_session_id: s(doc.adkSessionId),
    adk_invocation_id: s(doc.adkInvocationId),
    last_checkpoint_at: d(doc.lastCheckpointAt),
    ...stamps(doc),
  };
};

export const validateWorker = (row: Row, refs: WorkyRefs): string | null => firstReason(streamGone(row, refs), taskGone(row, refs), oneOf(row.status, WORKER_STATUSES, 'status'));

export const buildResult = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    task_id: hexId(doc.taskId, 'taskId', id),
    version: int(doc.version) ?? 0,
    status: sReq(doc.status),
    summary: sReq(doc.summary),
    payload: doc.payload && typeof doc.payload === 'object' ? json(doc.payload) : null,
    content_artifact_id: hexIdOrNull(doc.contentArtifactId),
    created_by_worker_id: hexIdOrNull(doc.createdByWorkerId),
    ...stamps(doc),
  };
};

export const validateResult = (row: Row, refs: WorkyRefs): string | null => firstReason(taskGone(row, refs), Number(row.version) < 1 ? 'version is below 1' : null);

export const withLiveWorker = (row: Row, refs: WorkyRefs): Row =>
  row.created_by_worker_id !== null && !refs.workers.has(String(row.created_by_worker_id)) ? { ...row, created_by_worker_id: null } : row;

export const buildTrace = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    task_id: hexId(doc.taskId, 'taskId', id),
    kind: sReq(doc.kind),
    name: sReq(doc.name),
    summary: sReq(doc.summary),
    raw_payload_uri: s(doc.rawPayloadUri),
    duration_ms: intMin0(doc.durationMs),
    ...stamps(doc),
  };
};

export const validateTrace = (row: Row, refs: WorkyRefs): string | null => firstReason(streamGone(row, refs), taskGone(row, refs), oneOf(row.kind, ['tool', 'model'], 'kind'));

export const buildReservation = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    task_id: hexId(doc.taskId, 'taskId', id),
    amount_usd: usd(doc.amountUsd),
    tokens: intMin0(doc.tokens),
    status: sDefault(doc.status, 'reserved'),
    ...stamps(doc),
  };
};

export const validateReservation = (row: Row, refs: WorkyRefs): string | null => firstReason(streamGone(row, refs), taskGone(row, refs), oneOf(row.status, RESERVATION_STATUSES, 'status'));

export const buildCostEvent = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    task_id: hexIdOrNull(doc.taskId),
    type: sReq(doc.type),
    provider: sReq(doc.provider),
    model_id: sReq(doc.modelId),
    input_tokens: intMin0(doc.inputTokens),
    output_tokens: intMin0(doc.outputTokens),
    cost_usd: usd(doc.costUsd),
    created_at: dNow(doc.createdAt),
  };
};

export const validateCostEvent = (row: Row, refs: WorkyRefs): string | null => firstReason(streamGone(row, refs), oneOf(row.type, COST_TYPES, 'type'));

/** A cost event or ledger row keeps its data when its task is gone (ON DELETE SET NULL). */
export const withLiveTask = (row: Row, refs: WorkyRefs): Row =>
  row.task_id !== null && !refs.tasks.has(String(row.task_id)) ? { ...row, task_id: null } : row;

export const buildLedger = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    task_id: hexIdOrNull(doc.taskId),
    kind: sReq(doc.kind),
    dedup_key: sReq(doc.dedupKey),
    sent_at: dNow(doc.sentAt ?? doc.createdAt),
    created_at: dNow(doc.createdAt),
  };
};

export const buildScheduled = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    task_id: hexIdOrNull(doc.taskId),
    event_type: sReq(doc.eventType),
    fire_at: dNow(doc.fireAt),
    status: sDefault(doc.status, 'pending'),
    claim_token: s(doc.claimToken),
    claimed_at: d(doc.claimedAt),
    fired_at: d(doc.firedAt),
    ...stamps(doc),
  };
};

export const validateScheduled = (row: Row, refs: WorkyRefs): string | null => firstReason(streamGone(row, refs), oneOf(row.status, SCHEDULED_STATUSES, 'status'));

export const buildReport = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: streamIdOf(doc, id),
    type: sReq(doc.type),
    status: sDefault(doc.status, 'generating'),
    markdown_artifact_id: hexIdOrNull(doc.markdownArtifactId),
    summary: sReq(doc.summary),
    markdown: sReq(doc.markdown),
    metadata: json(doc.metadata),
    generated_at: d(doc.generatedAt),
    ...stamps(doc),
  };
};

export const validateReport = (row: Row, refs: WorkyRefs): string | null => firstReason(streamGone(row, refs), oneOf(row.type, REPORT_TYPES, 'type'), oneOf(row.status, REPORT_STATUSES, 'status'));

/** Audit rows carry a scope id, not a stream foreign key, so a scope that is not a stream still migrates. */
export const buildAudit = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    stream_id: hexId(doc.streamId, 'streamId', id),
    actor_user_id: hexIdOrNull(doc.actorUserId),
    action: sReq(doc.action),
    target_type: s(doc.targetType),
    target_id: hexIdOrNull(doc.targetId),
    details: json(doc.details),
    occurred_at: dNow(doc.occurredAt ?? doc.createdAt),
  };
};

export const buildProposal = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    owner_user_id: hexId(doc.ownerUserId, 'ownerUserId', id),
    source_stream_id: hexIdOrNull(doc.sourceStreamId),
    category: sReq(doc.category),
    title: sReq(doc.title),
    content: sReq(doc.content),
    status: sDefault(doc.status, 'pending'),
    decided_at: d(doc.decidedAt),
    ...stamps(doc),
  };
};

export const validateProposal = (row: Row, refs: WorkyRefs): string | null =>
  firstReason(dangling(refs.users, row.owner_user_id, 'owner_user_id', 'user gone from PG'), oneOf(row.category, MEMORY_CATEGORIES, 'category'), oneOf(row.status, MEMORY_STATUSES, 'status'));

export const buildEntry = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    owner_user_id: hexId(doc.ownerUserId, 'ownerUserId', id),
    source_proposal_id: hexIdOrNull(doc.sourceProposalId),
    source_stream_id: hexIdOrNull(doc.sourceStreamId),
    category: sReq(doc.category),
    title: sReq(doc.title),
    content: sReq(doc.content),
    ...stamps(doc),
  };
};

export const validateEntry = (row: Row, refs: WorkyRefs): string | null =>
  firstReason(dangling(refs.users, row.owner_user_id, 'owner_user_id', 'user gone from PG'), oneOf(row.category, MEMORY_CATEGORIES, 'category'));

/** Memory outlives a source that is gone: the reference is dropped, the memory kept. */
export const withLiveMemorySources = (row: Row, refs: WorkyRefs): Row => ({
  ...row,
  source_stream_id: row.source_stream_id !== null && !refs.streams.has(String(row.source_stream_id)) ? null : row.source_stream_id,
  ...('source_proposal_id' in row ? { source_proposal_id: row.source_proposal_id !== null && !refs.proposals.has(String(row.source_proposal_id)) ? null : row.source_proposal_id } : {}),
});

export const buildSubscription = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    user_id: hexId(doc.userId, 'userId', id),
    mailbox_app_key: sReq(doc.mailboxAppKey),
    subscription_id: s(doc.subscriptionId),
    client_state: s(doc.clientState),
    expires_at: d(doc.expiresAt),
    notification_url: s(doc.notificationUrl),
    last_swept_at: d(doc.lastSweptAt),
    ...stamps(doc),
  };
};

export const validateSubscription = (row: Row, refs: WorkyRefs): string | null =>
  firstReason(dangling(refs.users, row.user_id, 'user_id', 'user gone from PG'), String(row.mailbox_app_key).length < 1 ? 'mailbox_app_key is empty' : null);

export const buildCursor = (doc: MongoDoc): Row => {
  const shape = sReq(doc.shape);
  if (!shape) throw new BackfillError('shape is empty', String(doc._id));
  return { shape, handle: s(doc.handle), log_offset: s(doc.offset), ...stamps(doc) };
};

// ---------------------------------------------------------------- insert

/**
 * INSERT ... ON CONFLICT (key) DO NOTHING. jsonb columns are stringified here so the unit keeps the
 * plain value the checksum compares. Other unique indexes (a step id twice in one stream) are not
 * swallowed: the violation is recorded as a failure of that row.
 */
export async function insertRow(pool: Queryable, table: string, columns: string[], row: Row, key = 'id'): Promise<void> {
  await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (${key}) DO NOTHING`,
    columns.map((c) => (JSON_COLUMNS.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c])),
  );
}

/** A stream and its shares, together: shares of users that are gone are skipped. */
export async function insertStream(pool: Queryable, row: Row, refs: WorkyRefs): Promise<void> {
  const policy = row.governance_policy_ref;
  await insertRow(pool, 'worky.streams', STREAM_COLUMNS, policy !== null && !refs.policies.has(String(policy)) ? { ...row, governance_policy_ref: null } : row);
  for (const share of liveShares(row, refs)) await insertRow(pool, 'worky.stream_shares', SHARE_COLUMNS, share);
}

/** SELECT list for the checksum read-back: numeric and bigint come back as float8. */
export const checksumSelect = (columns: string[]): string => columns.map((c) => (FLOAT_COLUMNS.has(c) ? `${c}::float8 AS ${c}` : c)).join(', ');
