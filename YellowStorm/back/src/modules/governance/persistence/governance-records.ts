import type {
  GovernanceChannels,
  GovernanceDeploymentStatus,
  GovernanceDocumentLifecycleStatus,
  GovernanceMembershipRole,
  GovernancePublicationAttemptStatus,
  GovernanceRevisionStatus,
  GovernanceReconciliationRunStatus,
  GovernanceScopeAudienceMode,
  GovernanceScopeKnowledgeSourceMode,
  GovernanceScopeType,
  GovernanceWorkspaceIngestionMode,
  GovernanceWorkspaceVisibility,
} from '../domain/governance-types';

/**
 * Persistence records for the governance aggregates. Ids are the migrated
 * Mongo _ids kept as 24-char strings; dates stay Date so service mappers keep
 * producing byte-identical ISO strings.
 */

export interface GovernanceProgramRecord {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  defaultLanguage: string;
  status: 'draft' | 'published' | 'archived';
  ownerUserId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceScopeAudience {
  mode: GovernanceScopeAudienceMode;
  userIds: string[];
  groupIds: string[];
}

export interface GovernanceScopeKnowledge {
  sourceMode: GovernanceScopeKnowledgeSourceMode;
  webSourcesEnabled: boolean;
  webAllowedDomains: string[];
  webBlockedDomains: string[];
}

export interface GovernanceScopeRecord {
  id: string;
  programId: string;
  parentScopeId?: string;
  name: string;
  type: GovernanceScopeType;
  status: 'active' | 'inactive';
  agentIds: string[];
  audience: GovernanceScopeAudience;
  knowledge: GovernanceScopeKnowledge;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceDocumentRecord {
  id: string;
  programId: string;
  documentId: string;
  workspaceId: string;
  status: GovernanceDocumentLifecycleStatus;
  validity: Record<string, unknown>;
  tags: string[];
  metadata: Record<string, unknown>;
  ownerUserId?: string;
  ownerScopeId?: string;
  governanceRevision: number;
  temporalDecisionRevision: number;
  submittedForReviewBy?: string;
  submittedForReviewAt?: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  approvedBy?: string;
  approvedAt?: Date;
  publishedBy?: string;
  publishedAt?: Date;
  reviewComment?: string;
  archivedAt?: Date;
  archivedBy?: string;
  archiveReason?: string;
  lastIntegrationEventId?: string;
  lastIntegrationEventAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceDocumentEventRecord {
  id: string;
  programId: string;
  governanceDocumentId: string;
  documentId: string;
  eventType: string;
  actorId?: string;
  actorType: 'user' | 'system' | 'integration';
  actorEmail?: string;
  occurredAt: Date;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  deduplicationKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceBindingRecord {
  id: string;
  programId: string;
  workspaceId: string;
  visibility: GovernanceWorkspaceVisibility;
  scopeIds: string[];
  enabled: boolean;
  ingestionMode: GovernanceWorkspaceIngestionMode;
  defaults: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceReconciliationRunRecord {
  id: string;
  bindingId: string;
  status: GovernanceReconciliationRunStatus;
  dryRun: boolean;
  cursor?: string;
  stats: Record<string, number>;
  errors: { documentId?: string; message: string }[];
  startedAt?: Date;
  completedAt?: Date;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceMembershipRecord {
  id: string;
  programId: string;
  scopeId?: string;
  userId?: string;
  groupId?: string;
  invitedBy: string;
  role: GovernanceMembershipRole;
  status: 'invited' | 'active' | 'disabled';
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceDeploymentRecord {
  id: string;
  programId: string;
  scopeId: string;
  name: string;
  status: GovernanceDeploymentStatus;
  currentDraftRevisionId?: string;
  currentPublishedRevisionId?: string;
  revisionSequence: number;
  channels: GovernanceChannels | Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceRevisionRecord {
  id: string;
  deploymentId: string;
  revisionNumber: number;
  status: GovernanceRevisionStatus;
  agentId?: string;
  allowedAgentIds: string[];
  workspaceIds: string[];
  agentSnapshot: Record<string, unknown>;
  workspaceBindingSnapshot: Record<string, unknown>;
  channelSnapshot: Record<string, unknown>;
  scopeSnapshot: Record<string, unknown>;
  audienceSnapshot: Record<string, unknown>;
  previousAudienceSnapshot: Record<string, unknown>;
  configurationFingerprint?: string;
  createdBy: string;
  approvedBy?: string;
  publishedBy?: string;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceDryRunRecord {
  id: string;
  programId: string;
  scopeId: string;
  deploymentId: string;
  revisionId: string;
  conversationId?: string;
  testerId: string;
  status: 'running' | 'passed' | 'failed' | 'needs_review';
  executionMode: 'conversation' | 'manual';
  testCases: Record<string, unknown>[];
  checks: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernancePublicationAttemptRecord {
  id: string;
  programId: string;
  scopeId: string;
  deploymentId: string;
  revisionId?: string;
  triggeredByUserId: string;
  triggeredByEmail: string;
  requestedChannels: string[];
  allowPartial: boolean;
  comment?: string;
  status: GovernancePublicationAttemptStatus;
  readinessSnapshot: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceMetricRecord {
  id: string;
  programId: string;
  scopeId?: string;
  deploymentId?: string;
  agentId?: string;
  channel?: string;
  type: string;
  value: number;
  dimensions: Record<string, string>;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Thrown by stores when a unique constraint would be violated (Mongo 11000 / PG 23505). */
export class DuplicateKeyError extends Error {
  constructor(message = 'duplicate key') {
    super(message);
    this.name = 'DuplicateKeyError';
  }
}
