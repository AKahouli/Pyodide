import { sql } from 'drizzle-orm';
import {
  boolean,
  type AnyPgColumn,
  char,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const conversationSchema = pgSchema('conversation');

const objectIdCheck = (column: { getSQL(): unknown }) => sql`${column} ~ '^[0-9a-f]{24}$'`;

export const conversations = conversationSchema.table(
  'conversations',
  {
    id: char('id', { length: 24 }).primaryKey(),
    runtimeMode: varchar('runtime_mode', { length: 20 }).notNull().default('standard'),
    runtimePurpose: varchar('runtime_purpose', { length: 30 }).notNull().default('chat'),
    pinnedAgentId: char('pinned_agent_id', { length: 24 }),
    platformCopilotCreationRequestId: text('platform_copilot_creation_request_id'),
    governedCreationRequestId: text('governed_creation_request_id'),
    title: varchar('title', { length: 200 }).notNull().default('New Conversation'),
    createdBy: char('created_by', { length: 24 }).notNull(),
    systemWorkspaceId: char('system_workspace_id', { length: 24 }),
    projectId: char('project_id', { length: 24 }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    messageCount: integer('message_count').notNull().default(0),
    isArchived: boolean('is_archived').notNull().default(false),
    isShared: boolean('is_shared').notNull().default(false),
    sharedFrom: char('shared_from', { length: 24 }),
    initializationStatus: varchar('initialization_status', { length: 30 })
      .notNull()
      .default('ready'),
    branchSeedAttemptId: text('branch_seed_attempt_id'),
    branchRequestId: text('branch_request_id'),
    branchProvenance: jsonb('branch_provenance'),
    governanceContext: jsonb('governance_context'),
    isGroup: boolean('is_group').notNull().default(false),
    isFirstMessage: boolean('is_first_message').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('conversations_id_object_id', objectIdCheck(t.id)),
    check('conversations_runtime_mode', sql`${t.runtimeMode} IN ('standard', 'governed')`),
    check(
      'conversations_runtime_purpose',
      sql`${t.runtimePurpose} IN ('chat', 'platform_copilot')`,
    ),
    check(
      'conversations_initialization_status',
      sql`${t.initializationStatus} IN ('ready', 'pending', 'seeding', 'cleanup_pending')`,
    ),
    check('conversations_message_count_non_negative', sql`${t.messageCount} >= 0`),
    index('idx_conversations_owner_last_message').on(t.createdBy, t.lastMessageAt),
    index('idx_conversations_owner_archived_last_message').on(
      t.createdBy,
      t.isArchived,
      t.lastMessageAt,
    ),
    index('idx_conversations_owner_created').on(t.createdBy, t.createdAt),
    index('idx_conversations_owner_project_last_message').on(
      t.createdBy,
      t.projectId,
      t.lastMessageAt,
    ),
    index('idx_conversations_runtime_purpose').on(t.runtimePurpose),
    index('idx_conversations_initialization_status').on(t.initializationStatus),
    uniqueIndex('uq_conversations_platform_creation_request')
      .on(t.createdBy, t.platformCopilotCreationRequestId)
      .where(sql`${t.platformCopilotCreationRequestId} IS NOT NULL`),
    uniqueIndex('uq_conversations_governed_creation_request')
      .on(t.createdBy, t.governedCreationRequestId)
      .where(sql`${t.governedCreationRequestId} IS NOT NULL`),
    uniqueIndex('uq_conversations_branch_request')
      .on(t.createdBy, t.branchRequestId)
      .where(sql`${t.branchRequestId} IS NOT NULL`),
  ],
);

function orderedIdTable(name: string, columnName: string) {
  return conversationSchema.table(
    name,
    {
      conversationId: char('conversation_id', { length: 24 })
        .notNull()
        .references(() => conversations.id, { onDelete: 'cascade' }),
      position: integer('position').notNull(),
      value: char(columnName, { length: 24 }).notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.conversationId, t.position] }),
      index(`idx_${name}_${columnName}`).on(t.value),
      check(`${name}_position_non_negative`, sql`${t.position} >= 0`),
    ],
  );
}

export const conversationWorkspaces = orderedIdTable('conversation_workspaces', 'workspace_id');
export const conversationSelectedSkills = orderedIdTable(
  'conversation_selected_skills',
  'skill_id',
);
export const conversationTaggedAgents = orderedIdTable('conversation_tagged_agents', 'agent_id');
export const conversationGroupTaggedAgents = orderedIdTable(
  'conversation_group_tagged_agents',
  'agent_id',
);

export const conversationGroupMembers = conversationSchema.table(
  'conversation_group_members',
  {
    conversationId: char('conversation_id', { length: 24 })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: char('user_id', { length: 24 }).notNull(),
    position: integer('position').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    job: text('job'),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    uniqueIndex('uq_conversation_group_members_position').on(t.conversationId, t.position),
    check('conversation_group_members_status', sql`${t.status} IN ('owner', 'member')`),
  ],
);

export const conversationGroupInvites = conversationSchema.table(
  'conversation_group_invites',
  {
    conversationId: char('conversation_id', { length: 24 })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    normalizedEmail: varchar('normalized_email', { length: 320 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull(),
    job: text('job'),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.position] }),
    index('idx_conversation_group_invites_email').on(t.normalizedEmail),
    check('conversation_group_invites_status', sql`${t.status} IN ('Confirmed', 'Guest')`),
  ],
);

export const messages = conversationSchema.table(
  'messages',
  {
    id: char('id', { length: 24 }).primaryKey(),
    conversationId: char('conversation_id', { length: 24 })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: char('sender_id', { length: 24 }),
    parentMessageId: char('parent_message_id', { length: 24 }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' },
    ),
    conversationType: varchar('conversation_type', { length: 10 }).notNull(),
    content: text('content'),
    components: jsonb('components'),
    attachedFileIds: varchar('attached_file_ids', { length: 24 }).array(),
    agentIds: varchar('agent_ids', { length: 24 }).array(),
    memberIds: varchar('member_ids', { length: 24 }).array(),
    modelId: varchar('model_id', { length: 100 }),
    reasoningEffort: varchar('reasoning_effort', { length: 50 }),
    webSearchEnabled: boolean('web_search_enabled').notNull().default(false),
    questionMessageId: char('question_message_id', { length: 24 }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' },
    ),
    answerMessageId: char('answer_message_id', { length: 24 }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' },
    ),
    feedback: varchar('feedback', { length: 10 }),
    feedbackAt: timestamp('feedback_at', { withTimezone: true }),
    isEdited: boolean('is_edited').notNull().default(false),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    isStreaming: boolean('is_streaming').notNull().default(false),
    isComplete: boolean('is_complete').notNull().default(false),
    streamExecutionLeaseId: text('stream_execution_lease_id'),
    streamExecutionLeaseExpiresAt: timestamp('stream_execution_lease_expires_at', {
      withTimezone: true,
    }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    modelRequestTelemetry: jsonb('model_request_telemetry'),
    durationMs: integer('duration_ms'),
    timeToFirstChunk: integer('time_to_first_chunk'),
    timeToFirstToken: integer('time_to_first_token'),
    requestId: text('request_id'),
    guardrailDecision: jsonb('guardrail_decision'),
    interaction: jsonb('interaction'),
    interactions: jsonb('interactions'),
    replayContext: jsonb('replay_context'),
    reliabilityEvaluation: jsonb('reliability_evaluation'),
    correctionWorkflow: jsonb('correction_workflow'),
    reliabilityEvaluationHeartbeatAt: timestamp('reliability_evaluation_heartbeat_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('messages_id_object_id', objectIdCheck(t.id)),
    check('messages_conversation_type', sql`${t.conversationType} IN ('user', 'ai')`),
    check('messages_feedback', sql`${t.feedback} IS NULL OR ${t.feedback} IN ('like', 'dislike')`),
    check(
      'messages_content_length',
      sql`${t.content} IS NULL OR char_length(${t.content}) <= 50000`,
    ),
    check(
      'messages_metrics_non_negative',
      sql`COALESCE(${t.inputTokens}, 0) >= 0 AND COALESCE(${t.outputTokens}, 0) >= 0 AND COALESCE(${t.durationMs}, 0) >= 0 AND COALESCE(${t.timeToFirstChunk}, 0) >= 0 AND COALESCE(${t.timeToFirstToken}, 0) >= 0`,
    ),
    index('idx_messages_conversation_created').on(t.conversationId, t.createdAt),
    index('idx_messages_conversation_type').on(t.conversationId, t.conversationType),
    index('idx_messages_question_type_created').on(
      t.questionMessageId,
      t.conversationType,
      t.createdAt,
    ),
    index('idx_messages_streaming_updated').on(t.isStreaming, t.updatedAt),
    index('idx_messages_reliability_heartbeat').on(t.reliabilityEvaluationHeartbeatAt),
    uniqueIndex('uq_messages_request_identity')
      .on(t.conversationId, t.senderId, t.conversationType, t.requestId)
      .where(sql`${t.requestId} IS NOT NULL AND ${t.senderId} IS NOT NULL`),
  ],
);

export const conversationMemberMentions = conversationSchema.table(
  'conversation_member_mentions',
  {
    conversationId: char('conversation_id', { length: 24 })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: char('user_id', { length: 24 }).notNull(),
    position: integer('position').notNull(),
    messageId: char('message_id', { length: 24 })
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId, t.position] }),
    index('idx_conversation_member_mentions_message').on(t.messageId),
  ],
);

export const reports = conversationSchema.table(
  'reports',
  {
    id: char('id', { length: 24 }).primaryKey(),
    conversationId: char('conversation_id', { length: 24 }).notNull(),
    messageId: char('message_id', { length: 24 }).notNull(),
    userId: char('user_id', { length: 24 }).notNull(),
    reason: varchar('reason', { length: 40 }).notNull(),
    description: varchar('description', { length: 2000 }).notNull(),
    source: varchar('source', { length: 30 }).notNull().default('user'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    adminNotes: varchar('admin_notes', { length: 2000 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reports_id_object_id', objectIdCheck(t.id)),
    check(
      'reports_reason',
      sql`${t.reason} IN ('inaccurate', 'wrong_information', 'offensive', 'out_of_context', 'hallucination', 'other')`,
    ),
    check('reports_source', sql`${t.source} IN ('user', 'system_correction')`),
    check('reports_status', sql`${t.status} IN ('pending', 'reviewed', 'resolved')`),
    uniqueIndex('uq_reports_user_message').on(t.userId, t.messageId),
    uniqueIndex('uq_reports_system_correction')
      .on(t.messageId, t.source)
      .where(sql`${t.source} = 'system_correction'`),
    index('idx_reports_status_created').on(t.status, t.createdAt),
    index('idx_reports_conversation').on(t.conversationId),
  ],
);

export const sharedConversations = conversationSchema.table(
  'shared_conversations',
  {
    id: char('id', { length: 24 }).primaryKey(),
    originalConversationId: char('original_conversation_id', { length: 24 })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    sharedBy: char('shared_by', { length: 24 }).notNull(),
    shareType: varchar('share_type', { length: 10 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    messages: jsonb('messages'),
    accessToken: text('access_token'),
    recipientEmails: text('recipient_emails').array(),
    forkedConversationIds: varchar('forked_conversation_ids', { length: 24 }).array(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    isRevoked: boolean('is_revoked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('shared_conversations_id_object_id', objectIdCheck(t.id)),
    check('shared_conversations_type', sql`${t.shareType} IN ('public', 'private')`),
    check('shared_conversations_view_count_non_negative', sql`${t.viewCount} >= 0`),
    uniqueIndex('uq_shared_conversations_access_token')
      .on(t.accessToken)
      .where(sql`${t.accessToken} IS NOT NULL`),
    index('idx_shared_conversations_owner_created').on(t.sharedBy, t.createdAt),
    index('idx_shared_conversations_expires').on(t.expiresAt),
  ],
);

export const conversationPlaybookHandoffs = conversationSchema.table(
  'conversation_playbook_handoffs',
  {
    id: char('id', { length: 24 }).primaryKey(),
    handoffId: uuid('handoff_id').notNull(),
    contractVersion: integer('contract_version').notNull(),
    ownerId: char('owner_id', { length: 24 }).notNull(),
    sourceConversationId: char('source_conversation_id', { length: 24 }).notNull(),
    targetMessageId: char('target_message_id', { length: 24 }).notNull(),
    displayedAnswerVersion: text('displayed_answer_version').notNull(),
    creationRequestId: text('creation_request_id').notNull(),
    creationRequestFingerprint: text('creation_request_fingerprint').notNull(),
    clientBranchSelectionFingerprint: text('client_branch_selection_fingerprint').notNull(),
    canonicalPathFingerprint: text('canonical_path_fingerprint').notNull(),
    contextFingerprint: text('context_fingerprint').notNull(),
    canonicalSelectedAnswerIds: varchar('canonical_selected_answer_ids', { length: 24 })
      .array()
      .notNull(),
    platformConversationId: char('platform_conversation_id', { length: 24 }).notNull(),
    context: jsonb('context').notNull(),
    candidateBindings: jsonb('candidate_bindings').notNull(),
    defaultWorkspaceIds: varchar('default_workspace_ids', { length: 24 }).array().notNull(),
    status: varchar('status', { length: 20 }).notNull().default('prepared'),
    boundTurnRequestId: text('bound_turn_request_id'),
    boundPromptHash: text('bound_prompt_hash'),
    boundUserMessageId: char('bound_user_message_id', { length: 24 }),
    assistantRequestId: text('assistant_request_id'),
    preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull(),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('conversation_playbook_handoffs_id_object_id', objectIdCheck(t.id)),
    check('conversation_playbook_handoffs_contract', sql`${t.contractVersion} = 1`),
    check(
      'conversation_playbook_handoffs_status',
      sql`${t.status} IN ('prepared', 'bound', 'consumed')`,
    ),
    uniqueIndex('uq_conversation_playbook_handoffs_handoff_id').on(t.handoffId),
    uniqueIndex('uq_conversation_playbook_handoffs_owner_request').on(
      t.ownerId,
      t.creationRequestId,
    ),
    index('idx_conversation_playbook_handoffs_platform_status').on(
      t.ownerId,
      t.platformConversationId,
      t.status,
    ),
    index('idx_conversation_playbook_handoffs_expires').on(t.expiresAt),
  ],
);
