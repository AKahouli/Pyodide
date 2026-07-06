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
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
}

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

export type GovernanceMembershipRole = 'program_owner' | 'program_admin' | 'scope_admin' | 'scope_editor' | 'scope_reviewer' | 'scope_viewer';

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
  workspaceIds: string[];
  sourceIds: string[];
  includedSourceIds: string[];
  excludedSourceIds: string[];
  createdBy: string;
  publishedBy?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGovernanceRevisionPayload {
  agentId: string;
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
  input?: string;
  simulatedChannel?: 'widget' | 'whatsapp' | 'telegram' | 'api';
  conversationId?: string;
  agentId?: string;
}

export interface GovernanceDryRunMessage {
  id: string;
  conversationType: 'user' | 'ai';
  content?: string;
  components?: Array<{ type: string; data?: Record<string, unknown> }>;
  createdAt: string;
}

export interface GovernanceMetric {
  id: string;
  programId: string;
  scopeId?: string;
  deploymentId?: string;
  channel?: string;
  type: string;
  value: number;
  periodStart: string;
  periodEnd: string;
}

export interface GovernanceScopeOverview {
  scope: GovernanceScope;
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
