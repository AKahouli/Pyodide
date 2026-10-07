import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

/**
 * Playbook-flow tables (roadmap P5, migration 0040_playbook.sql): definitions, executions and their
 * satellites, the design and assistant workspaces, replay baselines and evaluations. Document-shaped
 * data stays jsonb next to promoted columns; see the migration header for the foreign-key policy.
 */
export const playbookSchema = pgSchema('playbook');

type Json = Record<string, unknown>;
const jsonObject = (name: string) => jsonb(name).$type<Json>();
const jsonArray = (name: string) => jsonb(name).$type<Json[]>().notNull().default([]);
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------- definitions

export const playbookFlows = playbookSchema.table(
  'flows',
  {
    id: objectId('id').primaryKey(),
    ownerId: objectId('owner_id').notNull(),
    assistantOperationId: text('assistant_operation_id'),
    generationProvenance: jsonObject('generation_provenance'),
    schemaVersion: integer('schema_version').notNull().default(1),
    definitionRevision: integer('definition_revision').notNull().default(0),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    triggerConfig: jsonObject('trigger_config'),
    settings: jsonObject('settings').notNull().default({ recursionLimit: 25, maxParallelism: 5 }),
    hitlPolicy: jsonObject('hitl_policy').notNull().default({}),
    hitlBlockers: jsonArray('hitl_blockers'),
    nodes: jsonArray('nodes'),
    controlEdges: jsonArray('control_edges'),
    dataBindings: jsonArray('data_bindings'),
    designSettings: jsonObject('design_settings'),
    isFavorite: boolean('is_favorite').notNull().default(false),
    reflectionEnabled: boolean('reflection_enabled').notNull().default(false),
    advisorScoringMode: varchar('advisor_scoring_mode', { length: 12 }).notNull().default('llm'),
    advisorAutopilotEnabled: boolean('advisor_autopilot_enabled').notNull().default(false),
    advisorAutopilotTargetScore: doublePrecision('advisor_autopilot_target_score'),
    advisorAutopilotMaxTurns: integer('advisor_autopilot_max_turns'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_flows_name', sql`char_length(${t.name}) >= 2`),
    check('playbook_flows_advisor_scoring_mode', sql`${t.advisorScoringMode} IN ('llm','heuristic')`),
    uniqueIndex('uq_playbook_flows_owner_name').on(t.ownerId, t.name),
    index('idx_playbook_flows_owner_updated').on(t.ownerId, t.updatedAt.desc()),
    uniqueIndex('uq_playbook_flows_assistant_operation').on(t.assistantOperationId).where(sql`${t.assistantOperationId} IS NOT NULL`),
    // The connector action sync finds the flows whose nodes bind a connector by containment.
    index('idx_playbook_flows_nodes').using('gin', t.nodes.op('jsonb_path_ops')),
    index('idx_playbook_flows_trigger_kind').on(sql`(${t.triggerConfig} ->> 'kind')`).where(sql`${t.triggerConfig} IS NOT NULL`),
  ],
);

export const playbookFlowWorkspaces = playbookSchema.table(
  'flow_workspaces',
  {
    flowId: objectId('flow_id').notNull(),
    workspaceId: objectId('workspace_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.flowId, t.workspaceId] }),
    index('idx_playbook_flow_workspaces_workspace').on(t.workspaceId),
  ],
);

export const playbookSharedPlaybooks = playbookSchema.table(
  'shared_playbooks',
  {
    id: objectId('id').primaryKey(),
    playbookId: objectId('playbook_id').notNull(),
    sharedBy: objectId('shared_by').notNull(),
    sharedWith: objectId('shared_with').notNull(),
    permission: varchar('permission', { length: 8 }).notNull().default('read'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_shared_playbooks_permission', sql`${t.permission} IN ('read','write')`),
    uniqueIndex('uq_playbook_shared_playbooks_recipient').on(t.playbookId, t.sharedWith),
    index('idx_playbook_shared_playbooks_with').on(t.sharedWith, t.createdAt.desc()),
    index('idx_playbook_shared_playbooks_by').on(t.sharedBy),
  ],
);

export const playbookNodeTemplates = playbookSchema.table(
  'node_templates',
  {
    id: objectId('id').primaryKey(),
    key: varchar('key', { length: 120 }).notNull(),
    nodeType: varchar('node_type', { length: 20 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    description: varchar('description', { length: 600 }),
    icon: varchar('icon', { length: 80 }),
    color: varchar('color', { length: 40 }),
    category: varchar('category', { length: 80 }).notNull(),
    inputPorts: jsonArray('input_ports'),
    outputPorts: jsonArray('output_ports'),
    promptTemplate: text('prompt_template').notNull().default(''),
    recommendedAgentTypeSlug: text('recommended_agent_type_slug'),
    requiredToolNames: text('required_tool_names').array().notNull().default([]),
    assignedAgentId: text('assigned_agent_id'),
    selectedAction: text('selected_action'),
    iteratorConfig: jsonObject('iterator_config'),
    enabled: boolean('enabled').notNull().default(true),
    routerConfig: jsonObject('router_config'),
    humanApprovalConfig: jsonObject('human_approval_config'),
    retryPolicy: jsonObject('retry_policy'),
    modelId: text('model_id'),
    version: integer('version').notNull().default(1),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    createdBy: objectId('created_by'),
    updatedBy: objectId('updated_by'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_node_templates_node_type', sql`${t.nodeType} IN ('agent','action','evaluation','iterator','router','human_approval')`),
    check('playbook_node_templates_version', sql`${t.version} >= 1`),
    uniqueIndex('uq_playbook_node_templates_key').on(t.key),
    index('idx_playbook_node_templates_category').on(t.category, t.enabled),
    index('idx_playbook_node_templates_enabled').on(t.enabled, t.title),
  ],
);

export const playbookPromptTemplates = playbookSchema.table(
  'prompt_templates',
  {
    id: objectId('id').primaryKey(),
    key: varchar('key', { length: 120 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    category: varchar('category', { length: 80 }).notNull(),
    description: varchar('description', { length: 600 }),
    systemTemplate: text('system_template').notNull().default(''),
    userTemplate: text('user_template').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    isBuiltIn: boolean('is_built_in').notNull().default(true),
    createdBy: objectId('created_by'),
    updatedBy: objectId('updated_by'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_prompt_templates_version', sql`${t.version} >= 1`),
    uniqueIndex('uq_playbook_prompt_templates_key').on(t.key),
    index('idx_playbook_prompt_templates_category').on(t.category, t.enabled),
  ],
);

// ---------------------------------------------------------------- executions

export const playbookExecutions = playbookSchema.table(
  'executions',
  {
    id: objectId('id').primaryKey(),
    flowId: objectId('flow_id').notNull(),
    ownerId: objectId('owner_id').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    error: text('error'),
    recursionLimit: integer('recursion_limit').notNull().default(25),
    maxParallelism: integer('max_parallelism').notNull().default(5),
    playbookExecutionSettings: jsonObject('playbook_execution_settings'),
    plannerSnapshot: jsonObject('planner_snapshot'),
    inputContext: jsonObject('input_context'),
    snapshot: jsonObject('snapshot'),
    idempotencyKey: text('idempotency_key'),
    pendingApproval: jsonObject('pending_approval'),
    hitlEvents: jsonArray('hitl_events'),
    queuePosition: integer('queue_position').notNull().default(0),
    threadId: text('thread_id'),
    singleStepTaskId: text('single_step_task_id'),
    advisorAutopilotEnabled: boolean('advisor_autopilot_enabled').notNull().default(false),
    advisorAutopilotTargetScore: doublePrecision('advisor_autopilot_target_score'),
    advisorAutopilotMaxTurns: integer('advisor_autopilot_max_turns'),
    reflectionEnabled: boolean('reflection_enabled').notNull().default(false),
    advisorScoringMode: varchar('advisor_scoring_mode', { length: 12 }).notNull().default('llm'),
    seededTaskOutputs: jsonArray('seeded_task_outputs'),
    executionMode: varchar('execution_mode', { length: 16 }).notNull().default('live'),
    stepExecutionModes: jsonObject('step_execution_modes').notNull().default({}),
    replayPlanningByTask: jsonObject('replay_planning_by_task').notNull().default({}),
    modelIdOverride: text('model_id_override'),
    replaySource: jsonObject('replay_source'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_executions_status', sql`${t.status} IN ('queued','running','pending_approval','completed','failed','cancelled')`),
    check('playbook_executions_advisor_scoring_mode', sql`${t.advisorScoringMode} IN ('llm','heuristic')`),
    check('playbook_executions_execution_mode', sql`${t.executionMode} IN ('live','inherit','replay_strict','replay_flex','replay_adaptive')`),
    index('idx_playbook_executions_flow_created').on(t.flowId, t.createdAt.desc()),
    index('idx_playbook_executions_owner_status').on(t.ownerId, t.status),
    index('idx_playbook_executions_owner_status_created').on(t.ownerId, t.status, t.createdAt),
    index('idx_playbook_executions_owner_idempotency').on(t.ownerId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('idx_playbook_executions_queued').on(t.ownerId, t.createdAt).where(sql`${t.status} = 'queued'`),
    index('idx_playbook_executions_running').on(t.startedAt).where(sql`${t.status} = 'running'`),
  ],
);

export const playbookTaskResults = playbookSchema.table(
  'task_results',
  {
    id: objectId('id').primaryKey(),
    executionId: objectId('execution_id').notNull(),
    taskId: text('task_id').notNull(),
    parentTaskId: text('parent_task_id'),
    runtimeSubgraphId: text('runtime_subgraph_id'),
    generatedLocalNodeId: text('generated_local_node_id'),
    generatedNodeTitle: text('generated_node_title'),
    iteration: integer('iteration').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    output: jsonb('output').$type<unknown>(),
    displayText: text('display_text'),
    outputs: jsonObject('outputs'),
    artifacts: jsonb('artifacts').$type<Json[] | null>(),
    components: jsonb('components').$type<Json[] | null>(),
    iteratorIterations: jsonb('iterator_iterations').$type<Json[] | null>(),
    error: text('error'),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    toolTrace: jsonArray('tool_trace'),
    reasoningChain: jsonArray('reasoning_chain'),
    llmPromptTrace: jsonArray('llm_prompt_trace'),
    usage: jsonObject('usage'),
    semanticMatch: jsonObject('semantic_match'),
    traceMetadata: jsonObject('trace_metadata').notNull().default({}),
    judgeStatus: varchar('judge_status', { length: 12 }).notNull().default('idle'),
    judgeResult: jsonObject('judge_result'),
    judgeScoringMode: varchar('judge_scoring_mode', { length: 12 }),
    judgeError: text('judge_error'),
    judgeHistory: jsonArray('judge_history'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_task_results_status', sql`${t.status} IN ('pending','running','interrupted','completed','failed','skipped','cancelled')`),
    check('playbook_task_results_judge_status', sql`${t.judgeStatus} IN ('idle','evaluating','evaluated','failed')`),
    check('playbook_task_results_judge_scoring_mode', sql`${t.judgeScoringMode} IS NULL OR ${t.judgeScoringMode} IN ('llm','heuristic')`),
    uniqueIndex('uq_playbook_task_results_task').on(t.executionId, t.taskId, t.iteration),
    index('idx_playbook_task_results_subgraph').on(t.executionId, t.runtimeSubgraphId).where(sql`${t.runtimeSubgraphId} IS NOT NULL`),
  ],
);

export const playbookRouterDecisions = playbookSchema.table(
  'router_decisions',
  {
    id: objectId('id').primaryKey(),
    executionId: objectId('execution_id').notNull(),
    routerNodeId: text('router_node_id').notNull(),
    iteration: integer('iteration').notNull().default(0),
    label: text('label').notNull(),
    decidedAt: ts('decided_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_playbook_router_decisions_execution').on(t.executionId, t.decidedAt),
    index('idx_playbook_router_decisions_router').on(t.executionId, t.routerNodeId, t.iteration),
  ],
);

export const playbookDynamicReasoningAttempts = playbookSchema.table(
  'dynamic_reasoning_attempts',
  {
    id: objectId('id').primaryKey(),
    executionId: objectId('execution_id').notNull(),
    flowId: objectId('flow_id').notNull(),
    parentTaskId: text('parent_task_id').notNull(),
    parentIteration: integer('parent_iteration').notNull().default(0),
    attempt: integer('attempt').notNull().default(0),
    subgraphId: text('subgraph_id'),
    status: varchar('status', { length: 12 }).notNull().default('planning'),
    taskFingerprint: text('task_fingerprint'),
    contextFingerprint: text('context_fingerprint'),
    inputContextSummary: jsonObject('input_context_summary'),
    policySnapshot: jsonObject('policy_snapshot'),
    plannerSnapshot: jsonObject('planner_snapshot'),
    decision: jsonObject('decision'),
    revisions: jsonArray('revisions'),
    acceptedRevision: integer('accepted_revision'),
    acceptedPlan: jsonObject('accepted_plan'),
    fallbackReason: text('fallback_reason'),
    error: jsonObject('error'),
    planningStartedAt: ts('planning_started_at'),
    acceptedAt: ts('accepted_at'),
    completedAt: ts('completed_at'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_dynamic_reasoning_attempts_status', sql`${t.status} IN ('planning','direct','running','completed','failed')`),
    uniqueIndex('uq_playbook_dynamic_reasoning_attempts_attempt').on(t.executionId, t.parentTaskId, t.parentIteration, t.attempt),
    index('idx_playbook_dynamic_reasoning_attempts_status').on(t.executionId, t.status),
    uniqueIndex('uq_playbook_dynamic_reasoning_attempts_subgraph').on(t.subgraphId).where(sql`${t.subgraphId} IS NOT NULL`),
  ],
);

export const playbookHitlMemories = playbookSchema.table(
  'hitl_memories',
  {
    id: objectId('id').primaryKey(),
    ownerId: objectId('owner_id').notNull(),
    flowId: objectId('flow_id').notNull(),
    nodeId: text('node_id'),
    memoryType: varchar('memory_type', { length: 16 }).notNull().default('procedural'),
    source: varchar('source', { length: 20 }).notNull().default('hitl_feedback'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    normalizedInstruction: text('normalized_instruction').notNull(),
    appliesTo: varchar('applies_to', { length: 12 }).notNull().default('workflow'),
    status: varchar('status', { length: 12 }).notNull().default('draft'),
    sensitivity: varchar('sensitivity', { length: 12 }).notNull().default('normal'),
    createdFromExecutionId: text('created_from_execution_id'),
    createdFromInterruptId: text('created_from_interrupt_id'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_hitl_memories_memory_type', sql`${t.memoryType} IN ('semantic','episodic','procedural','approval_policy')`),
    check('playbook_hitl_memories_source', sql`${t.source} IN ('hitl_feedback','blocker_rule','replay_validation','manual')`),
    check('playbook_hitl_memories_applies_to', sql`${t.appliesTo} IN ('node','workflow','agent','workspace')`),
    check('playbook_hitl_memories_status', sql`${t.status} IN ('active','draft','archived')`),
    check('playbook_hitl_memories_sensitivity', sql`${t.sensitivity} IN ('normal','sensitive')`),
    index('idx_playbook_hitl_memories_flow').on(t.ownerId, t.flowId, t.status),
    index('idx_playbook_hitl_memories_node').on(t.ownerId, t.flowId, t.nodeId),
    index('idx_playbook_hitl_memories_flow_only').on(t.flowId),
  ],
);

export const playbookExecutionLeases = playbookSchema.table(
  'execution_leases',
  {
    id: objectId('id').primaryKey(),
    executionId: objectId('execution_id').notNull(),
    ownerId: objectId('owner_id').notNull(),
    flowId: objectId('flow_id').notNull(),
    scopeType: varchar('scope_type', { length: 10 }).notNull(),
    scopeKey: text('scope_key').notNull(),
    slot: integer('slot').notNull(),
    expiresAt: ts('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('playbook_execution_leases_scope_type', sql`${t.scopeType} IN ('global','owner','flow','provider','model')`),
    check('playbook_execution_leases_slot', sql`${t.slot} >= 0`),
    uniqueIndex('uq_playbook_execution_leases_scope').on(t.executionId, t.scopeType),
    uniqueIndex('uq_playbook_execution_leases_slot').on(t.scopeKey, t.slot),
    index('idx_playbook_execution_leases_expires').on(t.expiresAt),
  ],
);

export const playbookIdempotencyRecords = playbookSchema.table(
  'idempotency_records',
  {
    id: objectId('id').primaryKey(),
    ownerId: objectId('owner_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    executionId: objectId('execution_id'),
    responseBody: jsonObject('response_body'),
    expectedStateHash: text('expected_state_hash'),
    expectedDefinitionRevision: integer('expected_definition_revision'),
    expiresAt: ts('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_playbook_idempotency_records_key').on(t.ownerId, t.idempotencyKey),
    index('idx_playbook_idempotency_records_expires').on(t.expiresAt),
    index('idx_playbook_idempotency_records_execution').on(t.executionId).where(sql`${t.executionId} IS NOT NULL`),
  ],
);

export const playbookMailEventLedgers = playbookSchema.table(
  'mail_event_ledgers',
  {
    id: objectId('id').primaryKey(),
    ledgerId: text('ledger_id').notNull(),
    flowId: objectId('flow_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: varchar('status', { length: 12 }).notNull().default('received'),
    provider: text('provider').notNull().default('m365'),
    mailboxAppKey: text('mailbox_app_key').notNull(),
    providerMessageId: text('provider_message_id').notNull(),
    providerThreadId: text('provider_thread_id'),
    receivedAt: ts('received_at').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    subject: text('subject').notNull().default(''),
    bodyText: text('body_text').notNull().default(''),
    bodyHtml: text('body_html'),
    fromParticipant: jsonb('from_participant').$type<Json>().notNull(),
    toParticipants: jsonArray('to_participants'),
    ccParticipants: jsonArray('cc_participants'),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    attachments: jsonArray('attachments'),
    error: text('error'),
    executionId: objectId('execution_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    check('playbook_mail_event_ledgers_status', sql`${t.status} IN ('received','normalized','matched','handed_off','deduplicated','ignored','errored')`),
    uniqueIndex('uq_playbook_mail_event_ledgers_dedupe').on(t.flowId, t.dedupeKey),
    index('idx_playbook_mail_event_ledgers_flow_created').on(t.flowId, t.createdAt.desc()),
    index('idx_playbook_mail_event_ledgers_status').on(t.status),
    index('idx_playbook_mail_event_ledgers_execution').on(t.executionId).where(sql`${t.executionId} IS NOT NULL`),
    // The mail trigger addresses an entry by its ledger id.
    index('idx_playbook_mail_event_ledgers_ledger_id').on(t.ledgerId),
  ],
);

export const playbookOutputFormats = playbookSchema.table(
  'output_formats',
  {
    id: objectId('id').primaryKey(),
    flowId: objectId('flow_id').notNull(),
    nodeId: text('node_id').notNull(),
    createdBy: objectId('created_by').notNull(),
    sourceExecutionId: objectId('source_execution_id').notNull(),
    sourceExecutionNumber: integer('source_execution_number').notNull(),
    templateVersion: integer('template_version').notNull(),
    status: varchar('status', { length: 10 }).notNull().default('active'),
    generationStatus: varchar('generation_status', { length: 10 }).notNull().default('pending'),
    generationError: text('generation_error'),
    sourceOutput: text('source_output'),
    formatGuide: text('format_guide'),
    llmPromptTrace: jsonArray('llm_prompt_trace'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_output_formats_status', sql`${t.status} IN ('active','inactive','archived')`),
    check('playbook_output_formats_generation_status', sql`${t.generationStatus} IN ('pending','ready','failed')`),
    index('idx_playbook_output_formats_node').on(t.flowId, t.nodeId, t.status),
  ],
);

// ---------------------------------------------------------------- design workspace

export const playbookDesignMessages = playbookSchema.table(
  'design_messages',
  {
    id: objectId('id').primaryKey(),
    flowId: objectId('flow_id').notNull(),
    createdBy: objectId('created_by').notNull(),
    userQuery: text('user_query').notNull().default(''),
    aiSummary: text('ai_summary').notNull().default(''),
    snapshotBefore: jsonb('snapshot_before').$type<Json>().notNull(),
    status: varchar('status', { length: 10 }).notNull().default('completed'),
    revertedFromMessageId: objectId('reverted_from_message_id'),
    error: text('error'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_design_messages_status', sql`${t.status} IN ('completed','failed','reverted')`),
    index('idx_playbook_design_messages_flow').on(t.flowId, t.createdAt.desc()),
    index('idx_playbook_design_messages_flow_user').on(t.flowId, t.createdBy, t.createdAt.desc()),
    index('idx_playbook_design_messages_reverted').on(t.revertedFromMessageId).where(sql`${t.revertedFromMessageId} IS NOT NULL`),
  ],
);

export const playbookDesignOperations = playbookSchema.table(
  'design_operations',
  {
    id: objectId('id').primaryKey(),
    flowId: objectId('flow_id').notNull(),
    ownerId: objectId('owner_id').notNull(),
    query: text('query').notNull(),
    status: varchar('status', { length: 10 }).notNull().default('queued'),
    idempotencyKey: text('idempotency_key'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    error: text('error'),
    snapshotBefore: jsonObject('snapshot_before'),
    resultPreview: jsonObject('result_preview'),
    appliedMessageId: objectId('applied_message_id'),
    lockVersion: integer('lock_version').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    check('playbook_design_operations_status', sql`${t.status} IN ('queued','running','applying','completed','failed','cancelled')`),
    index('idx_playbook_design_operations_flow').on(t.flowId, t.status, t.createdAt),
    index('idx_playbook_design_operations_owner').on(t.ownerId, t.status, t.createdAt),
    uniqueIndex('uq_playbook_design_operations_key').on(t.ownerId, t.flowId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('idx_playbook_design_operations_message').on(t.appliedMessageId).where(sql`${t.appliedMessageId} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------- assistant (TTL-swept rows keyed by string ids)

export const playbookAssistantRequests = playbookSchema.table(
  'assistant_requests',
  {
    id: objectId('id').primaryKey(),
    requestId: text('request_id').notNull(),
    ownerId: text('owner_id').notNull(),
    agentId: text('agent_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    operationKind: varchar('operation_kind', { length: 24 }).notNull(),
    playbookId: text('playbook_id'),
    expectedDefinitionRevision: integer('expected_definition_revision'),
    contextId: text('context_id').notNull(),
    messageHash: text('message_hash').notNull(),
    originalText: text('original_text').notNull(),
    requestedName: text('requested_name'),
    handoffContext: jsonObject('handoff_context'),
    handoffProvenance: jsonObject('handoff_provenance'),
    workspaceDefaultIds: text('workspace_default_ids').array().notNull().default([]),
    selectedTaskId: text('selected_task_id'),
    executionId: text('execution_id'),
    attachmentIds: text('attachment_ids').array().notNull().default([]),
    continuationId: text('continuation_id'),
    assessment: jsonObject('assessment'),
    assessmentVersion: integer('assessment_version').notNull().default(0),
    answers: jsonArray('answers'),
    mutationOperationId: text('mutation_operation_id'),
    assistantAnswer: text('assistant_answer'),
    responsePayload: jsonObject('response_payload'),
    status: varchar('status', { length: 24 }).notNull().default('processing'),
    expiresAt: ts('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('playbook_assistant_requests_operation_kind', sql`${t.operationKind} IN ('inspect','existing_construction','generation')`),
    check('playbook_assistant_requests_status', sql`${t.status} IN ('processing','awaiting_clarification','ready','completed','failed')`),
    uniqueIndex('uq_playbook_assistant_requests_request').on(t.requestId),
    index('idx_playbook_assistant_requests_conversation').on(t.ownerId, t.conversationId, t.createdAt.desc()),
    index('idx_playbook_assistant_requests_playbook').on(t.ownerId, t.playbookId, t.createdAt.desc()),
    index('idx_playbook_assistant_requests_continuation').on(t.continuationId).where(sql`${t.continuationId} IS NOT NULL`),
    index('idx_playbook_assistant_requests_status').on(t.status),
    index('idx_playbook_assistant_requests_expires').on(t.expiresAt),
  ],
);

export const playbookAssistantOperations = playbookSchema.table(
  'assistant_operations',
  {
    id: objectId('id').primaryKey(),
    operationId: text('operation_id').notNull(),
    playbookId: text('playbook_id').notNull(),
    ownerId: text('owner_id').notNull(),
    requestId: text('request_id'),
    operationKind: varchar('operation_kind', { length: 16 }).notNull().default('construction'),
    origin: varchar('origin', { length: 10 }).notNull().default('designer'),
    target: varchar('target', { length: 20 }).notNull().default('canonical'),
    applyTarget: varchar('apply_target', { length: 20 }).notNull().default('current_playbook'),
    disposition: varchar('disposition', { length: 10 }).notNull().default('pending'),
    status: varchar('status', { length: 10 }).notNull().default('queued'),
    baseDefinitionRevision: integer('base_definition_revision').notNull(),
    lastSequence: integer('last_sequence').notNull().default(0),
    events: jsonArray('events'),
    eventBytes: integer('event_bytes').notNull().default(0),
    workerId: text('worker_id').notNull(),
    leaseExpiresAt: ts('lease_expires_at'),
    terminalAt: ts('terminal_at'),
    committedRevision: integer('committed_revision'),
    committedAt: ts('committed_at'),
    revertedRevision: integer('reverted_revision'),
    revertedAt: ts('reverted_at'),
    createdPlaybookId: text('created_playbook_id'),
    expiresAt: ts('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('playbook_assistant_operations_operation_kind', sql`${t.operationKind} IN ('construction','generation')`),
    check('playbook_assistant_operations_origin', sql`${t.origin} IN ('designer','mcp','advisor')`),
    check('playbook_assistant_operations_target', sql`${t.target} IN ('canonical','advisor_preview')`),
    check('playbook_assistant_operations_apply_target', sql`${t.applyTarget} IN ('current_playbook','new_playbook')`),
    check('playbook_assistant_operations_disposition', sql`${t.disposition} IN ('pending','applying','applied','discarded','reverted')`),
    check('playbook_assistant_operations_status', sql`${t.status} IN ('queued','running','completed','failed','cancelled')`),
    check('playbook_assistant_operations_base_revision', sql`${t.baseDefinitionRevision} >= 0`),
    uniqueIndex('uq_playbook_assistant_operations_operation').on(t.operationId),
    index('idx_playbook_assistant_operations_owner_playbook').on(t.ownerId, t.playbookId, t.createdAt.desc()),
    index('idx_playbook_assistant_operations_request').on(t.requestId).where(sql`${t.requestId} IS NOT NULL`),
    index('idx_playbook_assistant_operations_status').on(t.status),
    index('idx_playbook_assistant_operations_lease').on(t.leaseExpiresAt).where(sql`${t.leaseExpiresAt} IS NOT NULL`),
    index('idx_playbook_assistant_operations_expires').on(t.expiresAt),
  ],
);

export const playbookAssistantMessages = playbookSchema.table(
  'assistant_messages',
  {
    id: objectId('id').primaryKey(),
    messageId: text('message_id').notNull(),
    requestId: text('request_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    ownerId: text('owner_id').notNull(),
    playbookId: text('playbook_id').notNull(),
    role: varchar('role', { length: 10 }).notNull(),
    content: text('content').notNull(),
    operationId: text('operation_id'),
    expiresAt: ts('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('playbook_assistant_messages_role', sql`${t.role} IN ('user','assistant')`),
    uniqueIndex('uq_playbook_assistant_messages_message').on(t.messageId),
    uniqueIndex('uq_playbook_assistant_messages_request_role').on(t.requestId, t.role),
    index('idx_playbook_assistant_messages_conversation').on(t.ownerId, t.conversationId, t.createdAt),
    index('idx_playbook_assistant_messages_expires').on(t.expiresAt),
  ],
);

export const playbookAssistantRevisions = playbookSchema.table(
  'assistant_revisions',
  {
    id: objectId('id').primaryKey(),
    operationId: text('operation_id').notNull(),
    playbookId: text('playbook_id').notNull(),
    ownerId: text('owner_id').notNull(),
    definitionRevision: integer('definition_revision').notNull(),
    definition: jsonb('definition').$type<Json>().notNull(),
    expiresAt: ts('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('playbook_assistant_revisions_revision', sql`${t.definitionRevision} >= 0`),
    uniqueIndex('uq_playbook_assistant_revisions_operation').on(t.operationId),
    index('idx_playbook_assistant_revisions_playbook').on(t.playbookId),
    index('idx_playbook_assistant_revisions_expires').on(t.expiresAt),
  ],
);

export const playbookAssistantAttachments = playbookSchema.table(
  'assistant_attachments',
  {
    id: objectId('id').primaryKey(),
    attachmentId: text('attachment_id').notNull(),
    requestId: text('request_id').notNull(),
    ownerId: text('owner_id').notNull(),
    playbookId: text('playbook_id').notNull(),
    expectedDefinitionRevision: integer('expected_definition_revision').notNull(),
    objectKey: text('object_key').notNull(),
    mediaType: text('media_type').notNull(),
    declaredSize: bigint('declared_size', { mode: 'number' }).notNull(),
    actualSize: bigint('actual_size', { mode: 'number' }),
    contentSha256: text('content_sha256'),
    status: varchar('status', { length: 10 }).notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('playbook_assistant_attachments_revision', sql`${t.expectedDefinitionRevision} >= 0`),
    check('playbook_assistant_attachments_declared_size', sql`${t.declaredSize} >= 1`),
    check('playbook_assistant_attachments_actual_size', sql`${t.actualSize} IS NULL OR ${t.actualSize} >= 1`),
    check('playbook_assistant_attachments_status', sql`${t.status} IN ('pending','confirmed')`),
    uniqueIndex('uq_playbook_assistant_attachments_attachment').on(t.attachmentId),
    index('idx_playbook_assistant_attachments_request').on(t.ownerId, t.requestId, t.createdAt),
    index('idx_playbook_assistant_attachments_playbook').on(t.playbookId),
    index('idx_playbook_assistant_attachments_expires').on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------- replay baselines, run reports, evaluations

export const playbookValidatedReplays = playbookSchema.table(
  'validated_replays',
  {
    id: objectId('id').primaryKey(),
    flowId: objectId('flow_id').notNull(),
    taskId: text('task_id').notNull(),
    iteration: integer('iteration').notNull(),
    taskTitle: text('task_title').notNull(),
    createdBy: text('created_by').notNull(),
    referenceExecutionId: text('reference_execution_id').notNull(),
    referenceExecutionNumber: integer('reference_execution_number').notNull(),
    validationVersion: integer('validation_version').notNull(),
    status: varchar('status', { length: 10 }).notNull().default('active'),
    mode: varchar('mode', { length: 16 }).notNull().default('replay_strict'),
    isStale: boolean('is_stale').notNull().default(false),
    label: text('label'),
    /** The template body: tool calls, reasoning outline, fingerprints, accepted examples, replay config, ... */
    doc: jsonObject('doc').notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check('playbook_validated_replays_status', sql`${t.status} IN ('active','inactive','archived')`),
    check('playbook_validated_replays_mode', sql`${t.mode} IN ('replay_strict','replay_flex','replay_adaptive','strict_replay')`),
    uniqueIndex('uq_playbook_validated_replays_version').on(t.flowId, t.taskId, t.iteration, t.validationVersion),
    index('idx_playbook_validated_replays_flow_task').on(t.flowId, t.taskId, t.status),
    index('idx_playbook_validated_replays_task').on(t.taskId),
    index('idx_playbook_validated_replays_reference').on(t.referenceExecutionId),
  ],
);

export const playbookReplayRunReports = playbookSchema.table(
  'replay_run_reports',
  {
    id: objectId('id').primaryKey(),
    executionId: text('execution_id').notNull(),
    flowId: objectId('flow_id').notNull(),
    taskId: text('task_id').notNull(),
    iteration: integer('iteration').notNull().default(0),
    replayId: text('replay_id').notNull(),
    validationVersion: integer('validation_version').notNull(),
    mode: text('mode').notNull(),
    verdict: varchar('verdict', { length: 10 }),
    overallScore: doublePrecision('overall_score'),
    /** Drift findings, tool-call comparisons, signal statuses, post-run evaluation, HITL summary, ... */
    doc: jsonObject('doc').notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check('playbook_replay_run_reports_verdict', sql`${t.verdict} IS NULL OR ${t.verdict} IN ('pass','warning','fail','unknown')`),
    index('idx_playbook_replay_run_reports_execution').on(t.executionId, t.taskId, t.iteration, t.createdAt.desc()),
    index('idx_playbook_replay_run_reports_flow').on(t.flowId, t.taskId, t.iteration, t.createdAt.desc()),
    index('idx_playbook_replay_run_reports_flow_replay').on(t.flowId, t.taskId, t.replayId, t.iteration, t.createdAt.desc()),
    index('idx_playbook_replay_run_reports_replay').on(t.replayId, t.createdAt.desc()),
  ],
);

export const playbookEvaluationBaselines = playbookSchema.table(
  'evaluation_baselines',
  {
    id: objectId('id').primaryKey(),
    flowId: objectId('flow_id').notNull(),
    taskId: text('task_id').notNull(),
    iteration: integer('iteration').notNull().default(0),
    sourceExecutionId: text('source_execution_id').notNull(),
    sourceMode: varchar('source_mode', { length: 20 }).notNull(),
    inputSnapshots: jsonArray('input_snapshots'),
    createdByUserId: text('created_by_user_id').notNull(),
    replacedAt: ts('replaced_at'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_evaluation_baselines_source_mode', sql`${t.sourceMode} IN ('selected_execution','current_inputs')`),
    index('idx_playbook_evaluation_baselines_task').on(t.flowId, t.taskId, t.iteration, t.replacedAt),
  ],
);

export const playbookEvaluationExecutions = playbookSchema.table(
  'evaluation_executions',
  {
    id: objectId('id').primaryKey(),
    flowId: objectId('flow_id').notNull(),
    executionId: text('execution_id').notNull(),
    taskId: text('task_id').notNull(),
    iteration: integer('iteration').notNull().default(0),
    taskTitle: text('task_title').notNull(),
    baselineId: text('baseline_id'),
    mode: varchar('mode', { length: 10 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('completed'),
    score: doublePrecision('score'),
    verdict: varchar('verdict', { length: 10 }),
    semanticScore: doublePrecision('semantic_score'),
    referenceScore: doublePrecision('reference_score'),
    artifactScore: doublePrecision('artifact_score'),
    formatScore: doublePrecision('format_score'),
    evidenceScore: doublePrecision('evidence_score'),
    executionHealthScore: doublePrecision('execution_health_score'),
    expectation: text('expectation').notNull().default(''),
    rubricVersion: text('rubric_version').notNull().default('evaluation-node-v1'),
    judgeModel: text('judge_model'),
    summary: text('summary'),
    findings: jsonArray('findings'),
    metrics: jsonObject('metrics').notNull().default({}),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    error: text('error'),
    ...timestamps(),
  },
  (t) => [
    check('playbook_evaluation_executions_mode', sql`${t.mode} IN ('semantic','reference','hybrid')`),
    check('playbook_evaluation_executions_status', sql`${t.status} IN ('running','completed','failed')`),
    check('playbook_evaluation_executions_verdict', sql`${t.verdict} IS NULL OR ${t.verdict} IN ('pass','warning','fail')`),
    index('idx_playbook_evaluation_executions_task').on(t.flowId, t.taskId, t.iteration, t.createdAt.desc()),
    index('idx_playbook_evaluation_executions_execution').on(t.executionId),
  ],
);
