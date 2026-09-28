import type { GovernanceRevisionRecord } from './governance-records';


export interface GovernanceRevisionCreateInput {
  deploymentId: string;
  revisionNumber: number;
  status?: GovernanceRevisionRecord['status'];
  agentId?: string;
  allowedAgentIds?: string[];
  workspaceIds?: string[];
  agentSnapshot?: Record<string, unknown>;
  workspaceBindingSnapshot?: Record<string, unknown>;
  channelSnapshot?: Record<string, unknown>;
  scopeSnapshot?: Record<string, unknown>;
  audienceSnapshot?: Record<string, unknown>;
  previousAudienceSnapshot?: Record<string, unknown>;
  configurationFingerprint?: string;
  createdBy: string;
}

export interface GovernanceRevisionPatch {
  agentId?: string;
  allowedAgentIds?: string[];
  workspaceIds?: string[];
  agentSnapshot?: Record<string, unknown>;
  status?: GovernanceRevisionRecord['status'];
  /** `null` clears the field (Mongo save() with undefined). */
  publishedBy?: string | null;
  publishedAt?: Date | null;
}

/** Internal write/read store for governance_deployment_revisions. */
export interface RevisionStore {
  insert(input: GovernanceRevisionCreateInput): Promise<GovernanceRevisionRecord>;
  countByDeployment(deploymentId: string): Promise<number>;
  findById(revisionId: string): Promise<GovernanceRevisionRecord | null>;
  findByDeploymentAndId(deploymentId: string, revisionId: string): Promise<GovernanceRevisionRecord | null>;
  listByDeployment(deploymentId: string): Promise<GovernanceRevisionRecord[]>;
  listByIds(revisionIds: string[]): Promise<GovernanceRevisionRecord[]>;
  update(revisionId: string, patch: GovernanceRevisionPatch): Promise<GovernanceRevisionRecord | null>;
  /** Most recent other published revision (rollback target). */
  findPreviousPublished(deploymentId: string, excludeRevisionId: string): Promise<GovernanceRevisionRecord | null>;
  deleteByIdAndStatus(revisionId: string, status: GovernanceRevisionRecord['status']): Promise<boolean>;
  deleteByDeploymentIds(deploymentIds: string[]): Promise<void>;
}
