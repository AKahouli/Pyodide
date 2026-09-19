import type { GovernanceMetricRecord } from './governance-records';

export const METRIC_STORE = Symbol('GOVERNANCE_METRIC_STORE');

/** Read-mostly store for governance_metrics (ingested counters are copied, never recomputed). */
export interface MetricStore {
  /** Newest periods first, capped like the REST list endpoint. */
  listForProgramScopes(programId: string, scopeIds: string[] | '*', limit: number): Promise<GovernanceMetricRecord[]>;
  listByProgramAndScope(programId: string, scopeId: string): Promise<GovernanceMetricRecord[]>;
  deleteByProgramAndScope(programId: string, scopeId: string): Promise<void>;
}
