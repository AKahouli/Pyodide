import type { GovernancePublicationAttemptRecord } from './governance-records';
import type { GovernancePublicationAttemptStatus } from '../domain/governance-types';


export interface GovernancePublicationAttemptCreateInput {
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
  readinessSnapshot?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

/** Append-only audit store for governance_publication_attempts. */
export interface PublicationAttemptStore {
  insert(input: GovernancePublicationAttemptCreateInput): Promise<GovernancePublicationAttemptRecord>;
  /** Set-based delete for a whole scope subtree; no-op for an empty list. */
  deleteByProgramAndScopeIds(programId: string, scopeIds: string[]): Promise<void>;
}
