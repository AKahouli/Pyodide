export type GovernanceStatus = 'draft' | 'dry_run' | 'ready_for_review' | 'published' | 'suspended' | 'archived';

export interface GovernanceProgram {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  defaultLanguage: string;
  status: 'draft' | 'published' | 'archived';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceScope {
  id: string;
  programId: string;
  parentScopeId?: string;
  agentIds: string[];
  name: string;
  type: 'organization' | 'municipality' | 'department' | 'business_unit' | 'country' | 'team' | 'custom';
  status: 'active' | 'inactive';
  metadata?: GovernanceScopeMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceScopeAudienceConfiguration {
  mode: 'all_authenticated' | 'restricted';
  users: GovernanceUserSearchResult[];
  groups: Array<{ id: string; name: string; memberCount: number }>;
  estimatedAuthorizedUserCount?: number;
}

export interface AvailableGovernedScope {
  scopeId: string; programId: string; name: string; type: GovernanceScope['type']; description?: string;
  deploymentId: string; publishedRevisionId: string; revisionNumber: number; publishedAt?: string;
  primaryAgent: { id: string; name: string; description?: string };
  agentCount: number; workspaceCount: number;
  presentation: { icon?: string; accent?: string; shortLabel?: string };
}

export type GovernanceScopeAudience = 'public_facing' | 'internal_only';
export type GovernanceScopeRiskLevel = 'standard' | 'high_risk';
export type GovernanceScopeCompliance = 'none' | 'regulated';
export type GovernanceScopeStage = 'pilot' | 'production';
export type GovernanceScopeReviewStatus = 'not_started' | 'in_review' | 'ready_for_approval' | 'approved' | 'rejected';

export interface GovernanceScopeReviewChecklistItem {
  key: string;
  checked: boolean;
  checkedAt?: string;
  checkedBy?: string;
}

export interface GovernanceScopeMetadata {
  description?: string;
  classification?: {
    audience?: GovernanceScopeAudience;
    riskLevel?: GovernanceScopeRiskLevel;
    compliance?: GovernanceScopeCompliance;
    stage?: GovernanceScopeStage;
  };
  review?: {
    status?: GovernanceScopeReviewStatus;
    checklist?: GovernanceScopeReviewChecklistItem[];
    reviewFrequencyDays?: number;
    lastReviewedAt?: string;
    nextReviewAt?: string;
    rejectedAt?: string;
    rejectedBy?: string;
  };
  [key: string]: unknown;
}

export interface GovernanceSource {
  id: string;
  programId: string;
  scopeIds?: string[];
  visibility: 'program_shared' | 'scope_specific' | 'multi_scope';
  title: string;
  sourceType: 'pdf' | 'web_page' | 'api' | 'manual_record' | 'spreadsheet';
  url?: string;
  workspaceId?: string;
  documentId?: string;
  status: 'draft' | 'to_review' | 'validated' | 'published' | 'expired' | 'rejected';
  tags: string[];
  metadata?: Record<string, unknown>;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  reviewFrequencyDays?: number;
  isArchived: boolean;
  archivedAt?: string;
  archiveReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type GovernanceSourceVersionLifecycleStatus = 'captured' | 'to_review' | 'approved' | 'published' | 'rejected' | 'superseded';
export type GovernanceSourceVersionTechnicalStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type GovernanceSourceValidityEvidenceOrigin = 'manual' | 'technical_metadata' | 'http_header' | 'html_metadata' | 'structured_data' | 'document_metadata' | 'logical_search' | 'llm_extraction' | 'policy';
export interface GovernanceSourceValidityEvidence { id: string; field: 'effectiveFrom' | 'effectiveUntil' | 'publishedAt' | 'modifiedAt' | 'validityMode'; value?: unknown; origin: GovernanceSourceValidityEvidenceOrigin; confidence: number; documentId?: string; page?: number; sectionId?: string; blockId?: string; excerpt?: string; validatedBy?: string; validatedAt?: string; extractionMethod?: string; sourceVersionId?: string; sourceUrl?: string; capturedAt?: string; isCritical?: boolean; supersedesEvidenceId?: string; }
export interface GovernanceSourceValidity { mode: 'fixed_date' | 'relative_duration' | 'until_replaced' | 'until_funds_exhausted' | 'open_ended' | 'unknown'; businessStatus: 'unknown' | 'scheduled' | 'valid' | 'needs_review' | 'expired' | 'conflicting' | 'suspended'; confidence: number; effectiveFrom?: string | null; effectiveUntil?: string | null; inclusiveEnd?: boolean; lastReviewedAt?: string | null; nextReviewAt?: string | null; reviewFrequencyDays?: number | null; evidence?: GovernanceSourceValidityEvidence[]; manuallyOverridden?: boolean; }
export interface GovernanceSourceVersion { id: string; sourceId: string; programId: string; versionNumber: number; lifecycleStatus: GovernanceSourceVersionLifecycleStatus; technicalStatus: GovernanceSourceVersionTechnicalStatus; validity: GovernanceSourceValidity; capturedAt: string; canonicalUrl?: string; contentHash?: string; reviewComment?: string; submittedForReviewAt?: string; reviewedAt?: string; approvedAt?: string; publishedAt?: string; indexingAttemptId?: string; }
export interface GovernanceTemporalCandidate { candidateId: string; field: 'effectiveFrom' | 'effectiveUntil' | 'publishedAt' | 'modifiedAt' | 'validityMode'; value?: string; mode?: GovernanceSourceValidity['mode']; interpretation: string; confidence: number; evidenceRefs: string[]; reasoningSummary: string; criticality: 'low' | 'medium' | 'high'; }
export interface GovernanceTemporalCandidateRecord { id: string; candidate: GovernanceTemporalCandidate; validation: { status: 'accepted_candidate' | 'ambiguous' | 'conflicting' | 'rejected'; issues: Array<{ code: string; severity: 'warning' | 'blocking'; message: string }> }; evidence: GovernanceSourceValidityEvidence[]; decisionStatus: 'pending' | 'processing' | 'confirmed' | 'corrected' | 'rejected'; decidedAt?: string; decisionComment?: string; }
export interface GovernanceSourceEvent { id: string; sourceId: string; versionId?: string; eventType: string; occurredAt: string; reason?: string; }
export interface CreateGovernanceWorkspaceBindingPayload { workspaceId: string; visibility: 'program_shared' | 'scope_specific' | 'multi_scope'; scopeIds?: string[]; ingestionMode?: 'manual' | 'assisted' | 'automatic'; defaults?: Record<string, unknown>; }
export interface GovernanceWorkspaceBinding extends CreateGovernanceWorkspaceBindingPayload { id: string; programId: string; enabled: boolean; createdAt: string; updatedAt: string; }
export interface GovernanceWorkspaceReconciliationResult { bindingId: string; scannedDocuments: number; missingSources: number; missingVersions: number; repairedStatuses: number; missingArtifacts: number; emittedEvents: number; errors: Array<{ documentId?: string; sourceId?: string; message: string }>; }
export interface GovernanceReconciliationRun { id: string; bindingId: string; status: 'pending' | 'running' | 'completed' | 'failed'; dryRun: boolean; cursor?: string; stats: Partial<Omit<GovernanceWorkspaceReconciliationResult, 'bindingId' | 'errors'>>; errors: GovernanceWorkspaceReconciliationResult['errors']; startedAt?: string; completedAt?: string; createdAt: string; updatedAt: string; }

export type KnowledgeHealthStatus = 'healthy' | 'warning' | 'critical';
export type KnowledgePriority = 'critical' | 'high' | 'medium' | 'low';
export interface KnowledgeAssessmentFactor { code: string; contribution: number; message: string; evidenceRefs?: string[]; }
export interface KnowledgeAssessmentDimension { score: number; status: 'pass' | 'warning' | 'fail' | 'unknown'; factors: KnowledgeAssessmentFactor[]; }
export interface KnowledgeAssessment { id: string; programId: string; scopeIds: string[]; sourceId: string; sourceVersionId: string; assessedAt: string; assessmentVersion: string; overallHealthScore: number; status: KnowledgeHealthStatus; summary: string; dimensions: Record<'businessValidity' | 'freshness' | 'availability' | 'integrity' | 'searchQuality' | 'governanceQuality', KnowledgeAssessmentDimension>; }
export interface KnowledgeHealthSummary { totalSources: number; averageHealthScore: number; byStatus: Record<KnowledgeHealthStatus, number>; assessments: KnowledgeAssessment[]; }
export interface KnowledgeAlert { id: string; programId: string; scopeIds: string[]; sourceId?: string; sourceVersionId?: string; category: 'validity' | 'freshness' | 'availability' | 'integrity' | 'governance' | 'search_quality' | 'impact'; severity: KnowledgePriority; status: 'open' | 'acknowledged' | 'resolved' | 'ignored'; title: string; description: string; evidenceRefs: string[]; openedAt: string; }
export type KnowledgeRecommendationType = 'assign_owner' | 'schedule_review' | 'confirm_validity' | 'resolve_conflict' | 'enrich_metadata' | 'add_synonyms' | 'merge_duplicate' | 'reindex' | 'change_scope' | 'exclude_from_runtime';
export interface KnowledgeRecommendation { id: string; programId: string; scopeIds: string[]; sourceId?: string; sourceVersionId?: string; type: KnowledgeRecommendationType; priority: KnowledgePriority; reason: string; impactSummary: string; proposedAction?: Record<string, unknown>; status: 'proposed' | 'accepted' | 'rejected' | 'applied' | 'superseded'; }
export interface GovernanceMetadataCandidate { id: string; programId: string; scopeIds: string[]; sourceId: string; sourceVersionId: string; key: string; proposedValue: unknown; candidateType: 'document' | 'business' | 'search'; confidence: number; riskLevel: 'low' | 'medium' | 'high'; evidenceRefs: string[]; status: 'proposed' | 'accepted' | 'rejected' | 'superseded'; acceptedValue?: unknown; }
export interface KnowledgeListFilter { scopeId?: string; status?: string; category?: string; severity?: KnowledgePriority; priority?: KnowledgePriority; }

export interface CreateGovernanceProgramPayload {
  name: string;
  description?: string;
  domain?: string;
  defaultLanguage?: string;
}

export type UpdateGovernanceProgramPayload = Partial<CreateGovernanceProgramPayload>;

export interface CreateGovernanceScopePayload {
  name: string;
  type?: GovernanceScope['type'];
  parentScopeId?: string;
  agentIds?: string[];
}

export type UpdateGovernanceScopePayload = Partial<CreateGovernanceScopePayload> & {
  status?: GovernanceScope['status'];
  metadata?: GovernanceScopeMetadata;
};

export interface CreateGovernanceSourcePayload {
  title: string;
  visibility: GovernanceSource['visibility'];
  sourceType: GovernanceSource['sourceType'];
  scopeIds?: string[];
  url?: string;
  workspaceId?: string;
  documentId?: string;
  tags?: string[];
}

export type UpdateGovernanceSourcePayload = Partial<CreateGovernanceSourcePayload> & {
  status?: GovernanceSource['status'];
};

export interface GovernanceReadinessCheck {
  key: string;
  label: string;
  status: 'passed' | 'warning' | 'failed';
  severity: 'info' | 'warning' | 'blocking';
  message?: string;
  targetType?: 'source' | 'channel' | 'dry_run' | 'agent' | 'workspace' | 'rule';
  targetId?: string;
}

export interface GovernanceReadiness {
  deploymentId: string;
  score: number;
  status: 'ready' | 'blocked' | 'warning';
  blockers: GovernanceReadinessCheck[];
  warnings: GovernanceReadinessCheck[];
  checks: GovernanceReadinessCheck[];
}

export type GovernanceMembershipRole = 'program_owner' | 'program_admin' | 'scope_admin' | 'scope_approver' | 'scope_editor' | 'scope_reviewer' | 'scope_viewer';

export interface GovernanceMembership {
  id: string;
  programId: string;
  scopeId?: string;
  userId?: string;
  groupId?: string;
  invitedBy: string;
  role: GovernanceMembershipRole;
  status: 'invited' | 'active' | 'disabled';
  permissions: string[];
  user?: GovernanceUserSearchResult;
  group?: { id: string; name: string; memberCount: number };
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceUserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface CreateGovernanceMembershipPayload {
  userId?: string;
  groupId?: string;
  scopeId?: string;
  role: GovernanceMembershipRole;
  status?: GovernanceMembership['status'];
}

export type UpdateGovernanceMembershipPayload = Partial<Omit<CreateGovernanceMembershipPayload, 'userId'>>;

export type GovernanceChannels = Record<string, unknown>;

export interface GovernanceDeployment {
  id: string;
  programId: string;
  scopeId: string;
  name: string;
  status: GovernanceStatus;
  currentDraftRevisionId?: string;
  currentPublishedRevisionId?: string;
  channels: GovernanceChannels;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGovernanceDeploymentPayload {
  scopeId: string;
  name: string;
  channels?: GovernanceChannels;
}

export interface UpdateGovernanceDeploymentPayload {
  name?: string;
  channels?: GovernanceChannels;
}

export interface GovernanceChannelConfig {
  enabled?: boolean;
  status?: 'not_configured' | 'ready' | 'blocked' | string;
  allowedOrigins?: string[];
}

export interface GovernanceDeploymentRevision {
  id: string;
  deploymentId: string;
  revisionNumber: number;
  status: 'draft' | 'dry_run' | 'approved' | 'published' | 'rejected';
  agentId: string;
  allowedAgentIds: string[];
  workspaceIds: string[];
  sourceIds: string[];
  includedSourceIds: string[];
  excludedSourceIds: string[];
  sourceSnapshot: Record<string, { title?: string; sourceType?: string; workspaceId?: string }>;
  workspaceBindingSnapshot: Record<string, { workspaceId?: string; visibility?: string; ingestionMode?: string; defaults?: Record<string, unknown> }>;
  configurationFingerprint?: string;
  scopeSnapshot: Record<string, unknown>;
  audienceSnapshot: Record<string, unknown>;
  previousAudienceSnapshot: Record<string, unknown>;
  createdBy: string;
  createdByUser?: { id: string; displayName: string; email: string };
  publishedBy?: string;
  publishedByUser?: { id: string; displayName: string; email: string };
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGovernanceRevisionPayload {
  agentId: string;
  allowedAgentIds?: string[];
  workspaceIds?: string[];
  sourceIds?: string[];
}

export interface GovernanceDryRun {
  id: string;
  programId: string;
  scopeId: string;
  deploymentId: string;
  revisionId: string;
  conversationId?: string;
  testerId: string;
  status: 'running' | 'passed' | 'failed' | 'needs_review';
  testCases: Array<Record<string, unknown>>;
  checks: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGovernanceDryRunPayload {
  executionMode?: 'conversation' | 'manual';
  input?: string;
  simulatedChannel?: 'widget' | 'whatsapp' | 'telegram' | 'api';
  conversationId?: string;
  agentId?: string;
  workspaceIds?: string[];
  testCases?: Array<Record<string, unknown>>;
  checks?: Record<string, unknown>;
}

export interface GovernanceMetric {
  id: string;
  programId: string;
  scopeId?: string;
  deploymentId?: string;
  channel?: string;
  type: string;
  value: number;
  dimensions?: Record<string, string>;
  periodStart: string;
  periodEnd: string;
}

export interface GovernanceScopeOverview {
  scope: GovernanceScope;
  authorization: { canApprove: boolean };
  readiness: Omit<GovernanceReadiness, 'deploymentId'>;
  knowledge: {
    sharedSources: GovernanceSource[];
    localSources: GovernanceSource[];
    workspaceMappings: GovernanceSource[];
    reviewBlockers: GovernanceReadinessCheck[];
  };
  agents: {
    mappedAgents: Array<{ id: string; isPrimary: boolean }>;
    primaryAgentId?: string;
    missingAgent: boolean;
  };
  deployment?: GovernanceDeployment;
  draftRevision?: GovernanceDeploymentRevision;
  publishedRevision?: GovernanceDeploymentRevision;
  channels: GovernanceChannels;
  latestDryRun?: GovernanceDryRun;
  metricsSummary: {
    totalEvents: number;
    byChannel: Record<string, number>;
    byType: Record<string, number>;
  };
}
