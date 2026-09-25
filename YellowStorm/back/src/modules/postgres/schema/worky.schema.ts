import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, objectIdArray, timestamps } from '../../../common/postgres/columns';

/**
 * Worky tables (roadmap P7): streams with their shares, the board (tasks), the plan history, the
 * messages and the rows mirrored from the manager through Electric, interactions, budget, mail,
 * scheduling, reports, audit and memory. Every parent reference inside the module is a real foreign
 * key in 0038_worky.sql; workspace_id, the legacy artifact/agent ids, audit scope ids and the actor
 * columns deliberately have none (see the migration header).
 */
export const workySchema = pgSchema('worky');

/** USD amounts: exact decimals, read back as numbers. */
const usd = (name: string) => numeric(name, { precision: 18, scale: 8, mode: 'number' });
/** Counters (tokens, milliseconds): integers that can outgrow int4. */
const counter = (name: string) => bigint(name, { mode: 'number' });

export const workyGovernancePolicies = workySchema.table(
  'governance_policies',
  {
    id: objectId('id').primaryKey(),
    workspaceId: objectId('workspace_id').notNull(),
    scope: varchar('scope', { length: 16 }).notNull().default('workspace'),
    defaultLevel: varchar('default_level', { length: 16 }).notNull().default('off'),
    categories: jsonb('categories').$type<Array<{ category: string; level: string }>>().notNull().default([]),
    allowStreamOwnerOverride: boolean('allow_stream_owner_override').notNull().default(true),
    maxOwnerRelaxLevel: varchar('max_owner_relax_level', { length: 16 }).notNull().default('notify'),
    ...timestamps(),
  },
  (t) => [
    check('worky_governance_policies_scope', sql`${t.scope} IN ('workspace','stream')`),
    check('worky_governance_policies_default_level', sql`${t.defaultLevel} IN ('off','notify','approval','hard_block')`),
    check('worky_governance_policies_relax_level', sql`${t.maxOwnerRelaxLevel} IN ('off','notify','approval','hard_block')`),
    uniqueIndex('uq_worky_governance_policies_scope').on(t.workspaceId, t.scope),
  ],
);

export const workyStreams = workySchema.table(
  'streams',
  {
    id: objectId('id').primaryKey(),
    ownerUserId: objectId('owner_user_id').notNull(),
    /** The owner's id when the stream was created without a workspace: not a workspace reference, no FK. */
    workspaceId: objectId('workspace_id').notNull(),
    artifactWorkspaceId: objectId('artifact_workspace_id'),
    managerAgentId: objectId('manager_agent_id'),
    managerModelId: varchar('manager_model_id', { length: 256 }),
    workerModelId: varchar('worker_model_id', { length: 256 }),
    voicePrompt: text('voice_prompt'),
    aiSessionId: text('ai_session_id'),
    governancePolicyRef: objectId('governance_policy_ref'),
    title: varchar('title', { length: 200 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('created'),
    controlState: varchar('control_state', { length: 24 }).notNull().default('active'),
    schedulerEnabled: boolean('scheduler_enabled').notNull().default(false),
    currentPlanVersion: integer('current_plan_version').notNull().default(0),
    executionPlanVersion: integer('execution_plan_version'),
    budgetLimitUsd: usd('budget_limit_usd').notNull().default(0),
    budgetLimitTokens: counter('budget_limit_tokens').notNull().default(0),
    budgetSpendUsd: usd('budget_spend_usd').notNull().default(0),
    budgetTokensUsed: counter('budget_tokens_used').notNull().default(0),
    budgetEnforcement: varchar('budget_enforcement', { length: 16 }).notNull().default('hard_stop'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    activeDurationMinutes: doublePrecision('active_duration_minutes').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    check('worky_streams_title', sql`char_length(${t.title}) >= 1`),
    check('worky_streams_status', sql`${t.status} IN ('created','planning','start_requested','start_validation_failed','active','partially_blocked','waiting_for_owner','waiting_for_human','waiting_for_budget_decision','paused','stopped','completed','archived')`),
    check('worky_streams_control_state', sql`${t.controlState} IN ('active','pause_requested','paused','resume_requested','stop_requested','stopped')`),
    check('worky_streams_plan_version', sql`${t.currentPlanVersion} >= 0`),
    check('worky_streams_limit_usd', sql`${t.budgetLimitUsd} >= 0`),
    check('worky_streams_limit_tokens', sql`${t.budgetLimitTokens} >= 0`),
    check('worky_streams_spend_usd', sql`${t.budgetSpendUsd} >= 0`),
    check('worky_streams_tokens_used', sql`${t.budgetTokensUsed} >= 0`),
    check('worky_streams_enforcement', sql`${t.budgetEnforcement} IN ('hard_stop','notify')`),
    check('worky_streams_active_minutes', sql`${t.activeDurationMinutes} >= 0`),
    index('idx_worky_streams_owner_created').on(t.ownerUserId, t.createdAt.desc()),
    index('idx_worky_streams_owner_activity').on(t.ownerUserId, t.lastActivityAt.desc(), t.createdAt.desc()),
    index('idx_worky_streams_owner_status').on(t.ownerUserId, t.status),
    uniqueIndex('uq_worky_streams_ai_session').on(t.aiSessionId).where(sql`${t.aiSessionId} IS NOT NULL`),
    index('idx_worky_streams_governance_policy').on(t.governancePolicyRef).where(sql`${t.governancePolicyRef} IS NOT NULL`),
  ],
);

export const workyStreamShares = workySchema.table(
  'stream_shares',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    userId: objectId('user_id').notNull(),
    permission: varchar('permission', { length: 8 }).notNull(),
    ...timestamps(),
  },
  (t) => [
    check('worky_stream_shares_permission', sql`${t.permission} IN ('read','write')`),
    uniqueIndex('uq_worky_stream_shares_user').on(t.streamId, t.userId),
    index('idx_worky_stream_shares_user').on(t.userId),
  ],
);

export const workyTasks = workySchema.table(
  'tasks',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    /** The manager's plan_steps.step_id: the upsert key of the Electric consumer. */
    externalId: text('external_id'),
    ordinal: integer('ordinal'),
    result: text('result'),
    blockedReason: text('blocked_reason'),
    wave: integer('wave'),
    dependsOnStepIds: text('depends_on_step_ids').array().notNull().default([]),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    lane: varchar('lane', { length: 16 }).notNull().default('backlog'),
    planningStatus: varchar('planning_status', { length: 16 }).notNull().default('pending'),
    executionState: varchar('execution_state', { length: 24 }).notNull().default('not_started'),
    controlState: varchar('control_state', { length: 24 }).notNull().default('active'),
    priority: varchar('priority', { length: 8 }).notNull().default('medium'),
    assigneeType: varchar('assignee_type', { length: 24 }).notNull().default('unassigned'),
    assigneeId: objectId('assignee_id'),
    assigneeKey: text('assignee_key'),
    kind: text('kind').notNull().default('execute'),
    question: text('question'),
    interruptId: text('interrupt_id'),
    assigneeName: text('assignee_name'),
    assigneeRole: text('assignee_role'),
    isPersona: boolean('is_persona').notNull().default(false),
    isDynamicDelegate: boolean('is_dynamic_delegate').notNull().default(false),
    dependsOn: objectIdArray('depends_on').notNull().default([]),
    requiredTools: text('required_tools').array().notNull().default([]),
    actionCategory: varchar('action_category', { length: 40 }).notNull().default('internal_analysis'),
    theoreticalDeadlineAt: timestamp('theoretical_deadline_at', { withTimezone: true }),
    acceptanceCriteria: text('acceptance_criteria').array().notNull().default([]),
    budgetEstimateUsd: usd('budget_estimate_usd').notNull().default(0),
    budgetActualUsd: usd('budget_actual_usd').notNull().default(0),
    budgetTokensEstimate: counter('budget_tokens_estimate').notNull().default(0),
    budgetTokensActual: counter('budget_tokens_actual').notNull().default(0),
    waitConditions: text('wait_conditions').array().notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: counter('duration_ms'),
    ...timestamps(),
  },
  (t) => [
    check('worky_tasks_lane', sql`${t.lane} IN ('backlog','ready','running','review','blocked','done','failed','canceled','superseded','archived')`),
    check('worky_tasks_planning_status', sql`${t.planningStatus} IN ('pending','confirmed','rejected')`),
    check('worky_tasks_execution_state', sql`${t.executionState} IN ('not_started','scheduled','running','waiting_for_event','review','done','failed','canceled','superseded')`),
    check('worky_tasks_control_state', sql`${t.controlState} IN ('active','pause_requested','paused','stop_requested','stopped')`),
    check('worky_tasks_priority', sql`${t.priority} IN ('low','medium','high','critical')`),
    check('worky_tasks_assignee_type', sql`${t.assigneeType} IN ('ephemeral_ai_agent','human_agent','unassigned')`),
    check('worky_tasks_action_category', sql`${t.actionCategory} IN ('internal_analysis','research','drafting','internal_artifact_write','internal_platform_notification','external_send','customer_facing_release','external_comms','budget_overrun','cancel_human_task','replanning')`),
    check('worky_tasks_estimate_usd', sql`${t.budgetEstimateUsd} >= 0`),
    check('worky_tasks_actual_usd', sql`${t.budgetActualUsd} >= 0`),
    check('worky_tasks_tokens_estimate', sql`${t.budgetTokensEstimate} >= 0`),
    check('worky_tasks_tokens_actual', sql`${t.budgetTokensActual} >= 0`),
    check('worky_tasks_duration', sql`${t.durationMs} IS NULL OR ${t.durationMs} >= 0`),
    uniqueIndex('uq_worky_tasks_external').on(t.streamId, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
    index('idx_worky_tasks_stream_lane').on(t.streamId, t.lane),
    index('idx_worky_tasks_stream_updated').on(t.streamId, t.updatedAt),
    index('idx_worky_tasks_assignee').on(t.assigneeId).where(sql`${t.assigneeId} IS NOT NULL`),
  ],
);

export const workyPlanDeltas = workySchema.table(
  'plan_deltas',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    basePlanVersion: integer('base_plan_version').notNull(),
    resultPlanVersion: integer('result_plan_version'),
    phase: varchar('phase', { length: 16 }).notNull(),
    triggerEventId: text('trigger_event_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    applyMode: varchar('apply_mode', { length: 20 }).notNull().default('auto'),
    reason: text('reason').notNull().default(''),
    createdBy: objectId('created_by').notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull().default({}),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    approvedBy: objectId('approved_by'),
    ...timestamps(),
  },
  (t) => [
    check('worky_plan_deltas_base_version', sql`${t.basePlanVersion} >= 0`),
    check('worky_plan_deltas_phase', sql`${t.phase} IN ('planning','execution','replan')`),
    check('worky_plan_deltas_status', sql`${t.status} IN ('pending','applied','rejected','superseded','pending_approval')`),
    check('worky_plan_deltas_apply_mode', sql`${t.applyMode} IN ('auto','manual','pending_approval')`),
    index('idx_worky_plan_deltas_stream_created').on(t.streamId, t.createdAt.desc()),
    index('idx_worky_plan_deltas_stream_status').on(t.streamId, t.status),
  ],
);

export const workyMessages = workySchema.table(
  'messages',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    externalId: text('external_id'),
    turnId: text('turn_id'),
    role: varchar('role', { length: 8 }).notNull(),
    content: text('content').notNull(),
    planDeltaRef: objectId('plan_delta_ref'),
    emittedAt: timestamp('emitted_at', { withTimezone: true }),
    origin: varchar('origin', { length: 8 }),
    ...timestamps(),
  },
  (t) => [
    check('worky_messages_role', sql`${t.role} IN ('owner','manager','system')`),
    check('worky_messages_origin', sql`${t.origin} IS NULL OR ${t.origin} = 'voice'`),
    uniqueIndex('uq_worky_messages_external').on(t.streamId, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
    index('idx_worky_messages_stream_created').on(t.streamId, t.createdAt, t.id),
    index('idx_worky_messages_plan_delta').on(t.planDeltaRef).where(sql`${t.planDeltaRef} IS NOT NULL`),
  ],
);

export const workyPlanVersions = workySchema.table(
  'plan_versions',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    phase: varchar('phase', { length: 16 }).notNull(),
    createdBy: objectId('created_by').notNull(),
    createdFromMessageId: objectId('created_from_message_id'),
    triggerEventId: text('trigger_event_id'),
    summary: text('summary').notNull().default(''),
    ...timestamps(),
  },
  (t) => [
    check('worky_plan_versions_number', sql`${t.versionNumber} >= 1`),
    check('worky_plan_versions_phase', sql`${t.phase} IN ('planning','execution','replan')`),
    uniqueIndex('uq_worky_plan_versions_number').on(t.streamId, t.versionNumber),
    index('idx_worky_plan_versions_message').on(t.createdFromMessageId).where(sql`${t.createdFromMessageId} IS NOT NULL`),
  ],
);

export const workyPlanProjections = workySchema.table(
  'plan_projections',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    title: text('title').notNull().default(''),
    goal: text('goal').notNull().default(''),
    status: text('status').notNull().default(''),
    sessionStatus: text('session_status'),
    activeInterruptId: text('active_interrupt_id'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_worky_plan_projections_stream').on(t.streamId)],
);

export const workyMessageComponents = workySchema.table(
  'message_components',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    externalId: text('external_id'),
    messageExternalId: text('message_external_id').notNull(),
    ordinal: integer('ordinal').notNull().default(0),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_worky_message_components_external').on(t.streamId, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
    index('idx_worky_message_components_message').on(t.streamId, t.messageExternalId, t.ordinal),
  ],
);

export const workyPlanStepComponents = workySchema.table(
  'plan_step_components',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    externalId: text('external_id'),
    stepExternalId: text('step_external_id').notNull(),
    ordinal: integer('ordinal').notNull().default(0),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_worky_plan_step_components_external').on(t.streamId, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
    index('idx_worky_plan_step_components_step').on(t.streamId, t.stepExternalId, t.ordinal),
  ],
);

export const workyPlanStepArtifacts = workySchema.table(
  'plan_step_artifacts',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    externalId: text('external_id'),
    stepExternalId: text('step_external_id').notNull(),
    filePath: text('file_path').notNull(),
    filename: text('filename').notNull(),
    artifactKind: text('artifact_kind'),
    mimeType: text('mime_type'),
    size: bigint('size', { mode: 'number' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_worky_plan_step_artifacts_external').on(t.streamId, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
    index('idx_worky_plan_step_artifacts_step').on(t.streamId, t.stepExternalId, t.createdAt),
  ],
);

export const workyElectricCursors = workySchema.table('electric_cursors', {
  shape: text('shape').primaryKey(),
  handle: text('handle'),
  logOffset: text('log_offset'),
  ...timestamps(),
});

export const workyInteractions = workySchema.table(
  'interactions',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    taskId: objectId('task_id'),
    type: varchar('type', { length: 32 }).notNull(),
    targetUserId: objectId('target_user_id'),
    question: text('question').notNull(),
    options: text('options').array().notNull().default([]),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    blockingScope: text('blocking_scope').notNull().default('stream'),
    blocksTaskIds: objectIdArray('blocks_task_ids').notNull().default([]),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    response: text('response'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check('worky_interactions_type', sql`${t.type} IN ('clarification','approval','review','missing_input','assignment_disambiguation','budget_decision','deadline_decision','escalation_decision','replan_review')`),
    check('worky_interactions_status', sql`${t.status} IN ('pending','responded','canceled','expired')`),
    index('idx_worky_interactions_stream_status').on(t.streamId, t.status, t.createdAt),
    index('idx_worky_interactions_target_status').on(t.targetUserId, t.status),
    index('idx_worky_interactions_task').on(t.taskId).where(sql`${t.taskId} IS NOT NULL`),
  ],
);

export const workyEphemeralWorkers = workySchema.table(
  'ephemeral_workers',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    taskId: objectId('task_id').notNull(),
    agentEntityId: objectId('agent_entity_id').notNull(),
    role: varchar('role', { length: 100 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('spawned'),
    adkSessionId: text('adk_session_id'),
    adkInvocationId: text('adk_invocation_id'),
    lastCheckpointAt: timestamp('last_checkpoint_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('worky_ephemeral_workers_status', sql`${t.status} IN ('spawned','running','done','failed','canceled')`),
    index('idx_worky_ephemeral_workers_stream_status').on(t.streamId, t.status),
    index('idx_worky_ephemeral_workers_task').on(t.taskId, t.createdAt.desc()),
  ],
);

export const workyTaskResults = workySchema.table(
  'task_results',
  {
    id: objectId('id').primaryKey(),
    taskId: objectId('task_id').notNull(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 100 }).notNull(),
    summary: text('summary').notNull().default(''),
    payload: jsonb('payload').$type<Record<string, unknown> | null>(),
    contentArtifactId: objectId('content_artifact_id'),
    createdByWorkerId: objectId('created_by_worker_id'),
    ...timestamps(),
  },
  (t) => [
    check('worky_task_results_version', sql`${t.version} >= 1`),
    uniqueIndex('uq_worky_task_results_version').on(t.taskId, t.version),
    index('idx_worky_task_results_worker').on(t.createdByWorkerId).where(sql`${t.createdByWorkerId} IS NOT NULL`),
  ],
);

export const workyTraces = workySchema.table(
  'traces',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    taskId: objectId('task_id').notNull(),
    kind: varchar('kind', { length: 8 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    summary: text('summary').notNull().default(''),
    rawPayloadUri: text('raw_payload_uri'),
    durationMs: counter('duration_ms').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    check('worky_traces_kind', sql`${t.kind} IN ('tool','model')`),
    check('worky_traces_duration', sql`${t.durationMs} >= 0`),
    index('idx_worky_traces_stream_task').on(t.streamId, t.taskId, t.createdAt),
    index('idx_worky_traces_task').on(t.taskId),
  ],
);

export const workyBudgetReservations = workySchema.table(
  'budget_reservations',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    taskId: objectId('task_id').notNull(),
    amountUsd: usd('amount_usd').notNull(),
    tokens: counter('tokens').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('reserved'),
    ...timestamps(),
  },
  (t) => [
    check('worky_budget_reservations_amount', sql`${t.amountUsd} >= 0`),
    check('worky_budget_reservations_tokens', sql`${t.tokens} >= 0`),
    check('worky_budget_reservations_status', sql`${t.status} IN ('reserved','released','consumed','denied')`),
    index('idx_worky_budget_reservations_stream_status').on(t.streamId, t.status),
    index('idx_worky_budget_reservations_task_status').on(t.taskId, t.status),
  ],
);

export const workyCostEvents = workySchema.table(
  'cost_events',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    taskId: objectId('task_id'),
    type: varchar('type', { length: 16 }).notNull(),
    provider: varchar('provider', { length: 100 }).notNull(),
    modelId: varchar('model_id', { length: 200 }).notNull(),
    inputTokens: counter('input_tokens').notNull().default(0),
    outputTokens: counter('output_tokens').notNull().default(0),
    costUsd: usd('cost_usd').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('worky_cost_events_type', sql`${t.type} IN ('llm','tool','embedding')`),
    check('worky_cost_events_input', sql`${t.inputTokens} >= 0`),
    check('worky_cost_events_output', sql`${t.outputTokens} >= 0`),
    check('worky_cost_events_cost', sql`${t.costUsd} >= 0`),
    index('idx_worky_cost_events_stream_created').on(t.streamId, t.createdAt),
    index('idx_worky_cost_events_task').on(t.taskId).where(sql`${t.taskId} IS NOT NULL`),
  ],
);

export const workyMailEventLedger = workySchema.table(
  'mail_event_ledger',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    taskId: objectId('task_id'),
    kind: varchar('kind', { length: 100 }).notNull(),
    dedupKey: varchar('dedup_key', { length: 200 }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_worky_mail_event_ledger_dedup').on(t.streamId, t.dedupKey),
    index('idx_worky_mail_event_ledger_task').on(t.taskId).where(sql`${t.taskId} IS NOT NULL`),
  ],
);

export const workyScheduledEvents = workySchema.table(
  'scheduled_events',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    taskId: objectId('task_id'),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    claimToken: varchar('claim_token', { length: 64 }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('worky_scheduled_events_status', sql`${t.status} IN ('pending','claimed','fired','canceled')`),
    index('idx_worky_scheduled_events_due').on(t.status, t.fireAt),
    index('idx_worky_scheduled_events_stream_status').on(t.streamId, t.status),
    index('idx_worky_scheduled_events_task').on(t.taskId).where(sql`${t.taskId} IS NOT NULL`),
  ],
);

export const workyExecutionReports = workySchema.table(
  'execution_reports',
  {
    id: objectId('id').primaryKey(),
    streamId: objectId('stream_id').notNull(),
    type: varchar('type', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('generating'),
    markdownArtifactId: objectId('markdown_artifact_id'),
    summary: text('summary').notNull().default(''),
    markdown: text('markdown').notNull().default(''),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('worky_execution_reports_type', sql`${t.type} IN ('summary','rich','lightweight')`),
    check('worky_execution_reports_status', sql`${t.status} IN ('generating','ready','failed')`),
    uniqueIndex('uq_worky_execution_reports_stream').on(t.streamId),
  ],
);

export const workyAuditEvents = workySchema.table(
  'audit_events',
  {
    id: objectId('id').primaryKey(),
    /** A scope id (the stream, the memory owner or the policy's workspace), so no FK. */
    streamId: objectId('stream_id').notNull(),
    actorUserId: objectId('actor_user_id'),
    action: varchar('action', { length: 100 }).notNull(),
    targetType: varchar('target_type', { length: 100 }),
    targetId: objectId('target_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_worky_audit_events_stream_occurred').on(t.streamId, t.occurredAt.desc()),
    index('idx_worky_audit_events_action_occurred').on(t.action, t.occurredAt.desc()),
  ],
);

export const workyMemoryProposals = workySchema.table(
  'memory_proposals',
  {
    id: objectId('id').primaryKey(),
    ownerUserId: objectId('owner_user_id').notNull(),
    sourceStreamId: objectId('source_stream_id'),
    category: varchar('category', { length: 24 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('worky_memory_proposals_category', sql`${t.category} IN ('stream_summary','preference','person','decision_history','role_clarification')`),
    check('worky_memory_proposals_status', sql`${t.status} IN ('pending','confirmed','rejected')`),
    index('idx_worky_memory_proposals_owner').on(t.ownerUserId, t.createdAt.desc()),
    index('idx_worky_memory_proposals_stream').on(t.sourceStreamId).where(sql`${t.sourceStreamId} IS NOT NULL`),
  ],
);

export const workyMemoryEntries = workySchema.table(
  'memory_entries',
  {
    id: objectId('id').primaryKey(),
    ownerUserId: objectId('owner_user_id').notNull(),
    sourceProposalId: objectId('source_proposal_id'),
    sourceStreamId: objectId('source_stream_id'),
    category: varchar('category', { length: 24 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('worky_memory_entries_category', sql`${t.category} IN ('stream_summary','preference','person','decision_history','role_clarification')`),
    index('idx_worky_memory_entries_owner').on(t.ownerUserId, t.createdAt.desc()),
    index('idx_worky_memory_entries_proposal').on(t.sourceProposalId).where(sql`${t.sourceProposalId} IS NOT NULL`),
    index('idx_worky_memory_entries_stream').on(t.sourceStreamId).where(sql`${t.sourceStreamId} IS NOT NULL`),
  ],
);

export const workyMailSubscriptions = workySchema.table(
  'mail_subscriptions',
  {
    id: objectId('id').primaryKey(),
    userId: objectId('user_id').notNull(),
    mailboxAppKey: text('mailbox_app_key').notNull(),
    subscriptionId: text('subscription_id'),
    clientState: text('client_state'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    notificationUrl: text('notification_url'),
    lastSweptAt: timestamp('last_swept_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_worky_mail_subscriptions_mailbox').on(t.userId, t.mailboxAppKey),
    index('idx_worky_mail_subscriptions_client_state').on(t.clientState).where(sql`${t.clientState} IS NOT NULL`),
    index('idx_worky_mail_subscriptions_expiry').on(t.expiresAt).where(sql`${t.subscriptionId} IS NOT NULL`),
  ],
);
