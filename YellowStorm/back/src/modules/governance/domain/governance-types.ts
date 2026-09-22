/**
 * Shared governance enum unions. Lived on the Mongoose schema classes until the
 * Step E PostgreSQL cutover removed `governance/schemas/`; the wire values are
 * unchanged.
 */

export type GovernanceScopeType =
  | 'organization'
  | 'municipality'
  | 'department'
  | 'business_unit'
  | 'country'
  | 'team'
  | 'custom';

export type GovernanceScopeKnowledgeSourceMode = 'llm_only' | 'workspaces_only';

export type GovernanceScopeAudienceMode = 'all_authenticated' | 'restricted';

export type GovernanceDocumentLifecycleStatus =
  | 'captured'
  | 'to_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'archived';

export type GovernanceDocumentEventType =
  | 'document.governance_created'
  | 'document.captured'
  | 'document.submitted_for_review'
  | 'document.returned_to_editing'
  | 'document.approved'
  | 'document.rejected'
  | 'document.published'
  | 'document.archived'
  | 'document.restored'
  | 'document.governance_deleted'
  | 'validity.updated'
  | 'validity.review_due'
  | 'validity.candidate_decided'
  | 'knowledge.assessed'
  | 'knowledge.recommendation_applied'
  | 'metadata.candidate_decided';

export type GovernanceMembershipRole =
  | 'program_owner'
  | 'program_admin'
  | 'scope_admin'
  | 'scope_approver'
  | 'scope_editor'
  | 'scope_reviewer'
  | 'scope_viewer';

export type GovernanceDeploymentStatus = 'draft' | 'dry_run' | 'ready_for_review' | 'published' | 'suspended' | 'archived';

export interface GovernanceChannels {
  widget?: { enabled: boolean; tokenId?: string; allowedOrigins?: string[]; status?: string };
  whatsapp?: { enabled: boolean; integrationId?: string; phoneNumber?: string; status?: string };
  telegram?: { enabled: boolean; integrationId?: string; botUsername?: string; status?: string };
}

export type GovernanceRevisionStatus = 'draft' | 'dry_run' | 'approved' | 'published' | 'rejected';

export type GovernanceWorkspaceIngestionMode = 'manual' | 'assisted' | 'automatic';

export type GovernanceWorkspaceVisibility = 'program_shared' | 'scope_specific' | 'multi_scope';

export type GovernanceReconciliationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type GovernancePublicationAttemptStatus = 'success' | 'blocked' | 'failed' | 'partial';
