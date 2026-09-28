/**
 * Mongo → Postgres mapping of the legacy Conversation v1 history: conversations (with their ordered
 * child rows and group mentions), messages (with their self references held back) and reports.
 * Kept apart from the runner so a spec can drive the same mapping, validation, statements and
 * checksum projection with fabricated documents (group chats, branches, governed conversations,
 * dangling references, NUL bytes) that the dev data only partly exercises.
 *
 * Rows use the Postgres column names. A conversation is planned as its row plus its ordered child
 * rows; its group mentions are written by a later pass because they point at messages. A message is
 * planned without `parent_message_id`, `question_message_id` and `answer_message_id`: those are
 * filled by a second pass once every message exists. The checksum projection (`*Unit`) keeps the
 * scalar columns as they are and replaces message text and every message jsonb payload with a
 * sha256 of its canonical form, so a run compares megabytes of components without holding them.
 *
 * Nothing here prints document content: reasons, anomalies and buckets are fixed labels, the
 * runner adds ids.
 */
import { createHash } from 'node:crypto';
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';
import { stableStringify } from './reconcile';

export type Row = Record<string, unknown>;

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }>;
}

/** Ids present in Postgres (plus, for conversations and messages, the ids this run accepted). */
export interface ConversationV1Refs {
  /** identity.users: a conversation needs its owner (data policy: no owner, no conversation). */
  users: ReadonlySet<string>;
  /** workspace.workspaces: validated FKs on system_workspace_id (SET NULL) and conversation_workspaces (CASCADE). */
  workspaces: ReadonlySet<string>;
  /** project.projects: validated FK on project_id (SET NULL). */
  projects: ReadonlySet<string>;
  /** conversation.conversations: messages and mentions reference it with a CASCADE FK. */
  conversations: ReadonlySet<string>;
  /** conversation.messages: message self references (SET NULL) and mentions (CASCADE). */
  messages: ReadonlySet<string>;
}

/** Targets of references without a foreign key: copied as is, counted when they point nowhere. */
export interface LooseRefs {
  users: ReadonlySet<string>;
  agents: ReadonlySet<string>;
  skills: ReadonlySet<string>;
  documents: ReadonlySet<string>;
  conversations: ReadonlySet<string>;
  messages: ReadonlySet<string>;
}

// ---------------------------------------------------------------- value helpers

const HEX = /^[0-9a-f]{24}$/;
const INT4_MAX = 2147483647;

const d = (v: unknown): Date | null => {
  if (v == null || v === '') return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): MongoDoc | null => (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? (v as MongoDoc) : null);
const list = (v: unknown): MongoDoc[] => (Array.isArray(v) ? v.map(obj).filter((x): x is MongoDoc => x !== null) : []);
/** Code points, which is what varchar(n) and char_length() count. */
const chars = (value: string): number => (value.length <= 1 ? value.length : [...value].length);

export const hexOrNull = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const raw = String(v).toLowerCase();
  return HEX.test(raw) ? raw : null;
};
const hexReq = (v: unknown, label: string, docId: string): string => {
  const id = hexOrNull(v);
  if (!id) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return id;
};
const idOf = (doc: MongoDoc): string => hexReq(doc._id, '_id', String(doc._id));

/** Text with U+0000 removed (Postgres rejects it); the removal is recorded. */
const text = (v: unknown, anomalies: string[], label: string): string | null => {
  if (v == null) return null;
  const raw = String(v);
  if (!raw.includes('\u0000')) return raw;
  anomalies.push(`${label}: NUL removed`);
  return stripNul(raw);
};

/** An optional id: a malformed value is dropped and recorded, never silently. */
const optId = (v: unknown, anomalies: string[], label: string): string | null => {
  if (v == null || v === '') return null;
  const id = hexOrNull(v);
  if (!id) anomalies.push(`${label}: malformed id dropped`);
  return id;
};

/** An ordered id list; malformed entries are dropped and recorded. */
const idList = (v: unknown, anomalies: string[], label: string): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const id = hexOrNull(item);
    if (id) out.push(id);
    else anomalies.push(`${label}: malformed id dropped`);
  }
  return out;
};
/** Like `idList`, but an absent array stays NULL (the message columns keep absent and empty apart). */
const idArrayOrNull = (v: unknown, anomalies: string[], label: string): string[] | null => (Array.isArray(v) ? idList(v, anomalies, label) : null);

/** Integer metric: absent stays null, a fraction is truncated (recorded); range is checked by validate. */
const metric = (v: unknown, anomalies: string[], label: string): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (Number.isInteger(v)) return v;
  anomalies.push(`${label}: fraction truncated`);
  return Math.trunc(v);
};

/**
 * A jsonb payload exactly as the live code would have written it: BSON ObjectIds become their hex
 * string and Dates their ISO string (what JSON.stringify gives the live adapters), undefined and
 * non-finite numbers drop out, and U+0000 is removed (Postgres rejects it in jsonb).
 */
export function jsonValue(v: unknown, anomalies: string[] = [], label = 'json'): unknown {
  if (v === undefined || v === null) return null;
  const serialized = JSON.stringify(v);
  if (serialized === undefined) return null;
  const parsed: unknown = JSON.parse(serialized);
  if (!serialized.includes('\\u0000')) return parsed;
  anomalies.push(`${label}: NUL removed`);
  return stripNul(parsed);
}

const withoutMongooseId = (value: MongoDoc): MongoDoc => {
  const { _id: _ignored, ...rest } = value;
  return rest;
};

/** ObjectId timestamp: the only creation time a document without `createdAt` still carries. */
const objectIdTime = (id: string): Date => new Date(parseInt(id.slice(0, 8), 16) * 1000);

const stamps = (doc: MongoDoc, id: string, anomalies: string[]): { created_at: Date; updated_at: Date } => {
  let createdAt = d(doc.createdAt);
  if (!createdAt) {
    anomalies.push('createdAt missing: ObjectId time used');
    createdAt = objectIdTime(id);
  }
  let updatedAt = d(doc.updatedAt);
  if (!updatedAt) {
    anomalies.push('updatedAt missing: createdAt used');
    updatedAt = createdAt;
  }
  return { created_at: createdAt, updated_at: updatedAt };
};

const oneOf = (value: unknown, allowed: readonly string[], label: string): string | null =>
  allowed.includes(String(value)) ? null : `${label} value is not one of ${allowed.join('|')}`;
const firstReason = (...reasons: Array<string | null>): string | null => reasons.find((r) => r !== null) ?? null;
const maxChars = (value: unknown, max: number, label: string): string | null =>
  typeof value === 'string' && chars(value) > max ? `${label} longer than ${max} characters` : null;
const metricRange = (value: unknown, label: string): string | null =>
  typeof value === 'number' && (value < 0 || value > INT4_MAX) ? `${label} outside 0..${INT4_MAX}` : null;

/** sha256 of the canonical form (keys sorted, dates as ISO, null properties dropped); null stays null. */
export const digest = (value: unknown): string | null =>
  value === null || value === undefined ? null : `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;

const trimId = (v: unknown): unknown => (typeof v === 'string' ? v.trim() : v);

// ---------------------------------------------------------------- columns

export const CONVERSATION_COLUMNS = [
  'id', 'runtime_mode', 'runtime_purpose', 'pinned_agent_id', 'platform_copilot_creation_request_id', 'governed_creation_request_id', 'title',
  'created_by', 'system_workspace_id', 'project_id', 'last_message_at', 'message_count', 'is_archived', 'is_shared', 'shared_from',
  'initialization_status', 'branch_seed_attempt_id', 'branch_request_id', 'branch_provenance', 'governance_context', 'is_group',
  'is_first_message', 'created_at', 'updated_at',
];
export const MESSAGE_COLUMNS = [
  'id', 'conversation_id', 'sender_id', 'conversation_type', 'content', 'components', 'attached_file_ids', 'agent_ids', 'member_ids', 'model_id',
  'reasoning_effort', 'web_search_enabled', 'feedback', 'feedback_at', 'is_edited', 'edited_at', 'is_streaming', 'is_complete',
  'stream_execution_lease_id', 'stream_execution_lease_expires_at', 'input_tokens', 'output_tokens', 'model_request_telemetry', 'duration_ms',
  'time_to_first_chunk', 'time_to_first_token', 'latency_metrics', 'request_id', 'guardrail_decision', 'interaction', 'interactions',
  'replay_context', 'reliability_evaluation', 'correction_workflow', 'reliability_evaluation_heartbeat_at', 'created_at', 'updated_at',
];
export const LINK_COLUMNS = ['id', 'parent_message_id', 'question_message_id', 'answer_message_id'];
export const REPORT_COLUMNS = ['id', 'conversation_id', 'message_id', 'user_id', 'reason', 'description', 'source', 'status', 'admin_notes', 'created_at', 'updated_at'];
const MEMBER_COLUMNS = ['conversation_id', 'user_id', 'position', 'joined_at', 'status', 'job'];
const INVITE_COLUMNS = ['conversation_id', 'position', 'email', 'normalized_email', 'status', 'invited_at', 'job'];
const MENTION_COLUMNS = ['conversation_id', 'user_id', 'position', 'message_id', 'seen_at'];

/** The four ordered id lists of a conversation, each `(conversation_id, position, <value column>)`. */
export const ORDERED_TABLES = [
  { key: 'workspaces', table: 'conversation.conversation_workspaces', column: 'workspace_id' },
  { key: 'selected_skills', table: 'conversation.conversation_selected_skills', column: 'skill_id' },
  { key: 'tagged_agents', table: 'conversation.conversation_tagged_agents', column: 'agent_id' },
  { key: 'group_tagged_agents', table: 'conversation.conversation_group_tagged_agents', column: 'agent_id' },
] as const;
type OrderedKey = (typeof ORDERED_TABLES)[number]['key'];

/** jsonb columns: stringified for the driver, digested by the message projection. */
const JSON_COLUMNS = new Set([
  'branch_provenance', 'governance_context', 'components', 'model_request_telemetry', 'latency_metrics', 'guardrail_decision', 'interaction',
  'interactions', 'replay_context', 'reliability_evaluation', 'correction_workflow',
]);
/** Message columns the checksum compares by digest: the text and every payload. */
const DIGESTED_MESSAGE_COLUMNS = new Set(['content', ...[...JSON_COLUMNS].filter((c) => MESSAGE_COLUMNS.includes(c))]);

export const RUNTIME_MODES = ['standard', 'governed'] as const;
export const RUNTIME_PURPOSES = ['chat', 'platform_copilot'] as const;
export const INITIALIZATION_STATUSES = ['ready', 'pending', 'seeding', 'cleanup_pending'] as const;
export const MEMBER_STATUSES = ['owner', 'member'] as const;
export const INVITE_STATUSES = ['Confirmed', 'Guest'] as const;
export const REPORT_REASONS = ['inaccurate', 'wrong_information', 'offensive', 'out_of_context', 'hallucination', 'other'] as const;
export const REPORT_SOURCES = ['user', 'system_correction'] as const;
export const REPORT_STATUSES = ['pending', 'reviewed', 'resolved'] as const;

// ---------------------------------------------------------------- source fields with no Postgres home

const CONVERSATION_KEYS = new Set([
  '_id', 'runtimeMode', 'runtimePurpose', 'pinnedAgentId', 'platformCopilotCreationRequestId', 'governanceContext', 'governedCreationRequestId',
  'title', 'createdBy', 'workspaces', 'selectedSkills', 'taggedAgentIds', 'systemWorkspaceId', 'projectId', 'lastMessageAt', 'messageCount',
  'isArchived', 'isShared', 'sharedFrom', 'initializationStatus', 'branchSeedAttemptId', 'branchProvenance', 'groupMeta', 'isFirstMessage',
  'createdAt', 'updatedAt',
]);
const GROUP_KEYS = new Set(['isGroup', 'members', 'invitedUsers', 'taggedAgents']);
const MEMBER_KEYS = new Set(['userId', 'joinedAt', 'status', 'job', 'mentions']);
const MENTION_KEYS = new Set(['messageId', 'seenAt']);
const INVITE_KEYS = new Set(['email', 'status', 'invitedAt', 'job']);
const MESSAGE_KEYS = new Set([
  '_id', 'conversationId', 'senderId', 'parentMessageId', 'conversationType', 'content', 'components', 'attachedFileIds', 'agentIds', 'memberIds',
  'modelId', 'reasoningEffort', 'webSearchEnabled', 'questionMessageId', 'answerMessageId', 'feedback', 'feedbackAt', 'isEdited', 'editedAt',
  'isStreaming', 'isComplete', 'streamExecutionLeaseId', 'streamExecutionLeaseExpiresAt', 'inputTokens', 'outputTokens', 'modelRequestTelemetry',
  'durationMs', 'timeToFirstChunk', 'timeToFirstToken', 'latencyMetrics', 'requestId', 'guardrailDecision', 'interaction', 'interactions',
  'replayContext', 'reliabilityEvaluation', 'correctionWorkflow', 'reliabilityEvaluationHeartbeatAt', 'createdAt', 'updatedAt',
]);
const REPORT_KEYS = new Set(['_id', 'conversationId', 'messageId', 'userId', 'reason', 'description', 'source', 'status', 'adminNotes', 'createdAt', 'updatedAt']);

const unknownKeys = (value: MongoDoc | null, known: ReadonlySet<string>, prefix: string): string[] =>
  value ? Object.keys(value).filter((k) => !known.has(k)).map((k) => `${prefix}${k}`) : [];

/**
 * Source paths the mapping does not carry, as `key` or `groupMeta.members[].key` (keys only, no values).
 * `messages` (the embedded id list; messages.conversation_id is the owner) and `__v` show up here
 * by design; the Mongoose `_id` of branch provenance and group sub-documents too.
 */
export function unmappedConversationPaths(doc: MongoDoc): string[] {
  const group = obj(doc.groupMeta);
  const members = list(group?.members);
  return [...new Set([
    ...unknownKeys(doc, CONVERSATION_KEYS, ''),
    ...unknownKeys(group, GROUP_KEYS, 'groupMeta.'),
    ...members.flatMap((m) => unknownKeys(m, MEMBER_KEYS, 'groupMeta.members[].')),
    ...members.flatMap((m) => list(m.mentions).flatMap((mm) => unknownKeys(mm, MENTION_KEYS, 'groupMeta.members[].mentions[].'))),
    ...list(group?.invitedUsers).flatMap((i) => unknownKeys(i, INVITE_KEYS, 'groupMeta.invitedUsers[].')),
    ...(obj(doc.branchProvenance) && '_id' in obj(doc.branchProvenance)! ? ['branchProvenance._id'] : []),
    ...(obj(doc.governanceContext) && '_id' in obj(doc.governanceContext)! ? ['governanceContext._id'] : []),
  ])];
}
export const unmappedMessagePaths = (doc: MongoDoc): string[] => unknownKeys(doc, MESSAGE_KEYS, '');
export const unmappedReportPaths = (doc: MongoDoc): string[] => unknownKeys(doc, REPORT_KEYS, '');

// ---------------------------------------------------------------- conversations

export interface ConversationPlan {
  row: Row;
  ordered: Record<OrderedKey, string[]>;
  /** Group members in source order: `user_id`, `joined_at`, `status`, `job` (position = index). */
  members: Row[];
  /** Group invitations in source order: `email`, `normalized_email`, `status`, `invited_at`, `job`. */
  invites: Row[];
  /** Source oddities the mapping handled (labels, one per occurrence). */
  anomalies: string[];
  /** Optional references set to NULL or dropped because a validated FK would reject them. */
  cleared: string[];
}

export function mapConversation(doc: MongoDoc): ConversationPlan {
  const id = idOf(doc);
  const anomalies: string[] = [];
  const timestamps = stamps(doc, id, anomalies);
  const group = obj(doc.groupMeta);
  const branch = obj(doc.branchProvenance);
  const governance = obj(doc.governanceContext);

  let messageCount = 0;
  if (typeof doc.messageCount === 'number' && Number.isFinite(doc.messageCount)) messageCount = Math.trunc(doc.messageCount);
  else anomalies.push('messageCount missing: 0 used');

  const row: Row = {
    id,
    runtime_mode: typeof doc.runtimeMode === 'string' ? doc.runtimeMode : 'standard',
    runtime_purpose: typeof doc.runtimePurpose === 'string' ? doc.runtimePurpose : 'chat',
    pinned_agent_id: optId(doc.pinnedAgentId, anomalies, 'pinnedAgentId'),
    platform_copilot_creation_request_id: text(doc.platformCopilotCreationRequestId, anomalies, 'platformCopilotCreationRequestId'),
    governed_creation_request_id: text(doc.governedCreationRequestId, anomalies, 'governedCreationRequestId'),
    title: typeof doc.title === 'string' ? text(doc.title, anomalies, 'title') : 'New Conversation',
    created_by: hexReq(doc.createdBy, 'createdBy', id),
    system_workspace_id: optId(doc.systemWorkspaceId, anomalies, 'systemWorkspaceId'),
    project_id: optId(doc.projectId, anomalies, 'projectId'),
    last_message_at: d(doc.lastMessageAt),
    message_count: messageCount,
    is_archived: bool(doc.isArchived, false),
    is_shared: bool(doc.isShared, false),
    shared_from: optId(doc.sharedFrom, anomalies, 'sharedFrom'),
    initialization_status: typeof doc.initializationStatus === 'string' ? doc.initializationStatus : 'ready',
    branch_seed_attempt_id: text(doc.branchSeedAttemptId, anomalies, 'branchSeedAttemptId'),
    // The queryable projection of branchProvenance.requestId (unique per owner).
    branch_request_id: branch && typeof branch.requestId === 'string' ? text(branch.requestId, anomalies, 'branchProvenance.requestId') : null,
    branch_provenance: branch ? jsonValue(withoutMongooseId(branch), anomalies, 'branchProvenance') : null,
    governance_context: governance ? jsonValue(withoutMongooseId(governance), anomalies, 'governanceContext') : null,
    // Mongo kept the flag inside groupMeta; Postgres has it on the row.
    is_group: group?.isGroup === true,
    is_first_message: bool(doc.isFirstMessage, true),
    ...timestamps,
  };

  const members: Row[] = [];
  const memberIndex = new Set<string>();
  for (const member of list(group?.members)) {
    const userId = optId(member.userId, anomalies, 'groupMeta.members[].userId');
    if (!userId) {
      if (member.userId == null) anomalies.push('groupMeta.members[]: member without userId dropped');
      continue;
    }
    // (conversation_id, user_id) is the key: a repeated member keeps its first entry (the mentions pass merges its mentions).
    if (memberIndex.has(userId)) {
      anomalies.push('groupMeta.members[]: repeated member merged into its first entry');
      continue;
    }
    memberIndex.add(userId);
    let joinedAt = d(member.joinedAt);
    if (!joinedAt) {
      anomalies.push('groupMeta.members[].joinedAt missing: conversation createdAt used');
      joinedAt = timestamps.created_at;
    }
    members.push({ user_id: userId, joined_at: joinedAt, status: member.status ?? null, job: text(member.job, anomalies, 'groupMeta.members[].job') });
  }

  const invites: Row[] = [];
  for (const invite of list(group?.invitedUsers)) {
    const email = text(invite.email, anomalies, 'groupMeta.invitedUsers[].email');
    if (!email) {
      anomalies.push('groupMeta.invitedUsers[]: invitation without email dropped');
      continue;
    }
    let invitedAt = d(invite.invitedAt);
    if (!invitedAt) {
      anomalies.push('groupMeta.invitedUsers[].invitedAt missing: conversation createdAt used');
      invitedAt = timestamps.created_at;
    }
    invites.push({
      email,
      // What the live adapter stores next to the email (Mongoose already trimmed and lower-cased it).
      normalized_email: email.trim().toLowerCase(),
      status: invite.status ?? null,
      invited_at: invitedAt,
      job: text(invite.job, anomalies, 'groupMeta.invitedUsers[].job'),
    });
  }

  return {
    row,
    ordered: {
      workspaces: idList(doc.workspaces, anomalies, 'workspaces'),
      selected_skills: idList(doc.selectedSkills, anomalies, 'selectedSkills'),
      tagged_agents: idList(doc.taggedAgentIds, anomalies, 'taggedAgentIds'),
      group_tagged_agents: idList(group?.taggedAgents, anomalies, 'groupMeta.taggedAgents'),
    },
    members,
    invites,
    anomalies,
    cleared: [],
  };
}

/**
 * Optional references behind a validated foreign key are cleared when their target is gone,
 * exactly what the keys' ON DELETE actions would have done: system_workspace_id and project_id
 * become NULL (SET NULL); a conversation_workspaces entry is dropped (CASCADE) and the
 * remaining positions close up. Every clearing is recorded in `cleared`.
 */
export function withLiveReferences(plan: ConversationPlan, refs: Pick<ConversationV1Refs, 'workspaces' | 'projects'>): ConversationPlan {
  const cleared: string[] = [];
  const row = { ...plan.row };
  if (row.system_workspace_id !== null && !refs.workspaces.has(String(row.system_workspace_id))) {
    row.system_workspace_id = null;
    cleared.push('conversations.system_workspace_id (workspace not in Postgres)');
  }
  if (row.project_id !== null && !refs.projects.has(String(row.project_id))) {
    row.project_id = null;
    cleared.push('conversations.project_id (project not in Postgres)');
  }
  const workspaces = plan.ordered.workspaces.filter((id) => {
    if (refs.workspaces.has(id)) return true;
    cleared.push('conversation_workspaces.workspace_id (workspace not in Postgres)');
    return false;
  });
  return { ...plan, row, ordered: { ...plan.ordered, workspaces }, cleared: [...plan.cleared, ...cleared] };
}

/** A reason to skip the conversation (and, with it, its messages), or null. */
export function validateConversation(plan: ConversationPlan, refs: Pick<ConversationV1Refs, 'users'>): string | null {
  const { row } = plan;
  return firstReason(
    refs.users.has(String(row.created_by)) ? null : 'owner (createdBy) is not in identity.users',
    maxChars(row.title, 200, 'title'),
    oneOf(row.runtime_mode, RUNTIME_MODES, 'runtimeMode'),
    oneOf(row.runtime_purpose, RUNTIME_PURPOSES, 'runtimePurpose'),
    oneOf(row.initialization_status, INITIALIZATION_STATUSES, 'initializationStatus'),
    metricRange(row.message_count, 'messageCount'),
    ...plan.members.map((m) => oneOf(m.status, MEMBER_STATUSES, 'groupMeta.members[].status')),
    ...plan.invites.map((i) => oneOf(i.status, INVITE_STATUSES, 'groupMeta.invitedUsers[].status')),
    ...plan.invites.map((i) => maxChars(i.email, 320, 'groupMeta.invitedUsers[].email')),
  );
}

/** References without a foreign key that point at nothing in Postgres: copied as is, counted. */
export function danglingKeptInConversation(plan: ConversationPlan, loose: Pick<LooseRefs, 'users' | 'agents' | 'skills'>): string[] {
  const out: string[] = [];
  const check = (id: unknown, set: ReadonlySet<string>, label: string): void => {
    if (id !== null && id !== undefined && !set.has(String(id))) out.push(label);
  };
  check(plan.row.pinned_agent_id, loose.agents, 'conversations.pinned_agent_id');
  check(plan.row.shared_from, loose.users, 'conversations.shared_from');
  for (const id of plan.ordered.selected_skills) check(id, loose.skills, 'conversation_selected_skills.skill_id');
  for (const id of plan.ordered.tagged_agents) check(id, loose.agents, 'conversation_tagged_agents.agent_id');
  for (const id of plan.ordered.group_tagged_agents) check(id, loose.agents, 'conversation_group_tagged_agents.agent_id');
  for (const member of plan.members) check(member.user_id, loose.users, 'conversation_group_members.user_id');
  return out;
}

/** Checksum projection of a conversation: its row plus its ordered child sets. */
export function conversationUnit(plan: ConversationPlan): Row {
  return {
    ...plan.row,
    ...plan.ordered,
    members: plan.members,
    invites: plan.invites,
  };
}

// ---------------------------------------------------------------- group mentions

interface MentionSource {
  user_id: string;
  message_id: string;
  seen_at: Date | null;
}

export interface MentionPlan {
  conversationId: string;
  /** `user_id`, `position` (per user, from 0), `message_id`, `seen_at`, sorted by user then position. */
  rows: Row[];
  anomalies: string[];
  cleared: string[];
}

/** The mentions of a conversation (projection of `groupMeta.members`), numbered per user like the live `addMention`. */
export function mapMentions(doc: MongoDoc): MentionPlan {
  const conversationId = idOf(doc);
  const anomalies: string[] = [];
  const sources: MentionSource[] = [];
  for (const member of list(obj(doc.groupMeta)?.members)) {
    const userId = optId(member.userId, anomalies, 'groupMeta.members[].userId');
    if (!userId) continue;
    for (const mention of list(member.mentions)) {
      const messageId = optId(mention.messageId, anomalies, 'groupMeta.members[].mentions[].messageId');
      if (messageId) sources.push({ user_id: userId, message_id: messageId, seen_at: d(mention.seenAt) });
      else if (mention.messageId == null) anomalies.push('groupMeta.members[].mentions[]: mention without messageId dropped');
    }
  }
  return { conversationId, rows: numberMentions(sources), anomalies, cleared: [] };
}

/** Mention rows in a stable order (user, then position), the same on both sides of the checksum. */
const byUserThenPosition = (a: Row, b: Row): number =>
  a.user_id === b.user_id ? Number(a.position) - Number(b.position) : String(a.user_id) < String(b.user_id) ? -1 : 1;

const numberMentions = (sources: MentionSource[]): Row[] => {
  const next = new Map<string, number>();
  const rows = sources.map((m) => {
    const position = next.get(m.user_id) ?? 0;
    next.set(m.user_id, position + 1);
    return { user_id: m.user_id, position, message_id: m.message_id, seen_at: m.seen_at };
  });
  return rows.sort(byUserThenPosition);
};

/** A mention whose message is not in Postgres is dropped (its FK cascades); positions close up. */
export function withLiveMentionMessages(plan: MentionPlan, messages: ReadonlySet<string>): MentionPlan {
  const cleared: string[] = [];
  const kept: MentionSource[] = [];
  for (const row of plan.rows) {
    if (messages.has(String(row.message_id))) kept.push({ user_id: String(row.user_id), message_id: String(row.message_id), seen_at: (row.seen_at as Date | null) ?? null });
    else cleared.push('conversation_member_mentions.message_id (message not in Postgres)');
  }
  return { ...plan, rows: numberMentions(kept), cleared: [...plan.cleared, ...cleared] };
}

export const mentionUnit = (plan: MentionPlan): Row => ({ id: plan.conversationId, mentions: plan.rows });

// ---------------------------------------------------------------- messages

export interface MessagePlan {
  row: Row;
  /** Held back from the insert; written by the link pass once every message exists. */
  links: { parent_message_id: string | null; question_message_id: string | null; answer_message_id: string | null };
  anomalies: string[];
  /** Rough payload size, used to bound a batch. */
  bytes: number;
}

export function mapMessage(doc: MongoDoc): MessagePlan {
  const id = idOf(doc);
  const anomalies: string[] = [];
  const json = (v: unknown, label: string): unknown => jsonValue(v, anomalies, label);
  const row: Row = {
    id,
    conversation_id: hexReq(doc.conversationId, 'conversationId', id),
    sender_id: optId(doc.senderId, anomalies, 'senderId'),
    conversation_type: doc.conversationType ?? null,
    content: text(doc.content, anomalies, 'content'),
    components: json(doc.components, 'components'),
    attached_file_ids: idArrayOrNull(doc.attachedFileIds, anomalies, 'attachedFileIds'),
    agent_ids: idArrayOrNull(doc.agentIds, anomalies, 'agentIds'),
    member_ids: idArrayOrNull(doc.memberIds, anomalies, 'memberIds'),
    model_id: text(doc.modelId, anomalies, 'modelId'),
    reasoning_effort: text(doc.reasoningEffort, anomalies, 'reasoningEffort'),
    web_search_enabled: bool(doc.webSearchEnabled, false),
    feedback: doc.feedback ?? null,
    feedback_at: d(doc.feedbackAt),
    is_edited: bool(doc.isEdited, false),
    edited_at: d(doc.editedAt),
    is_streaming: bool(doc.isStreaming, false),
    is_complete: bool(doc.isComplete, false),
    stream_execution_lease_id: text(doc.streamExecutionLeaseId, anomalies, 'streamExecutionLeaseId'),
    stream_execution_lease_expires_at: d(doc.streamExecutionLeaseExpiresAt),
    input_tokens: metric(doc.inputTokens, anomalies, 'inputTokens'),
    output_tokens: metric(doc.outputTokens, anomalies, 'outputTokens'),
    model_request_telemetry: json(doc.modelRequestTelemetry, 'modelRequestTelemetry'),
    duration_ms: metric(doc.durationMs, anomalies, 'durationMs'),
    time_to_first_chunk: metric(doc.timeToFirstChunk, anomalies, 'timeToFirstChunk'),
    time_to_first_token: metric(doc.timeToFirstToken, anomalies, 'timeToFirstToken'),
    latency_metrics: json(doc.latencyMetrics, 'latencyMetrics'),
    request_id: text(doc.requestId, anomalies, 'requestId'),
    guardrail_decision: json(doc.guardrailDecision, 'guardrailDecision'),
    interaction: json(doc.interaction, 'interaction'),
    interactions: json(doc.interactions, 'interactions'),
    replay_context: json(doc.replayContext, 'replayContext'),
    reliability_evaluation: json(doc.reliabilityEvaluation, 'reliabilityEvaluation'),
    correction_workflow: json(doc.correctionWorkflow, 'correctionWorkflow'),
    reliability_evaluation_heartbeat_at: d(doc.reliabilityEvaluationHeartbeatAt),
    ...stamps(doc, id, anomalies),
  };
  let bytes = typeof row.content === 'string' ? row.content.length : 0;
  for (const column of JSON_COLUMNS) if (row[column] != null) bytes += JSON.stringify(row[column]).length;
  return { row, links: mapLinks(doc), anomalies, bytes };
}

/**
 * A reason to skip the message, or null. `skippedConversations` names why a conversation this run
 * refused is missing, so its messages carry that reason.
 */
export function validateMessage(plan: MessagePlan, refs: Pick<ConversationV1Refs, 'conversations'>, skippedConversations: ReadonlyMap<string, string> = new Map()): string | null {
  const { row } = plan;
  const conversationId = String(row.conversation_id);
  let conversation: string | null = null;
  if (!refs.conversations.has(conversationId)) {
    const why = skippedConversations.get(conversationId);
    conversation = why ? `conversation skipped: ${why}` : 'conversation is not in Postgres (not in Mongo conversations, or not migrated)';
  }
  return firstReason(
    conversation,
    oneOf(row.conversation_type, ['user', 'ai'], 'conversationType'),
    maxChars(row.content, 50000, 'content'),
    row.feedback === null ? null : oneOf(row.feedback, ['like', 'dislike'], 'feedback'),
    maxChars(row.model_id, 100, 'modelId'),
    maxChars(row.reasoning_effort, 50, 'reasoningEffort'),
    ...['input_tokens', 'output_tokens', 'duration_ms', 'time_to_first_chunk', 'time_to_first_token'].map((c) => metricRange(row[c], c)),
  );
}

export function danglingKeptInMessage(plan: MessagePlan, loose: Pick<LooseRefs, 'users' | 'agents' | 'documents'>): string[] {
  const out: string[] = [];
  const { row } = plan;
  if (row.sender_id !== null && !loose.users.has(String(row.sender_id))) out.push('messages.sender_id');
  for (const id of (row.attached_file_ids as string[] | null) ?? []) if (!loose.documents.has(id)) out.push('messages.attached_file_ids[]');
  for (const id of (row.agent_ids as string[] | null) ?? []) if (!loose.agents.has(id)) out.push('messages.agent_ids[]');
  for (const id of (row.member_ids as string[] | null) ?? []) if (!loose.users.has(id)) out.push('messages.member_ids[]');
  return out;
}

/**
 * Checksum projection of a message row (built from Mongo, or read back from Postgres): scalars as
 * they are, `content` and every jsonb payload as a digest of its canonical form.
 */
export function messageUnit(row: Row): Row {
  const unit: Row = {};
  for (const column of MESSAGE_COLUMNS) {
    const value = row[column] ?? null;
    unit[column] = DIGESTED_MESSAGE_COLUMNS.has(column) ? digest(value) : column === 'id' || column === 'conversation_id' || column === 'sender_id' ? trimId(value) : value;
  }
  return unit;
}

// ---------------------------------------------------------------- message self references

export interface LinkPlan {
  row: Row;
  cleared: string[];
}

const mapLinks = (doc: MongoDoc): MessagePlan['links'] => ({
  parent_message_id: hexOrNull(doc.parentMessageId),
  question_message_id: hexOrNull(doc.questionMessageId),
  answer_message_id: hexOrNull(doc.answerMessageId),
});

/** The self references of a message (projection of `_id` and the three links). */
export function mapMessageLinks(doc: MongoDoc): LinkPlan {
  return { row: { id: idOf(doc), ...mapLinks(doc) }, cleared: [] };
}

/** A link to a message that is not in Postgres becomes NULL, what its ON DELETE SET NULL key would do. */
export function withLiveLinkTargets(plan: LinkPlan, messages: ReadonlySet<string>): LinkPlan {
  const row = { ...plan.row };
  const cleared: string[] = [];
  for (const column of LINK_COLUMNS.slice(1)) {
    if (row[column] !== null && !messages.has(String(row[column]))) {
      row[column] = null;
      cleared.push(`messages.${column} (message not in Postgres)`);
    }
  }
  return { row, cleared: [...plan.cleared, ...cleared] };
}

/** Whether every link the plan carries is already set in Postgres (a re-run then has nothing to do). */
export const linksInPlace = (plan: LinkPlan, current: Row | undefined): boolean =>
  LINK_COLUMNS.slice(1).every((column) => plan.row[column] === null || (current !== undefined && current[column] !== null && current[column] !== undefined));

export const linkUnit = (row: Row): Row => Object.fromEntries(LINK_COLUMNS.map((c) => [c, trimId(row[c] ?? null)]));

// ---------------------------------------------------------------- reports

export interface ReportPlan {
  row: Row;
  anomalies: string[];
}

export function mapReport(doc: MongoDoc): ReportPlan {
  const id = idOf(doc);
  const anomalies: string[] = [];
  return {
    row: {
      id,
      conversation_id: hexReq(doc.conversationId, 'conversationId', id),
      message_id: hexReq(doc.messageId, 'messageId', id),
      user_id: hexReq(doc.userId, 'userId', id),
      reason: doc.reason ?? null,
      description: text(doc.description, anomalies, 'description') ?? '',
      source: typeof doc.source === 'string' ? doc.source : 'user',
      status: typeof doc.status === 'string' ? doc.status : 'pending',
      admin_notes: text(doc.adminNotes, anomalies, 'adminNotes'),
      ...stamps(doc, id, anomalies),
    },
    anomalies,
  };
}

export const validateReport = (plan: ReportPlan): string | null =>
  firstReason(
    oneOf(plan.row.reason, REPORT_REASONS, 'reason'),
    oneOf(plan.row.source, REPORT_SOURCES, 'source'),
    oneOf(plan.row.status, REPORT_STATUSES, 'status'),
    maxChars(plan.row.description, 2000, 'description'),
    maxChars(plan.row.admin_notes, 2000, 'adminNotes'),
  );

/** Reports hold weak references (no foreign key): the live code keeps a report whose conversation is deleted. */
export function danglingKeptInReport(plan: ReportPlan, loose: Pick<LooseRefs, 'users' | 'conversations' | 'messages'>): string[] {
  const out: string[] = [];
  if (!loose.conversations.has(String(plan.row.conversation_id))) out.push('reports.conversation_id');
  if (!loose.messages.has(String(plan.row.message_id))) out.push('reports.message_id');
  if (!loose.users.has(String(plan.row.user_id))) out.push('reports.user_id');
  return out;
}

export const reportUnit = (row: Row): Row => Object.fromEntries(REPORT_COLUMNS.map((c) => [c, ['id', 'conversation_id', 'message_id', 'user_id'].includes(c) ? trimId(row[c]) : (row[c] ?? null)]));

// ---------------------------------------------------------------- statements

/** Postgres caps a statement at 65535 parameters; stay well below. */
const MAX_PARAMS = 30000;

const param = (column: string, value: unknown): unknown => (JSON_COLUMNS.has(column) && value !== null && value !== undefined ? JSON.stringify(value) : (value ?? null));

/**
 * Multi-row INSERT in parameter-bounded chunks. `conflict` is the ON CONFLICT target; only the
 * primary key is swallowed, any other unique violation fails the statement (and is reported).
 * Returns the ids of `returning` (or the row count as ids-less entries).
 */
export async function insertRows(db: Queryable, table: string, columns: string[], rows: Row[], conflict: string, returning?: string): Promise<{ count: number; returned: string[] }> {
  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  let count = 0;
  const returned: string[] = [];
  for (let offset = 0; offset < rows.length; offset += perStatement) {
    const chunk = rows.slice(offset, offset + perStatement);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => `(${columns.map((column) => {
      values.push(param(column, row[column]));
      return `$${values.length}`;
    }).join(', ')})`);
    const result = await db.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT ${conflict} DO NOTHING${returning ? ` RETURNING ${returning}` : ''}`,
      values,
    );
    count += result.rowCount ?? 0;
    if (returning) for (const r of result.rows) returned.push(String(r[returning]).trim());
  }
  return { count, returned };
}

/**
 * Conversations and their ordered child rows, in the caller's transaction. Children are written
 * only for conversations this statement inserted, never next to a row that was already there.
 */
export async function writeConversations(db: Queryable, plans: ConversationPlan[]): Promise<number> {
  const { returned } = await insertRows(db, 'conversation.conversations', CONVERSATION_COLUMNS, plans.map((p) => p.row), '(id)', 'id');
  const fresh = new Set(returned);
  const mine = plans.filter((p) => fresh.has(String(p.row.id)));
  for (const { key, table, column } of ORDERED_TABLES) {
    const rows = mine.flatMap((p) => p.ordered[key].map((value, position) => ({ conversation_id: p.row.id, position, [column]: value })));
    if (rows.length) await insertRows(db, table, ['conversation_id', 'position', column], rows, '(conversation_id, position)');
  }
  const members = mine.flatMap((p) => p.members.map((m, position) => ({ ...m, conversation_id: p.row.id, position })));
  if (members.length) await insertRows(db, 'conversation.conversation_group_members', MEMBER_COLUMNS, members, '(conversation_id, user_id)');
  const invites = mine.flatMap((p) => p.invites.map((i, position) => ({ ...i, conversation_id: p.row.id, position })));
  if (invites.length) await insertRows(db, 'conversation.conversation_group_invites', INVITE_COLUMNS, invites, '(conversation_id, position)');
  return fresh.size;
}

export async function writeMessages(db: Queryable, plans: MessagePlan[]): Promise<number> {
  return (await insertRows(db, 'conversation.messages', MESSAGE_COLUMNS, plans.map((p) => p.row), '(id)')).count;
}

/** Fills the self references that are still NULL; a link Postgres already holds is never overwritten. */
export async function writeLinks(db: Queryable, plans: LinkPlan[]): Promise<number> {
  const column = (name: string): Array<string | null> => plans.map((p) => (p.row[name] as string | null) ?? null);
  const result = await db.query(
    `UPDATE conversation.messages m SET
       parent_message_id = COALESCE(m.parent_message_id, v.parent_message_id),
       question_message_id = COALESCE(m.question_message_id, v.question_message_id),
       answer_message_id = COALESCE(m.answer_message_id, v.answer_message_id)
     FROM unnest($1::char(24)[], $2::char(24)[], $3::char(24)[], $4::char(24)[]) AS v(id, parent_message_id, question_message_id, answer_message_id)
     WHERE m.id = v.id`,
    [column('id'), column('parent_message_id'), column('question_message_id'), column('answer_message_id')],
  );
  return result.rowCount ?? 0;
}

export async function writeMentions(db: Queryable, plans: MentionPlan[]): Promise<number> {
  const rows = plans.flatMap((p) => p.rows.map((r) => ({ ...r, conversation_id: p.conversationId })));
  return rows.length ? (await insertRows(db, 'conversation.conversation_member_mentions', MENTION_COLUMNS, rows, '(conversation_id, user_id, position)')).count : 0;
}

export async function writeReports(db: Queryable, plans: ReportPlan[]): Promise<number> {
  return (await insertRows(db, 'conversation.reports', REPORT_COLUMNS, plans.map((p) => p.row), '(id)')).count;
}

// ---------------------------------------------------------------- read-back for the checksum

const byId = (rows: Row[], key = 'id'): Map<string, Row[]> => {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const id = String(row[key]).trim();
    const bucket = out.get(id);
    if (bucket) bucket.push(row);
    else out.set(id, [row]);
  }
  return out;
};

/** Conversations as `conversationUnit` projects them, rebuilt from Postgres rows. */
export async function readConversationUnits(db: Queryable, ids: string[]): Promise<Map<string, Row>> {
  const base = (await db.query(`SELECT ${CONVERSATION_COLUMNS.join(', ')} FROM conversation.conversations WHERE id = ANY($1::char(24)[])`, [ids])).rows;
  const ordered = await Promise.all(
    ORDERED_TABLES.map(async ({ table, column }) => byId((await db.query(`SELECT conversation_id, ${column} AS value FROM ${table} WHERE conversation_id = ANY($1::char(24)[]) ORDER BY conversation_id, position`, [ids])).rows, 'conversation_id')),
  );
  const members = byId((await db.query('SELECT conversation_id, user_id, joined_at, status, job FROM conversation.conversation_group_members WHERE conversation_id = ANY($1::char(24)[]) ORDER BY conversation_id, position', [ids])).rows, 'conversation_id');
  const invites = byId((await db.query('SELECT conversation_id, email, normalized_email, status, invited_at, job FROM conversation.conversation_group_invites WHERE conversation_id = ANY($1::char(24)[]) ORDER BY conversation_id, position', [ids])).rows, 'conversation_id');
  const out = new Map<string, Row>();
  for (const row of base) {
    const id = String(row.id).trim();
    const unit: Row = { ...row };
    for (const column of ['id', 'pinned_agent_id', 'created_by', 'system_workspace_id', 'project_id', 'shared_from']) unit[column] = trimId(row[column]);
    ORDERED_TABLES.forEach(({ key }, i) => {
      unit[key] = (ordered[i].get(id) ?? []).map((r) => String(r.value).trim());
    });
    unit.members = (members.get(id) ?? []).map((m) => ({ user_id: String(m.user_id).trim(), joined_at: m.joined_at, status: m.status, job: m.job }));
    unit.invites = (invites.get(id) ?? []).map((i) => ({ email: i.email, normalized_email: i.normalized_email, status: i.status, invited_at: i.invited_at, job: i.job }));
    out.set(id, unit);
  }
  return out;
}

export async function readMessageUnits(db: Queryable, ids: string[]): Promise<Map<string, Row>> {
  const rows = (await db.query(`SELECT ${MESSAGE_COLUMNS.join(', ')} FROM conversation.messages WHERE id = ANY($1::char(24)[])`, [ids])).rows;
  return new Map(rows.map((row) => [String(row.id).trim(), messageUnit(row)]));
}

export async function readLinkUnits(db: Queryable, ids: string[]): Promise<Map<string, Row>> {
  const rows = (await db.query(`SELECT ${LINK_COLUMNS.join(', ')} FROM conversation.messages WHERE id = ANY($1::char(24)[])`, [ids])).rows;
  return new Map(rows.map((row) => [String(row.id).trim(), linkUnit(row)]));
}

export async function readMentionUnits(db: Queryable, ids: string[]): Promise<Map<string, Row>> {
  const rows = (await db.query('SELECT conversation_id, user_id, position, message_id, seen_at FROM conversation.conversation_member_mentions WHERE conversation_id = ANY($1::char(24)[]) ORDER BY conversation_id, user_id, position', [ids])).rows;
  const grouped = byId(rows, 'conversation_id');
  return new Map([...grouped].map(([id, list]) => [
    id,
    { id, mentions: list.map((r) => ({ user_id: String(r.user_id).trim(), position: r.position, message_id: String(r.message_id).trim(), seen_at: r.seen_at })).sort(byUserThenPosition) },
  ]));
}

export async function readReportUnits(db: Queryable, ids: string[]): Promise<Map<string, Row>> {
  const rows = (await db.query(`SELECT ${REPORT_COLUMNS.join(', ')} FROM conversation.reports WHERE id = ANY($1::char(24)[])`, [ids])).rows;
  return new Map(rows.map((row) => [String(row.id).trim(), reportUnit(row)]));
}
