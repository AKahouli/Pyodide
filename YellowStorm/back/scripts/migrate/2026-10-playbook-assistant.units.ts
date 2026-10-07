/**
 * Mongo -> Postgres mapping of the Playbook assistant and design workspace collections (roadmap P5,
 * package C). Kept apart from the runner so a spec can drive the same mapping, validation and insert
 * with fabricated documents: the dev data holds almost none of these rows (the assistant ones live
 * 24 hours to 30 days).
 *
 *   playbookassistantrequests / operations / messages / revisions: TTL rows. Only the ones whose
 *     `expiresAt` is still in the future are copied (the runner filters on it): an expired row is one
 *     Mongo's TTL monitor was about to delete, and one the repositories would never return.
 *   playbookassistantattachments: NOT a TTL collection. The attachment service deletes the stored
 *     image first and the row after, so every row is copied, expired ones included, or their images
 *     would never be cleaned up.
 *   playbook_flow_design_messages: rows of a flow that is gone are reported (the FK would reject
 *     them); a revert pointing at a message that is not migrated loses that link (ON DELETE SET NULL).
 *   flowdesignoperations: rows of a flow or owner that is gone are reported; a dangling applied
 *     message is nulled.
 * Not migrated: playbook_design_messages, a legacy collection no code reads.
 *
 * A unit is one Postgres row keyed by the Postgres column names; `columns` is both the insert list and
 * the checksum read-back list. bigint columns are read back as float8 by the checksum.
 */
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

type IdLookup = Pick<ReadonlySet<string>, 'has'>;

/** Ids present in Postgres (plus those accepted so far): the foreign keys reject a row whose parent is gone. */
export interface PlaybookAssistantRefs {
  users: IdLookup;
  flows: IdLookup;
  designMessages: IdLookup;
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
const s = (v: unknown): string | null => (v == null ? null : stripNul(String(v)));
const sReq = (v: unknown): string => stripNul(String(v ?? ''));
const sDefault = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? stripNul(v) : fallback);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const intMin0 = (v: unknown): number => Math.max(0, int(v) ?? 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(stripNul) : []);
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? (stripNul(plain(v)) as Record<string, unknown>) : null;
const objects = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).map(object).filter((x): x is Record<string, unknown> => x !== null);
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

/** BSON values nested in a document (ObjectId, Date) as their JSON form, the way they read back from jsonb. */
function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const candidate = value as { toHexString?: () => string };
    if (typeof candidate.toHexString === 'function') return candidate.toHexString();
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

const idOf = (doc: MongoDoc): string => hexId(doc._id, '_id', String(doc._id));
/** Revisions carry no timestamps in Mongo: their creation time is the one in their ObjectId. */
const objectIdTime = (id: string): Date => new Date(Number.parseInt(id.slice(0, 8), 16) * 1000);
const stamps = (doc: MongoDoc, id: string) => {
  const created = d(doc.createdAt) ?? objectIdTime(id);
  return { created_at: created, updated_at: d(doc.updatedAt) ?? created };
};
const expiresAt = (doc: MongoDoc, id: string): Date => {
  const value = d(doc.expiresAt);
  if (!value) throw new BackfillError('expiresAt is missing', id);
  return value;
};

const oneOf = (value: unknown, allowed: string[], label: string): string | null =>
  allowed.includes(String(value)) ? null : `${label} '${value}' is not one of ${allowed.join('|')}`;
const firstReason = (...reasons: Array<string | null>): string | null => reasons.find((r) => r !== null) ?? null;
const required = (row: Row, ...columns: string[]): string | null => {
  const empty = columns.find((column) => typeof row[column] !== 'string' || row[column] === '');
  return empty ? `${empty} is empty` : null;
};
const min = (row: Row, column: string, floor: number, nullable = false): string | null => {
  const value = row[column];
  if (value === null && nullable) return null;
  return typeof value === 'number' && value >= floor ? null : `${column} ${value} is below ${floor}`;
};
const dangling = (set: IdLookup, id: unknown, label: string, gone: string): string | null =>
  set.has(String(id)) ? null : `dangling ${label} ${id} (${gone}; FK would reject)`;

export const OPERATION_KINDS = ['inspect', 'existing_construction', 'generation'];
export const REQUEST_STATUSES = ['processing', 'awaiting_clarification', 'ready', 'completed', 'failed'];
const CONSTRUCTION_KINDS = ['construction', 'generation'];
const ORIGINS = ['designer', 'mcp', 'advisor'];
const TARGETS = ['canonical', 'advisor_preview'];
const APPLY_TARGETS = ['current_playbook', 'new_playbook'];
const DISPOSITIONS = ['pending', 'applying', 'applied', 'discarded', 'reverted'];
const OPERATION_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];
const ROLES = ['user', 'assistant'];
const ATTACHMENT_STATUSES = ['pending', 'confirmed'];
const DESIGN_MESSAGE_STATUSES = ['completed', 'failed', 'reverted'];
const DESIGN_OPERATION_STATUSES = ['queued', 'running', 'applying', 'completed', 'failed', 'cancelled'];

/** The Mongo collections of the TTL tables: only rows whose `expiresAt` is still ahead are copied. */
export const TTL_COLLECTIONS = ['playbookassistantrequests', 'playbookassistantoperations', 'playbookassistantmessages', 'playbookassistantrevisions'];
export const NOT_MIGRATED = ['playbook_design_messages'];

// ---------------------------------------------------------------- columns

export const REQUEST_COLUMNS = [
  'id', 'request_id', 'owner_id', 'agent_id', 'conversation_id', 'correlation_id', 'operation_kind', 'playbook_id', 'expected_definition_revision',
  'context_id', 'message_hash', 'original_text', 'requested_name', 'handoff_context', 'handoff_provenance', 'workspace_default_ids', 'selected_task_id',
  'execution_id', 'attachment_ids', 'continuation_id', 'assessment', 'assessment_version', 'answers', 'mutation_operation_id', 'assistant_answer',
  'response_payload', 'status', 'expires_at', 'created_at', 'updated_at',
];
export const OPERATION_COLUMNS = [
  'id', 'operation_id', 'playbook_id', 'owner_id', 'request_id', 'operation_kind', 'origin', 'target', 'apply_target', 'disposition', 'status',
  'base_definition_revision', 'last_sequence', 'events', 'event_bytes', 'worker_id', 'lease_expires_at', 'terminal_at', 'committed_revision',
  'committed_at', 'reverted_revision', 'reverted_at', 'created_playbook_id', 'expires_at', 'created_at', 'updated_at',
];
export const MESSAGE_COLUMNS = ['id', 'message_id', 'request_id', 'conversation_id', 'owner_id', 'playbook_id', 'role', 'content', 'operation_id', 'expires_at', 'created_at', 'updated_at'];
export const REVISION_COLUMNS = ['id', 'operation_id', 'playbook_id', 'owner_id', 'definition_revision', 'definition', 'expires_at', 'created_at', 'updated_at'];
export const ATTACHMENT_COLUMNS = [
  'id', 'attachment_id', 'request_id', 'owner_id', 'playbook_id', 'expected_definition_revision', 'object_key', 'media_type', 'declared_size',
  'actual_size', 'content_sha256', 'status', 'expires_at', 'created_at', 'updated_at',
];
export const DESIGN_MESSAGE_COLUMNS = ['id', 'flow_id', 'created_by', 'user_query', 'ai_summary', 'snapshot_before', 'status', 'reverted_from_message_id', 'error', 'created_at', 'updated_at'];
export const DESIGN_OPERATION_COLUMNS = [
  'id', 'flow_id', 'owner_id', 'query', 'status', 'idempotency_key', 'started_at', 'completed_at', 'error', 'snapshot_before', 'result_preview',
  'applied_message_id', 'lock_version', 'created_at', 'updated_at',
];

/** Columns the checksum reads back as float8: node-pg returns bigint as a string. */
export const FLOAT_COLUMNS = new Set(['declared_size', 'actual_size']);
/** Columns written as jsonb: an array must be stringified, or the driver sends it as a Postgres array. */
const JSON_COLUMNS = new Set([
  'handoff_context', 'handoff_provenance', 'assessment', 'answers', 'response_payload', 'events', 'definition', 'snapshot_before', 'result_preview',
]);

// ---------------------------------------------------------------- assistant

export const buildRequest = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    request_id: sReq(doc.requestId),
    owner_id: sReq(doc.ownerId),
    agent_id: sReq(doc.agentId),
    conversation_id: sReq(doc.conversationId),
    correlation_id: sReq(doc.correlationId),
    operation_kind: sReq(doc.operationKind),
    playbook_id: s(doc.playbookId),
    expected_definition_revision: int(doc.expectedDefinitionRevision),
    context_id: sReq(doc.contextId),
    message_hash: sReq(doc.messageHash),
    original_text: sReq(doc.originalText),
    requested_name: s(doc.requestedName),
    handoff_context: object(doc.handoffContext),
    handoff_provenance: object(doc.handoffProvenance),
    workspace_default_ids: strings(doc.workspaceDefaultIds),
    selected_task_id: s(doc.selectedTaskId),
    execution_id: s(doc.executionId),
    attachment_ids: strings(doc.attachmentIds),
    continuation_id: s(doc.continuationId),
    assessment: object(doc.assessment),
    assessment_version: intMin0(doc.assessmentVersion),
    answers: objects(doc.answers),
    mutation_operation_id: s(doc.mutationOperationId),
    assistant_answer: s(doc.assistantAnswer),
    response_payload: object(doc.responsePayload),
    status: sDefault(doc.status, 'processing'),
    expires_at: expiresAt(doc, id),
    ...stamps(doc, id),
  };
};

export const validateRequest = (row: Row): string | null => firstReason(
  required(row, 'request_id', 'owner_id', 'agent_id', 'conversation_id', 'correlation_id', 'context_id', 'message_hash', 'original_text'),
  oneOf(row.operation_kind, OPERATION_KINDS, 'operation_kind'),
  oneOf(row.status, REQUEST_STATUSES, 'status'),
  min(row, 'expected_definition_revision', 0, true),
);

export const buildOperation = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    operation_id: sReq(doc.operationId),
    playbook_id: sReq(doc.playbookId),
    owner_id: sReq(doc.ownerId),
    request_id: s(doc.requestId),
    operation_kind: sDefault(doc.operationKind, 'construction'),
    origin: sDefault(doc.origin, 'designer'),
    target: sDefault(doc.target, 'canonical'),
    apply_target: sDefault(doc.applyTarget, 'current_playbook'),
    disposition: sDefault(doc.disposition, 'pending'),
    status: sDefault(doc.status, 'queued'),
    base_definition_revision: int(doc.baseDefinitionRevision),
    last_sequence: intMin0(doc.lastSequence),
    events: objects(doc.events),
    event_bytes: intMin0(doc.eventBytes),
    worker_id: sReq(doc.workerId),
    lease_expires_at: d(doc.leaseExpiresAt),
    terminal_at: d(doc.terminalAt),
    committed_revision: int(doc.committedRevision),
    committed_at: d(doc.committedAt),
    reverted_revision: int(doc.revertedRevision),
    reverted_at: d(doc.revertedAt),
    created_playbook_id: s(doc.createdPlaybookId),
    expires_at: expiresAt(doc, id),
    ...stamps(doc, id),
  };
};

export const validateOperation = (row: Row): string | null => firstReason(
  required(row, 'operation_id', 'playbook_id', 'owner_id', 'worker_id'),
  oneOf(row.operation_kind, CONSTRUCTION_KINDS, 'operation_kind'),
  oneOf(row.origin, ORIGINS, 'origin'),
  oneOf(row.target, TARGETS, 'target'),
  oneOf(row.apply_target, APPLY_TARGETS, 'apply_target'),
  oneOf(row.disposition, DISPOSITIONS, 'disposition'),
  oneOf(row.status, OPERATION_STATUSES, 'status'),
  min(row, 'base_definition_revision', 0),
);

export const buildMessage = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    message_id: sReq(doc.messageId),
    request_id: sReq(doc.requestId),
    conversation_id: sReq(doc.conversationId),
    owner_id: sReq(doc.ownerId),
    playbook_id: sReq(doc.playbookId),
    role: sReq(doc.role),
    content: sReq(doc.content),
    operation_id: s(doc.operationId),
    expires_at: expiresAt(doc, id),
    ...stamps(doc, id),
  };
};

export const validateMessage = (row: Row): string | null => firstReason(
  required(row, 'message_id', 'request_id', 'conversation_id', 'owner_id', 'playbook_id', 'content'),
  oneOf(row.role, ROLES, 'role'),
);

export const buildRevision = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  const definition = object(doc.definition);
  if (!definition) throw new BackfillError('definition is not a document', id);
  return {
    id,
    operation_id: sReq(doc.operationId),
    playbook_id: sReq(doc.playbookId),
    owner_id: sReq(doc.ownerId),
    definition_revision: int(doc.definitionRevision),
    definition,
    expires_at: expiresAt(doc, id),
    ...stamps(doc, id),
  };
};

export const validateRevision = (row: Row): string | null => firstReason(
  required(row, 'operation_id', 'playbook_id', 'owner_id'),
  min(row, 'definition_revision', 0),
);

export const buildAttachment = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    attachment_id: sReq(doc.attachmentId),
    request_id: sReq(doc.requestId),
    owner_id: sReq(doc.ownerId),
    playbook_id: sReq(doc.playbookId),
    expected_definition_revision: int(doc.expectedDefinitionRevision),
    object_key: sReq(doc.objectKey),
    media_type: sReq(doc.mediaType),
    declared_size: int(doc.declaredSize),
    actual_size: int(doc.actualSize),
    content_sha256: s(doc.contentSha256),
    status: sDefault(doc.status, 'pending'),
    expires_at: expiresAt(doc, id),
    ...stamps(doc, id),
  };
};

export const validateAttachment = (row: Row): string | null => firstReason(
  required(row, 'attachment_id', 'request_id', 'owner_id', 'playbook_id', 'object_key', 'media_type'),
  oneOf(row.status, ATTACHMENT_STATUSES, 'status'),
  min(row, 'expected_definition_revision', 0),
  min(row, 'declared_size', 1),
  min(row, 'actual_size', 1, true),
);

// ---------------------------------------------------------------- design workspace

/** The graph before a design turn: the three arrays, each defaulting to [] like the Mongoose subdocument. */
const snapshot = (v: unknown): Record<string, unknown> => {
  const source = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { nodes: objects(source.nodes), controlEdges: objects(source.controlEdges), dataBindings: objects(source.dataBindings) };
};

export const buildDesignMessage = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    flow_id: hexId(doc.flowId, 'flowId', id),
    created_by: hexId(doc.createdBy, 'createdBy', id),
    user_query: sReq(doc.userQuery),
    ai_summary: sReq(doc.aiSummary),
    snapshot_before: snapshot(doc.snapshotBefore),
    status: sDefault(doc.status, 'completed'),
    reverted_from_message_id: hexIdOrNull(doc.revertedFromMessageId),
    error: s(doc.error),
    ...stamps(doc, id),
  };
};

export const validateDesignMessage = (row: Row, refs: PlaybookAssistantRefs): string | null => firstReason(
  dangling(refs.flows, row.flow_id, 'flow_id', 'flow gone from PG'),
  oneOf(row.status, DESIGN_MESSAGE_STATUSES, 'status'),
);

/** A revert of a message that was not migrated keeps the revert and loses the link, as ON DELETE SET NULL does. */
export const withLiveRevertedMessage = (row: Row, refs: PlaybookAssistantRefs): Row =>
  row.reverted_from_message_id !== null && !refs.designMessages.has(String(row.reverted_from_message_id)) ? { ...row, reverted_from_message_id: null } : row;

export const buildDesignOperation = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    flow_id: hexId(doc.flowId, 'flowId', id),
    owner_id: hexId(doc.ownerId, 'ownerId', id),
    query: sReq(doc.query),
    status: sDefault(doc.status, 'queued'),
    idempotency_key: typeof doc.idempotencyKey === 'string' ? stripNul(doc.idempotencyKey) : null,
    started_at: d(doc.startedAt),
    completed_at: d(doc.completedAt),
    error: s(doc.error),
    snapshot_before: object(doc.snapshotBefore),
    result_preview: object(doc.resultPreview),
    applied_message_id: hexIdOrNull(doc.appliedMessageId),
    lock_version: intMin0(doc.lockVersion),
    ...stamps(doc, id),
  };
};

export const validateDesignOperation = (row: Row, refs: PlaybookAssistantRefs): string | null => firstReason(
  dangling(refs.flows, row.flow_id, 'flow_id', 'flow gone from PG'),
  dangling(refs.users, row.owner_id, 'owner_id', 'user gone from PG'),
  required(row, 'query'),
  oneOf(row.status, DESIGN_OPERATION_STATUSES, 'status'),
);

export const withLiveAppliedMessage = (row: Row, refs: PlaybookAssistantRefs): Row =>
  row.applied_message_id !== null && !refs.designMessages.has(String(row.applied_message_id)) ? { ...row, applied_message_id: null } : row;

// ---------------------------------------------------------------- insert

/**
 * INSERT ... ON CONFLICT (id) DO NOTHING. jsonb columns are stringified here so the unit keeps the
 * plain value the checksum compares. A unique violation on another key (a request id held by a row
 * with another _id) is not swallowed: it is recorded as a failure of that row.
 */
export async function insertRow(pool: Queryable, table: string, columns: string[], row: Row): Promise<void> {
  await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    columns.map((c) => (JSON_COLUMNS.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c])),
  );
}

/** SELECT list for the checksum read-back: bigint comes back as float8. */
export const checksumSelect = (columns: string[]): string => columns.map((c) => (FLOAT_COLUMNS.has(c) ? `${c}::float8 AS ${c}` : c)).join(', ');
