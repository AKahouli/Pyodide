import { sql } from 'drizzle-orm';
import { type AnyPgColumn, boolean, char, check, doublePrecision, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

export const governanceSchema = pgSchema('governance');

const scopeTypeEnum = sql`${varchar('type', { length: 24 })} IN ('organization','municipality','department','business_unit','country','team','custom')`;

export const governancePrograms = governanceSchema.table(
  'governance_programs',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 2000 }),
    domain: varchar('domain', { length: 100 }),
    defaultLanguage: varchar('default_language', { length: 10 }).notNull().default('fr'),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    ownerUserId: objectId('owner_user_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check('gov_programs_status_enum', sql`${t.status} IN ('draft','published','archived')`),
    index('idx_gov_programs_owner').on(t.ownerUserId, sql`${t.createdAt} DESC`),
    index('idx_gov_programs_status').on(t.status, sql`${t.updatedAt} DESC`),
  ],
);

export const governanceScopes = governanceSchema.table(
  'governance_scopes',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    parentScopeId: objectId('parent_scope_id').references((): AnyPgColumn => governanceScopes.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 160 }).notNull(),
    type: varchar('type', { length: 24 }).notNull().default('custom'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    audienceMode: varchar('audience_mode', { length: 24 }).notNull().default('restricted'),
    knowledgeSourceMode: varchar('knowledge_source_mode', { length: 20 }).notNull().default('llm_only'),
    knowledgeWebSourcesEnabled: boolean('knowledge_web_sources_enabled').notNull().default(false),
    knowledgeWebAllowedDomains: text('knowledge_web_allowed_domains').array().notNull().default([]),
    knowledgeWebBlockedDomains: text('knowledge_web_blocked_domains').array().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check('gov_scopes_type_enum', scopeTypeEnum),
    check('gov_scopes_status_enum', sql`${t.status} IN ('active','inactive')`),
    check('gov_scopes_audience_mode_enum', sql`${t.audienceMode} IN ('all_authenticated','restricted')`),
    check('gov_scopes_knowledge_mode_enum', sql`${t.knowledgeSourceMode} IN ('llm_only','workspaces_only')`),
    uniqueIndex('uq_gov_scopes_program_name').on(t.programId, t.name),
    index('idx_gov_scopes_program_type').on(t.programId, t.type),
    index('idx_gov_scopes_status_mode').on(t.status, t.audienceMode),
    index('idx_gov_scopes_parent').on(t.parentScopeId),
  ],
);

export const governanceScopeAgents = governanceSchema.table(
  'governance_scope_agents',
  {
    scopeId: objectId('scope_id')
      .notNull()
      .references(() => governanceScopes.id, { onDelete: 'cascade' }),
    agentId: objectId('agent_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scopeId, t.agentId] }), index('idx_gov_scope_agents_agent').on(t.agentId)],
);

export const governanceScopeAudienceUsers = governanceSchema.table(
  'governance_scope_audience_users',
  {
    scopeId: objectId('scope_id')
      .notNull()
      .references(() => governanceScopes.id, { onDelete: 'cascade' }),
    userId: objectId('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scopeId, t.userId] }), index('idx_gov_scope_aud_users_user').on(t.userId)],
);

export const governanceScopeAudienceGroups = governanceSchema.table(
  'governance_scope_audience_groups',
  {
    scopeId: objectId('scope_id')
      .notNull()
      .references(() => governanceScopes.id, { onDelete: 'cascade' }),
    groupId: objectId('group_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scopeId, t.groupId] }), index('idx_gov_scope_aud_groups_group').on(t.groupId)],
);

export const governanceDocuments = governanceSchema.table(
  'governance_documents',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    documentId: objectId('document_id').notNull(),
    workspaceId: objectId('workspace_id').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('captured'),
    validity: jsonb('validity').$type<Record<string, unknown>>().notNull(),
    validityNextReviewAt: timestamp('validity_next_review_at', { withTimezone: true }),
    validityBusinessStatus: varchar('validity_business_status', { length: 32 }),
    tags: text('tags').array().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ownerUserId: objectId('owner_user_id'),
    ownerScopeId: objectId('owner_scope_id').references(() => governanceScopes.id, { onDelete: 'set null' }),
    governanceRevision: integer('governance_revision').notNull().default(0),
    temporalDecisionRevision: integer('temporal_decision_revision').notNull().default(0),
    submittedForReviewBy: objectId('submitted_for_review_by'),
    submittedForReviewAt: timestamp('submitted_for_review_at', { withTimezone: true }),
    reviewedBy: objectId('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    approvedBy: objectId('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedBy: objectId('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    reviewComment: varchar('review_comment', { length: 2000 }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: objectId('archived_by'),
    archiveReason: varchar('archive_reason', { length: 2000 }),
    lastIntegrationEventId: varchar('last_integration_event_id', { length: 200 }),
    lastIntegrationEventAt: timestamp('last_integration_event_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('gov_docs_status_enum', sql`${t.status} IN ('captured','to_review','approved','published','rejected','archived')`),
    check('gov_docs_governance_revision_non_negative', sql`${t.governanceRevision} >= 0`),
    check('gov_docs_temporal_revision_non_negative', sql`${t.temporalDecisionRevision} >= 0`),
    uniqueIndex('uq_gov_docs_program_document').on(t.programId, t.documentId),
    index('idx_gov_docs_program_ws_status').on(t.programId, t.workspaceId, t.status),
    index('idx_gov_docs_program_review').on(t.programId, t.validityNextReviewAt),
    index('idx_gov_docs_document_updated').on(t.documentId, sql`${t.updatedAt} DESC`),
    index('idx_gov_docs_tags').using('gin', t.tags),
    index('idx_gov_docs_owner_user').on(t.ownerUserId),
    index('idx_gov_docs_owner_scope').on(t.ownerScopeId),
    index('idx_gov_docs_status').on(t.status),
  ],
);

export const governanceDocumentEvents = governanceSchema.table(
  'governance_document_events',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    governanceDocumentId: objectId('governance_document_id')
      .notNull()
      .references(() => governanceDocuments.id, { onDelete: 'cascade' }),
    documentId: objectId('document_id').notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    actorId: objectId('actor_id'),
    actorType: varchar('actor_type', { length: 16 }).notNull().default('system'),
    actorEmail: varchar('actor_email', { length: 320 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 2000 }),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    correlationId: text('correlation_id'),
    causationId: text('causation_id'),
    deduplicationKey: varchar('deduplication_key', { length: 300 }),
    ...timestamps(),
  },
  (t) => [
    check('gov_events_actor_type_enum', sql`${t.actorType} IN ('user','system','integration')`),
    index('idx_gov_events_govdoc').on(t.governanceDocumentId, sql`${t.occurredAt} DESC`),
    index('idx_gov_events_document').on(t.documentId, sql`${t.occurredAt} DESC`),
    index('idx_gov_events_prog_type').on(t.programId, t.eventType, sql`${t.occurredAt} DESC`),
    index('idx_gov_events_correlation').on(t.correlationId),
    uniqueIndex('uq_gov_events_dedup').on(t.governanceDocumentId, t.deduplicationKey).where(sql`deduplication_key IS NOT NULL`),
  ],
);

export const governanceWorkspaceBindings = governanceSchema.table(
  'governance_workspace_bindings',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    workspaceId: objectId('workspace_id').notNull(),
    visibility: varchar('visibility', { length: 20 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    ingestionMode: varchar('ingestion_mode', { length: 16 }).notNull().default('assisted'),
    defaults: jsonb('defaults').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: objectId('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('gov_bindings_visibility_enum', sql`${t.visibility} IN ('program_shared','scope_specific','multi_scope')`),
    check('gov_bindings_ingestion_mode_enum', sql`${t.ingestionMode} IN ('manual','assisted','automatic')`),
    uniqueIndex('uq_gov_bindings_program_ws').on(t.programId, t.workspaceId),
    index('idx_gov_bindings_ws_enabled').on(t.workspaceId, t.enabled),
    index('idx_gov_bindings_visibility').on(t.visibility),
  ],
);

export const governanceBindingScopes = governanceSchema.table(
  'governance_binding_scopes',
  {
    bindingId: objectId('binding_id')
      .notNull()
      .references(() => governanceWorkspaceBindings.id, { onDelete: 'cascade' }),
    scopeId: objectId('scope_id')
      .notNull()
      .references(() => governanceScopes.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.bindingId, t.scopeId] }), index('idx_gov_binding_scopes_scope').on(t.scopeId)],
);

export const governanceReconciliationRuns = governanceSchema.table(
  'governance_reconciliation_runs',
  {
    id: objectId('id').primaryKey(),
    bindingId: objectId('binding_id')
      .notNull()
      .references(() => governanceWorkspaceBindings.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    dryRun: boolean('dry_run').notNull().default(true),
    cursor: text('cursor'),
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    errors: jsonb('errors').$type<Array<{ documentId?: string; message: string }>>().notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('gov_recon_status_enum', sql`${t.status} IN ('pending','running','completed','failed')`),
    index('idx_gov_recon_binding').on(t.bindingId, sql`${t.createdAt} DESC`),
    index('idx_gov_recon_lease').on(t.status, t.leaseExpiresAt),
  ],
);

export const governanceMemberships = governanceSchema.table(
  'governance_memberships',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    scopeId: objectId('scope_id').references(() => governanceScopes.id, { onDelete: 'cascade' }),
    userId: objectId('user_id'),
    groupId: objectId('group_id'),
    invitedBy: objectId('invited_by').notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('active'),
    permissions: text('permissions').array().notNull().default([]),
    ...timestamps(),
  },
  (t) => [
    check(
      'gov_memberships_role_enum',
      sql`${t.role} IN ('program_owner','program_admin','scope_admin','scope_approver','scope_editor','scope_reviewer','scope_viewer')`,
    ),
    check('gov_memberships_status_enum', sql`${t.status} IN ('invited','active','disabled')`),
    check('gov_memberships_target_present', sql`${t.userId} IS NOT NULL OR ${t.groupId} IS NOT NULL`),
    // NULLS NOT DISTINCT lives only in 0019_governance.sql — drizzle 0.45 cannot express it.
    uniqueIndex('uq_gov_memberships_user')
      .on(t.programId, t.scopeId, t.userId)
      .where(sql`user_id IS NOT NULL`),
    uniqueIndex('uq_gov_memberships_group')
      .on(t.programId, t.scopeId, t.groupId)
      .where(sql`group_id IS NOT NULL`),
    index('idx_gov_memberships_user').on(t.userId, t.status),
    index('idx_gov_memberships_group').on(t.groupId, t.status),
    index('idx_gov_memberships_role').on(t.role),
  ],
);

export const governanceDeployments = governanceSchema.table(
  'governance_deployments',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    scopeId: objectId('scope_id')
      .notNull()
      .references(() => governanceScopes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    currentDraftRevisionId: objectId('current_draft_revision_id'),
    currentPublishedRevisionId: objectId('current_published_revision_id'),
    revisionSequence: integer('revision_sequence').notNull().default(0),
    channels: jsonb('channels').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check(
      'gov_deployments_status_enum',
      sql`${t.status} IN ('draft','dry_run','ready_for_review','published','suspended','archived')`,
    ),
    uniqueIndex('uq_gov_deployments_program_scope').on(t.programId, t.scopeId),
    index('idx_gov_deployments_status').on(t.status, sql`${t.updatedAt} DESC`),
  ],
);

export const governanceDeploymentRevisions = governanceSchema.table(
  'governance_deployment_revisions',
  {
    id: objectId('id').primaryKey(),
    deploymentId: objectId('deployment_id')
      .notNull()
      .references(() => governanceDeployments.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    agentId: objectId('agent_id'),
    allowedAgentIds: char('allowed_agent_ids', { length: 24 }).array().notNull().default([]),
    workspaceIds: char('workspace_ids', { length: 24 }).array().notNull().default([]),
    agentSnapshot: jsonb('agent_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    workspaceBindingSnapshot: jsonb('workspace_binding_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    channelSnapshot: jsonb('channel_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    scopeSnapshot: jsonb('scope_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    audienceSnapshot: jsonb('audience_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    previousAudienceSnapshot: jsonb('previous_audience_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    configurationFingerprint: text('configuration_fingerprint'),
    createdBy: objectId('created_by').notNull(),
    approvedBy: objectId('approved_by'),
    publishedBy: objectId('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('gov_revisions_status_enum', sql`${t.status} IN ('draft','dry_run','approved','published','rejected')`),
    check('gov_revisions_number_positive', sql`${t.revisionNumber} >= 1`),
    uniqueIndex('uq_gov_revisions_deployment_number').on(t.deploymentId, t.revisionNumber),
    index('idx_gov_revisions_deployment_status').on(t.deploymentId, t.status),
    index('idx_gov_revisions_fingerprint').on(t.configurationFingerprint),
  ],
);

export const governanceDryRuns = governanceSchema.table(
  'governance_dry_runs',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    scopeId: objectId('scope_id')
      .notNull()
      .references(() => governanceScopes.id, { onDelete: 'cascade' }),
    deploymentId: objectId('deployment_id')
      .notNull()
      .references(() => governanceDeployments.id, { onDelete: 'cascade' }),
    revisionId: objectId('revision_id')
      .notNull()
      .references(() => governanceDeploymentRevisions.id, { onDelete: 'cascade' }),
    conversationId: objectId('conversation_id'),
    testerId: objectId('tester_id').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('running'),
    executionMode: varchar('execution_mode', { length: 16 }).notNull().default('conversation'),
    testCases: jsonb('test_cases').$type<Array<Record<string, unknown>>>().notNull().default([]),
    checks: jsonb('checks').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check('gov_dryruns_status_enum', sql`${t.status} IN ('running','passed','failed','needs_review')`),
    check('gov_dryruns_execution_mode_enum', sql`${t.executionMode} IN ('conversation','manual')`),
    index('idx_gov_dryruns_deployment').on(t.deploymentId, sql`${t.createdAt} DESC`),
    index('idx_gov_dryruns_tester').on(t.testerId),
    index('idx_gov_dryruns_status').on(t.status),
  ],
);

export const governanceMetrics = governanceSchema.table(
  'governance_metrics',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    scopeId: objectId('scope_id').references(() => governanceScopes.id, { onDelete: 'cascade' }),
    deploymentId: objectId('deployment_id').references(() => governanceDeployments.id, { onDelete: 'cascade' }),
    agentId: objectId('agent_id'),
    channel: varchar('channel', { length: 16 }),
    type: varchar('type', { length: 120 }).notNull(),
    value: doublePrecision('value').notNull(),
    dimensions: jsonb('dimensions').$type<Record<string, string>>().notNull().default({}),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    check('gov_metrics_channel_enum', sql`${t.channel} IS NULL OR ${t.channel} IN ('widget','whatsapp','telegram','api')`),
    index('idx_gov_metrics_program_period').on(t.programId, sql`${t.periodStart} DESC`),
    index('idx_gov_metrics_type').on(t.type),
    index('idx_gov_metrics_period').on(t.periodStart, t.periodEnd),
  ],
);

export const governancePublicationAttempts = governanceSchema.table(
  'governance_publication_attempts',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id')
      .notNull()
      .references(() => governancePrograms.id, { onDelete: 'cascade' }),
    scopeId: objectId('scope_id')
      .notNull()
      .references(() => governanceScopes.id, { onDelete: 'cascade' }),
    deploymentId: objectId('deployment_id')
      .notNull()
      .references(() => governanceDeployments.id, { onDelete: 'cascade' }),
    revisionId: objectId('revision_id').references(() => governanceDeploymentRevisions.id, { onDelete: 'set null' }),
    triggeredByUserId: objectId('triggered_by_user_id').notNull(),
    triggeredByEmail: text('triggered_by_email').notNull(),
    requestedChannels: text('requested_channels').array().notNull().default([]),
    allowPartial: boolean('allow_partial').notNull().default(false),
    comment: varchar('comment', { length: 1000 }),
    status: varchar('status', { length: 12 }).notNull(),
    readinessSnapshot: jsonb('readiness_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    errorCode: text('error_code'),
    errorMessage: varchar('error_message', { length: 1000 }),
    ...timestamps(),
  },
  (t) => [
    check('gov_pub_status_enum', sql`${t.status} IN ('success','blocked','failed','partial')`),
    index('idx_gov_pub_deployment').on(t.deploymentId, sql`${t.createdAt} DESC`),
    index('idx_gov_pub_program').on(t.programId, t.status, sql`${t.createdAt} DESC`),
  ],
);
