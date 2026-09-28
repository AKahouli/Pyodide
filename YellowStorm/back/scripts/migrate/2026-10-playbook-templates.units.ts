/**
 * Mongo → Postgres mapping of the playbook-flow templates, output formats, HITL memories and mail
 * trigger ledger (roadmap P5, package A2). Kept apart from the runner so a spec can drive the same
 * mapping, validation and insert with fabricated documents.
 *
 * A unit is one Postgres row keyed by the Postgres column names; `columns` is both the insert list and
 * the checksum read-back list. The config subdocuments of a node template, the prompt trace of an
 * output format and the participants and attachments of a mail event are cast exactly like the
 * repositories cast a new write (Mongoose's subdocument `_id`s and keys outside the schema dropped).
 */
import { stripNul } from '../../src/common/postgres/json';
import {
  castHumanApprovalConfig,
  castInputPorts,
  castIteratorConfig,
  castOutputPorts,
  castRetryPolicy,
  castRouterConfig,
  TEMPLATE_MAX_LENGTHS,
} from '../../src/modules/playbook-flow/persistence/template-cast';
import { castMailAttachments, castMailParticipant, castMailParticipants } from '../../src/modules/playbook-flow/persistence/mail-cast';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

/** Ids present in Postgres (or accepted by a dry run): the foreign keys reject a row whose parent is gone. */
export interface TemplateRefs {
  users: ReadonlySet<string>;
  flows: ReadonlySet<string>;
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
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? stripNul(v) : fallback);
const trimmed = (v: unknown): string => sReq(v).trim();
const trimmedOrNull = (v: unknown): string | null => (v == null ? null : stripNul(String(v)).trim());
const sDefault = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? stripNul(v) : fallback);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
/** A Mongoose Boolean with a default: the default when never set, false for a stored null. */
const flag = (v: unknown, fallback: boolean): boolean => (v === undefined ? fallback : v === true);
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
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

const stamps = (doc: MongoDoc) => ({ created_at: dNow(doc.createdAt), updated_at: dNow(doc.updatedAt) });
const idOf = (doc: MongoDoc): string => hexId(doc._id, '_id', String(doc._id));

const NODE_TYPES = ['agent', 'action', 'evaluation', 'iterator', 'router', 'human_approval'];
const OUTPUT_FORMAT_STATUSES = ['active', 'inactive', 'archived'];
const GENERATION_STATUSES = ['pending', 'ready', 'failed'];
const MEMORY_TYPES = ['semantic', 'episodic', 'procedural', 'approval_policy'];
const MEMORY_SOURCES = ['hitl_feedback', 'blocker_rule', 'replay_validation', 'manual'];
const MEMORY_APPLIES_TO = ['node', 'workflow', 'agent', 'workspace'];
const MEMORY_STATUSES = ['active', 'draft', 'archived'];
const MEMORY_SENSITIVITIES = ['normal', 'sensitive'];
const MAIL_STATUSES = ['received', 'normalized', 'matched', 'handed_off', 'deduplicated', 'ignored', 'errored'];

const oneOf = (value: unknown, allowed: string[], label: string): string | null =>
  allowed.includes(String(value)) ? null : `${label} '${value}' is not one of ${allowed.join('|')}`;
const firstReason = (...reasons: Array<string | null>): string | null => reasons.find((r) => r !== null) ?? null;
const dangling = (set: ReadonlySet<string>, id: unknown, label: string, gone: string): string | null =>
  set.has(String(id)) ? null : `dangling ${label} ${id} (${gone}; FK would reject)`;
const flowGone = (row: Row, refs: TemplateRefs): string | null => dangling(refs.flows, row.flow_id, 'flow_id', 'flow gone from PG');
const tooLong = (row: Row, fields: Array<keyof typeof TEMPLATE_MAX_LENGTHS>): string | null =>
  firstReason(...fields.map((field) => {
    const value = row[field];
    return typeof value === 'string' && value.length > TEMPLATE_MAX_LENGTHS[field]
      ? `${field} length ${value.length} exceeds ${TEMPLATE_MAX_LENGTHS[field]}`
      : null;
  }));
const required = (row: Row, fields: string[]): string | null =>
  firstReason(...fields.map((field) => (row[field] === null || row[field] === '' ? `${field} is missing` : null)));

// ---------------------------------------------------------------- columns

export const NODE_TEMPLATE_COLUMNS = [
  'id', 'key', 'node_type', 'title', 'description', 'icon', 'color', 'category', 'input_ports', 'output_ports', 'prompt_template',
  'recommended_agent_type_slug', 'required_tool_names', 'assigned_agent_id', 'selected_action', 'iterator_config', 'enabled', 'router_config',
  'human_approval_config', 'retry_policy', 'model_id', 'version', 'is_built_in', 'created_by', 'updated_by', 'created_at', 'updated_at',
];
export const PROMPT_TEMPLATE_COLUMNS = [
  'id', 'key', 'title', 'category', 'description', 'system_template', 'user_template', 'enabled', 'version', 'is_built_in', 'created_by', 'updated_by',
  'created_at', 'updated_at',
];
export const OUTPUT_FORMAT_COLUMNS = [
  'id', 'flow_id', 'node_id', 'created_by', 'source_execution_id', 'source_execution_number', 'template_version', 'status', 'generation_status',
  'generation_error', 'source_output', 'format_guide', 'llm_prompt_trace', 'created_at', 'updated_at',
];
export const HITL_MEMORY_COLUMNS = [
  'id', 'owner_id', 'flow_id', 'node_id', 'memory_type', 'source', 'title', 'content', 'normalized_instruction', 'applies_to', 'status', 'sensitivity',
  'created_from_execution_id', 'created_from_interrupt_id', 'created_at', 'updated_at',
];
export const MAIL_LEDGER_COLUMNS = [
  'id', 'ledger_id', 'flow_id', 'dedupe_key', 'status', 'provider', 'mailbox_app_key', 'provider_message_id', 'provider_thread_id', 'received_at',
  'occurred_at', 'subject', 'body_text', 'body_html', 'from_participant', 'to_participants', 'cc_participants', 'has_attachments', 'attachments', 'error',
  'execution_id', 'created_at',
];

/** Columns written as jsonb: an array must be stringified, or the driver sends it as a Postgres array. */
const JSON_COLUMNS = new Set([
  'input_ports', 'output_ports', 'iterator_config', 'router_config', 'human_approval_config', 'retry_policy', 'llm_prompt_trace',
  'from_participant', 'to_participants', 'cc_participants', 'attachments',
]);

// ---------------------------------------------------------------- templates

/**
 * A node template. The legacy `type` (replaced by `key`, its index dropped by the 2026-06-28 script)
 * and `executionMode` fields are not in the schema any more and are dropped.
 */
export const buildNodeTemplate = (doc: MongoDoc): Row => ({
  id: idOf(doc),
  key: trimmed(doc.key),
  node_type: sDefault(trimmedOrNull(doc.nodeType), 'agent'),
  title: trimmed(doc.title),
  description: trimmedOrNull(doc.description),
  icon: trimmedOrNull(doc.icon),
  color: trimmedOrNull(doc.color),
  category: trimmed(doc.category),
  input_ports: castInputPorts(doc.inputPorts),
  output_ports: castOutputPorts(doc.outputPorts),
  prompt_template: str(doc.promptTemplate),
  recommended_agent_type_slug: trimmedOrNull(doc.recommendedAgentTypeSlug),
  required_tool_names: strings(doc.requiredToolNames),
  assigned_agent_id: trimmedOrNull(doc.assignedAgentId),
  selected_action: trimmedOrNull(doc.selectedAction),
  iterator_config: castIteratorConfig(doc.iteratorConfig),
  enabled: flag(doc.enabled, true),
  router_config: castRouterConfig(doc.routerConfig),
  human_approval_config: castHumanApprovalConfig(doc.humanApprovalConfig),
  retry_policy: castRetryPolicy(doc.retryPolicy),
  model_id: trimmedOrNull(doc.modelId),
  version: int(doc.version) ?? 1,
  is_built_in: flag(doc.isBuiltIn, false),
  created_by: hexIdOrNull(doc.createdBy),
  updated_by: hexIdOrNull(doc.updatedBy),
  ...stamps(doc),
});

export const validateNodeTemplate = (row: Row): string | null =>
  firstReason(
    required(row, ['key', 'title', 'category']),
    oneOf(row.node_type, NODE_TYPES, 'node_type'),
    tooLong(row, ['key', 'title', 'description', 'icon', 'color', 'category']),
    Number(row.version) < 1 ? `version ${row.version} is below 1` : null,
  );

export const buildPromptTemplate = (doc: MongoDoc): Row => ({
  id: idOf(doc),
  key: trimmed(doc.key),
  title: trimmed(doc.title),
  category: trimmed(doc.category),
  description: trimmedOrNull(doc.description),
  system_template: str(doc.systemTemplate),
  user_template: str(doc.userTemplate),
  enabled: flag(doc.enabled, true),
  version: int(doc.version) ?? 1,
  is_built_in: flag(doc.isBuiltIn, true),
  created_by: hexIdOrNull(doc.createdBy),
  updated_by: hexIdOrNull(doc.updatedBy),
  ...stamps(doc),
});

export const validatePromptTemplate = (row: Row): string | null =>
  firstReason(
    required(row, ['key', 'title', 'category']),
    tooLong(row, ['key', 'title', 'description', 'category']),
    Number(row.version) < 1 ? `version ${row.version} is below 1` : null,
  );

// ---------------------------------------------------------------- output formats

const castPromptTrace = (v: unknown): Row[] =>
  (Array.isArray(v) ? v.filter(isPlainObject) : []).map((item) => ({
    stage: sReq(item.stage),
    model: sReq(item.model),
    prompt: sReq(item.prompt),
    generatedOutput: s(item.generatedOutput),
  }));

/** An output format; its source execution is a soft reference, kept even when that run is gone. */
export const buildOutputFormat = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    flow_id: hexId(doc.flowId, 'flowId', id),
    node_id: sReq(doc.nodeId),
    created_by: hexId(doc.createdBy, 'createdBy', id),
    source_execution_id: hexId(doc.sourceExecutionId, 'sourceExecutionId', id),
    source_execution_number: int(doc.sourceExecutionNumber),
    template_version: int(doc.templateVersion),
    status: sDefault(doc.status, 'active'),
    generation_status: sDefault(doc.generationStatus, 'pending'),
    generation_error: s(doc.generationError),
    source_output: s(doc.sourceOutput),
    format_guide: s(doc.formatGuide),
    llm_prompt_trace: castPromptTrace(doc.llmPromptTrace),
    ...stamps(doc),
  };
};

export const validateOutputFormat = (row: Row, refs: TemplateRefs): string | null =>
  firstReason(
    flowGone(row, refs),
    required(row, ['node_id', 'source_execution_number', 'template_version']),
    oneOf(row.status, OUTPUT_FORMAT_STATUSES, 'status'),
    oneOf(row.generation_status, GENERATION_STATUSES, 'generation_status'),
  );

// ---------------------------------------------------------------- HITL memories

export const buildHitlMemory = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    owner_id: hexId(doc.ownerId, 'ownerId', id),
    flow_id: hexId(doc.flowId, 'flowId', id),
    node_id: s(doc.nodeId),
    memory_type: sDefault(doc.memoryType, 'procedural'),
    source: sDefault(doc.source, 'hitl_feedback'),
    title: sReq(doc.title),
    content: sReq(doc.content),
    normalized_instruction: sReq(doc.normalizedInstruction),
    applies_to: sDefault(doc.appliesTo, 'workflow'),
    status: sDefault(doc.status, 'draft'),
    sensitivity: sDefault(doc.sensitivity, 'normal'),
    created_from_execution_id: s(doc.createdFromExecutionId),
    created_from_interrupt_id: s(doc.createdFromInterruptId),
    ...stamps(doc),
  };
};

export const validateHitlMemory = (row: Row, refs: TemplateRefs): string | null =>
  firstReason(
    dangling(refs.users, row.owner_id, 'owner_id', 'user gone from PG'),
    flowGone(row, refs),
    oneOf(row.memory_type, MEMORY_TYPES, 'memory_type'),
    oneOf(row.source, MEMORY_SOURCES, 'source'),
    oneOf(row.applies_to, MEMORY_APPLIES_TO, 'applies_to'),
    oneOf(row.status, MEMORY_STATUSES, 'status'),
    oneOf(row.sensitivity, MEMORY_SENSITIVITIES, 'sensitivity'),
  );

// ---------------------------------------------------------------- mail ledger

/**
 * A mail trigger ledger entry: the Mongo document's own `id` field (the id the mail code addresses the
 * entry by) becomes `ledger_id`, its `_id` the row key. The execution is a soft reference.
 */
export const buildMailLedger = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  if (typeof doc.id !== 'string' || doc.id === '') throw new BackfillError('ledger id (the `id` field) is missing', id);
  if (!isPlainObject(doc.from)) throw new BackfillError('from is missing', id);
  return {
    id,
    ledger_id: stripNul(doc.id),
    flow_id: hexId(doc.flowId, 'flowId', id),
    dedupe_key: sReq(doc.dedupeKey),
    status: sDefault(doc.status, 'received'),
    provider: sDefault(doc.provider, 'm365'),
    mailbox_app_key: sReq(doc.mailboxAppKey),
    provider_message_id: sReq(doc.providerMessageId),
    provider_thread_id: s(doc.providerThreadId),
    received_at: d(doc.receivedAt),
    occurred_at: d(doc.occurredAt),
    subject: str(doc.subject),
    body_text: str(doc.bodyText),
    body_html: s(doc.bodyHtml),
    from_participant: castMailParticipant(doc.from),
    to_participants: castMailParticipants(doc.to),
    cc_participants: castMailParticipants(doc.cc),
    has_attachments: doc.hasAttachments === true,
    attachments: castMailAttachments(doc.attachments),
    error: s(doc.error),
    execution_id: hexIdOrNull(doc.executionId),
    created_at: d(doc.createdAt),
  };
};

export const validateMailLedger = (row: Row, refs: TemplateRefs): string | null =>
  firstReason(
    flowGone(row, refs),
    required(row, ['dedupe_key', 'received_at', 'occurred_at', 'created_at']),
    oneOf(row.status, MAIL_STATUSES, 'status'),
  );

// ---------------------------------------------------------------- insert

/**
 * INSERT ... ON CONFLICT (id) DO NOTHING. jsonb columns are stringified here so the unit keeps the plain
 * value the checksum compares. Other unique indexes (a template key, a mail dedupe key) are not
 * swallowed: the violation is recorded as a failure of that row.
 */
export async function insertRow(pool: Queryable, table: string, columns: string[], row: Row): Promise<void> {
  await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    columns.map((c) => (JSON_COLUMNS.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c])),
  );
}

/** SELECT list for the checksum read-back (no numeric or bigint column here). */
export const checksumSelect = (columns: string[]): string => columns.join(', ');
