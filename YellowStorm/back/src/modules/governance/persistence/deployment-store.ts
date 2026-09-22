import type { GovernanceDeploymentRecord } from './governance-records';

export const DEPLOYMENT_STORE = Symbol('GOVERNANCE_DEPLOYMENT_STORE');

export interface GovernanceDeploymentCreateInput {
  programId: string;
  scopeId: string;
  name: string;
  channels?: Record<string, unknown>;
}

export interface GovernanceDeploymentPatch {
  name?: string;
  channels?: Record<string, unknown>;
  status?: GovernanceDeploymentRecord['status'];
  currentPublishedRevisionId?: string;
  currentDraftRevisionId?: string;
}

/** Internal write/read store for governance_deployments. */
export interface DeploymentStore {
  insert(input: GovernanceDeploymentCreateInput): Promise<GovernanceDeploymentRecord>;
  findById(deploymentId: string): Promise<GovernanceDeploymentRecord | null>;
  findByProgramAndScope(programId: string, scopeId: string): Promise<GovernanceDeploymentRecord | null>;
  listByProgramScopes(programId: string, scopeIds: string[] | '*'): Promise<GovernanceDeploymentRecord[]>;
  /** Published deployments of the scopes that already carry a published revision pointer. */
  listPublishedByScopes(scopeIds: string[]): Promise<GovernanceDeploymentRecord[]>;
  update(deploymentId: string, patch: GovernanceDeploymentPatch): Promise<GovernanceDeploymentRecord | null>;
  /** Scope deactivation: flips a published deployment to suspended; true when it changed. */
  suspendPublished(programId: string, scopeId: string): Promise<boolean>;
  /**
   * Publish swap guarded on the observed draft revision and on the revision not
   * being the published one already (Mongo findOneAndUpdate semantics); null
   * when the guard fails.
   */
  publishGuarded(deploymentId: string, draftRevisionId: string, revisionId: string): Promise<GovernanceDeploymentRecord | null>;
  /** revisionSequence = max(revisionSequence, min) (draft preparation floor). */
  maxRevisionSequence(deploymentId: string, min: number): Promise<void>;
  /** $inc revisionSequence guarded on the current draft revision pointer (`null` = none, `undefined` = unguarded). */
  incrementRevisionSequenceGuarded(deploymentId: string, expectedDraftRevisionId: string | null | undefined): Promise<GovernanceDeploymentRecord | null>;
  /** Draft pointer swap guarded on revisionSequence; false when another writer sequenced first. */
  setDraftRevisionIfSequence(deploymentId: string, revisionSequence: number, revisionId: string): Promise<boolean>;
  /** Set-based delete for a whole scope subtree; no-op for an empty list. */
  deleteByProgramAndScopeIds(programId: string, scopeIds: string[]): Promise<void>;
  deleteByIds(deploymentIds: string[]): Promise<void>;
  listByProgram(programId: string): Promise<GovernanceDeploymentRecord[]>;
}
