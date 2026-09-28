import type { GovernanceDryRunRecord } from './governance-records';


export interface GovernanceDryRunCreateInput {
  programId: string;
  scopeId: string;
  deploymentId: string;
  revisionId: string;
  conversationId?: string;
  testerId: string;
  status: GovernanceDryRunRecord['status'];
  executionMode: GovernanceDryRunRecord['executionMode'];
  testCases?: Array<Record<string, unknown>>;
  checks?: Record<string, unknown>;
}

export interface GovernanceDryRunPatch {
  status?: GovernanceDryRunRecord['status'];
  checks?: Record<string, unknown>;
}

/** Internal write/read store for governance_dry_runs. */
export interface DryRunStore {
  insert(input: GovernanceDryRunCreateInput): Promise<GovernanceDryRunRecord>;
  findById(dryRunId: string): Promise<GovernanceDryRunRecord | null>;
  /** Continuation lookup: one dry run per (deployment, draft revision, conversation, tester). */
  findContinuation(deploymentId: string, revisionId: string, conversationId: string, testerId: string): Promise<GovernanceDryRunRecord | null>;
  /** Latest dry run of a deployment (overview + readiness). */
  findLatestByDeployment(deploymentId: string): Promise<GovernanceDryRunRecord | null>;
  findPassedByDeploymentAndRevision(deploymentId: string, revisionId: string): Promise<GovernanceDryRunRecord | null>;
  listByDeployment(deploymentId: string): Promise<GovernanceDryRunRecord[]>;
  update(dryRunId: string, patch: GovernanceDryRunPatch): Promise<GovernanceDryRunRecord | null>;
  /** Set-based delete for a whole scope subtree; no-op for an empty list. */
  deleteByProgramAndScopeIds(programId: string, scopeIds: string[]): Promise<void>;
}
