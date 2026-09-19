import type { GovernanceReconciliationRunRecord } from './governance-records';

export const RECONCILIATION_RUN_STORE = Symbol('GOVERNANCE_RECONCILIATION_RUN_STORE');

export interface ReconciliationRunLeaseClaim {
  run: GovernanceReconciliationRunRecord;
  leaseToken: string;
}

/**
 * Lease-guarded store for governance_reconciliation_runs. The claim is a
 * single atomic UPDATE (PostgreSQL: FOR UPDATE SKIP LOCKED on the candidate
 * row) so two workers can never hold the same run.
 */
export interface ReconciliationRunStore {
  create(input: { bindingId: string; dryRun: boolean }): Promise<GovernanceReconciliationRunRecord>;
  findById(runId: string): Promise<GovernanceReconciliationRunRecord | null>;
  findByIdAndBinding(bindingId: string, runId: string): Promise<GovernanceReconciliationRunRecord | null>;
  /** Atomically claims a pending/failed/expired-lease run; null when another worker owns it. */
  claim(runId: string, now: Date, leaseMs: number): Promise<ReconciliationRunLeaseClaim | null>;
  renewLease(runId: string, leaseToken: string, leaseMs: number): Promise<boolean>;
  checkpoint(runId: string, leaseToken: string, cursor: string, stats: Record<string, number>, errors: GovernanceReconciliationRunRecord['errors'], leaseMs: number): Promise<boolean>;
  completeIfLeased(runId: string, leaseToken: string, stats: Record<string, number>, errors: GovernanceReconciliationRunRecord['errors']): Promise<GovernanceReconciliationRunRecord | null>;
  failIfLeased(runId: string, leaseToken: string, errors: GovernanceReconciliationRunRecord['errors']): Promise<GovernanceReconciliationRunRecord | null>;
}
