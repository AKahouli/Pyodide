import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, objectIdArray, timestamps } from '../../../common/postgres/columns';
import { governanceSchema } from './governance.schema';

/**
 * Knowledge-intelligence tables (roadmap P6) in the governance schema: alerts,
 * assessments, extraction jobs, recommendations, metadata candidates and temporal
 * candidate records. `scope_ids` stays an array of scope ids (queried with `&&`);
 * everything else references its parent with a real foreign key.
 */
const PRIORITIES = sql.raw(`'critical','high','medium','low'`);

export const governanceKnowledgeAlerts = governanceSchema.table(
  'knowledge_alerts',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id').notNull(),
    scopeIds: objectIdArray('scope_ids').notNull().default(sql`'{}'::char(24)[]`),
    documentId: objectId('document_id'),
    category: varchar('category', { length: 24 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    deduplicationKey: text('deduplication_key').notNull(),
    evidenceRefs: text('evidence_refs').array().notNull().default(sql`'{}'::text[]`),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    acknowledgedBy: objectId('acknowledged_by'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('gov_ka_category', sql`${t.category} IN ('validity','freshness','availability','integrity','governance','search_quality','impact')`),
    check('gov_ka_severity', sql`${t.severity} IN (${PRIORITIES})`),
    check('gov_ka_status', sql`${t.status} IN ('open','acknowledged','resolved','ignored')`),
    uniqueIndex('uq_gov_ka_program_dedup').on(t.programId, t.deduplicationKey),
    index('idx_gov_ka_program_status').on(t.programId, t.status, t.severity, t.openedAt.desc()),
    index('idx_gov_ka_scope_ids').using('gin', t.scopeIds),
    index('idx_gov_ka_document').on(t.documentId),
  ],
);

export const governanceKnowledgeAssessments = governanceSchema.table(
  'knowledge_assessments',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id').notNull(),
    scopeIds: objectIdArray('scope_ids').notNull().default(sql`'{}'::char(24)[]`),
    documentId: objectId('document_id').notNull(),
    assessmentVersion: text('assessment_version').notNull(),
    inputHash: text('input_hash').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),
    dimensions: jsonb('dimensions').$type<Record<string, unknown>>().notNull(),
    overallHealthScore: doublePrecision('overall_health_score').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    summary: text('summary').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('gov_kas_score', sql`${t.overallHealthScore} BETWEEN 0 AND 100`),
    check('gov_kas_status', sql`${t.status} IN ('healthy','warning','critical')`),
    uniqueIndex('uq_gov_kas_identity').on(t.programId, t.documentId, t.assessmentVersion, t.inputHash),
    index('idx_gov_kas_program_status').on(t.programId, t.status, t.assessedAt.desc()),
    index('idx_gov_kas_document_assessed').on(t.documentId, t.assessedAt.desc()),
    index('idx_gov_kas_scope_ids').using('gin', t.scopeIds),
  ],
);

export const governanceKnowledgeExtractionJobs = governanceSchema.table(
  'knowledge_extraction_jobs',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id').notNull(),
    documentId: objectId('document_id').notNull(),
    connectorId: objectId('connector_id').notNull(),
    requestedByUserId: objectId('requested_by_user_id'),
    jobType: varchar('job_type', { length: 24 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    inputHash: text('input_hash').notNull(),
    engineVersion: text('engine_version').notNull(),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    leaseToken: text('lease_token'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('gov_kej_type', sql`${t.jobType} IN ('technical_metadata','temporal_extraction','metadata_enrichment')`),
    check('gov_kej_status', sql`${t.status} IN ('pending','running','completed','failed','cancelled')`),
    check('gov_kej_attempts', sql`${t.attempts} >= 0`),
    uniqueIndex('uq_gov_kej_identity').on(t.programId, t.documentId, t.jobType, t.inputHash, t.engineVersion),
    index('idx_gov_kej_status_created').on(t.status, t.createdAt),
    index('idx_gov_kej_status_lease').on(t.status, t.leaseExpiresAt, t.createdAt),
    index('idx_gov_kej_document_created').on(t.documentId, t.createdAt.desc()),
  ],
);

export const governanceKnowledgeRecommendations = governanceSchema.table(
  'knowledge_recommendations',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id').notNull(),
    scopeIds: objectIdArray('scope_ids').notNull().default(sql`'{}'::char(24)[]`),
    documentId: objectId('document_id'),
    alertIds: objectIdArray('alert_ids').notNull().default(sql`'{}'::char(24)[]`),
    type: varchar('type', { length: 24 }).notNull(),
    priority: varchar('priority', { length: 16 }).notNull(),
    reason: text('reason').notNull(),
    impactSummary: text('impact_summary').notNull(),
    proposedAction: jsonb('proposed_action').$type<Record<string, unknown>>(),
    status: varchar('status', { length: 16 }).notNull().default('proposed'),
    deduplicationKey: text('deduplication_key').notNull(),
    decidedBy: objectId('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    appliedBy: objectId('applied_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    applicationToken: text('application_token'),
    applicationLeaseExpiresAt: timestamp('application_lease_expires_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check(
      'gov_kr_type',
      sql`${t.type} IN ('assign_owner','schedule_review','confirm_validity','resolve_conflict','enrich_metadata','add_synonyms','merge_duplicate','reindex','change_scope','exclude_from_runtime')`,
    ),
    check('gov_kr_priority', sql`${t.priority} IN (${PRIORITIES})`),
    check('gov_kr_status', sql`${t.status} IN ('proposed','accepted','rejected','applied','superseded')`),
    uniqueIndex('uq_gov_kr_program_dedup').on(t.programId, t.deduplicationKey),
    index('idx_gov_kr_program_status').on(t.programId, t.status, t.priority, t.createdAt.desc()),
    index('idx_gov_kr_scope_ids').using('gin', t.scopeIds),
    index('idx_gov_kr_document').on(t.documentId),
  ],
);

export const governanceMetadataCandidates = governanceSchema.table(
  'metadata_candidates',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id').notNull(),
    scopeIds: objectIdArray('scope_ids').notNull().default(sql`'{}'::char(24)[]`),
    documentId: objectId('document_id').notNull(),
    key: text('key').notNull(),
    proposedValue: jsonb('proposed_value').$type<unknown>().notNull(),
    candidateType: varchar('candidate_type', { length: 16 }).notNull(),
    confidence: doublePrecision('confidence').notNull(),
    riskLevel: varchar('risk_level', { length: 16 }).notNull(),
    evidenceRefs: text('evidence_refs').array().notNull().default(sql`'{}'::text[]`),
    status: varchar('status', { length: 16 }).notNull().default('proposed'),
    candidateKey: text('candidate_key').notNull(),
    acceptedValue: jsonb('accepted_value').$type<unknown>(),
    decidedBy: objectId('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    ...timestamps(),
  },
  (t) => [
    check('gov_mc_type', sql`${t.candidateType} IN ('document','business','search')`),
    check('gov_mc_confidence', sql`${t.confidence} BETWEEN 0 AND 1`),
    check('gov_mc_risk', sql`${t.riskLevel} IN ('low','medium','high')`),
    check('gov_mc_status', sql`${t.status} IN ('proposed','accepted','rejected','superseded')`),
    uniqueIndex('uq_gov_mc_identity').on(t.programId, t.documentId, t.candidateKey),
    index('idx_gov_mc_program_status').on(t.programId, t.status, t.createdAt.desc()),
    index('idx_gov_mc_scope_ids').using('gin', t.scopeIds),
    index('idx_gov_mc_document').on(t.documentId),
  ],
);

export const governanceTemporalCandidateRecords = governanceSchema.table(
  'temporal_candidate_records',
  {
    id: objectId('id').primaryKey(),
    programId: objectId('program_id').notNull(),
    documentId: objectId('document_id').notNull(),
    jobId: objectId('job_id').notNull(),
    candidateId: text('candidate_id').notNull(),
    candidate: jsonb('candidate').$type<Record<string, unknown>>().notNull(),
    validation: jsonb('validation').$type<Record<string, unknown>>().notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>[]>().notNull().default([]),
    decisionStatus: varchar('decision_status', { length: 16 }).notNull().default('pending'),
    decisionLeaseExpiresAt: timestamp('decision_lease_expires_at', { withTimezone: true }),
    decisionToken: text('decision_token'),
    decidedBy: objectId('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionComment: text('decision_comment'),
    correctedCandidate: jsonb('corrected_candidate').$type<Record<string, unknown>>(),
    inputHash: text('input_hash').notNull(),
    engineVersion: text('engine_version').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('gov_tcr_status', sql`${t.decisionStatus} IN ('pending','processing','confirmed','corrected','rejected')`),
    uniqueIndex('uq_gov_tcr_identity').on(t.programId, t.documentId, t.candidateId, t.inputHash),
    index('idx_gov_tcr_document_status').on(t.documentId, t.decisionStatus, t.createdAt.desc()),
    index('idx_gov_tcr_job').on(t.jobId),
  ],
);
