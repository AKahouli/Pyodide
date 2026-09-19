import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { RECONCILIATION_RUN_STORE, type ReconciliationRunLeaseClaim, type ReconciliationRunStore } from '../reconciliation-run-store';
import type { GovernanceReconciliationRunRecord } from '../governance-records';

const RUNS = schema.governanceReconciliationRuns;
type RunRow = typeof RUNS.$inferSelect;

export function runRowToRecord(row: RunRow): GovernanceReconciliationRunRecord {
  return {
    id: row.id,
    bindingId: row.bindingId,
    status: row.status as GovernanceReconciliationRunRecord['status'],
    dryRun: row.dryRun,
    cursor: row.cursor ?? undefined,
    stats: row.stats ?? {},
    errors: row.errors ?? [],
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    leaseToken: row.leaseToken ?? undefined,
    leaseExpiresAt: row.leaseExpiresAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgReconciliationRunStore implements ReconciliationRunStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async create(input: { bindingId: string; dryRun: boolean }): Promise<GovernanceReconciliationRunRecord> {
    const [row] = await this.q
      .insert(RUNS)
      .values({ id: newObjectId(), bindingId: input.bindingId, dryRun: input.dryRun, status: 'pending', stats: {}, errors: [] })
      .returning();
    return runRowToRecord(row);
  }

  async findById(runId: string): Promise<GovernanceReconciliationRunRecord | null> {
    const rows = await this.q.select().from(RUNS).where(eq(RUNS.id, runId)).limit(1);
    return rows[0] ? runRowToRecord(rows[0]) : null;
  }

  async findByIdAndBinding(bindingId: string, runId: string): Promise<GovernanceReconciliationRunRecord | null> {
    const rows = await this.q
      .select()
      .from(RUNS)
      .where(and(eq(RUNS.id, runId), eq(RUNS.bindingId, bindingId)))
      .limit(1);
    return rows[0] ? runRowToRecord(rows[0]) : null;
  }

  async claim(runId: string, now: Date, leaseMs: number): Promise<ReconciliationRunLeaseClaim | null> {
    const leaseToken = randomUUID();
    // Atomic claim: FOR UPDATE SKIP LOCKED picks the candidate row; the outer
    // UPDATE is a no-op (and returns nothing) when another worker won the race.
    const result = await this.q.execute(sql`
      UPDATE governance.governance_reconciliation_runs
         SET status = 'running',
             started_at = ${now},
             lease_token = ${leaseToken},
             lease_expires_at = ${new Date(now.getTime() + leaseMs)},
             updated_at = now()
       WHERE id = (
         SELECT id FROM governance.governance_reconciliation_runs
          WHERE id = ${runId}
            AND (status IN ('pending', 'failed') OR (status = 'running' AND lease_expires_at < ${now}))
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id
    `);
    if (result.rows.length === 0) return null;
    const run = await this.findById(String(result.rows[0].id));
    return run ? { run, leaseToken } : null;
  }

  async renewLease(runId: string, leaseToken: string, leaseMs: number): Promise<boolean> {
    const rows = await this.q
      .update(RUNS)
      .set({ leaseExpiresAt: new Date(Date.now() + leaseMs), updatedAt: new Date() })
      .where(and(eq(RUNS.id, runId), eq(RUNS.leaseToken, leaseToken), eq(RUNS.status, 'running')))
      .returning({ id: RUNS.id });
    return rows.length === 1;
  }

  async checkpoint(runId: string, leaseToken: string, cursor: string, stats: Record<string, number>, errors: GovernanceReconciliationRunRecord['errors'], leaseMs: number): Promise<boolean> {
    const rows = await this.q
      .update(RUNS)
      .set({ cursor, stats, errors, leaseExpiresAt: new Date(Date.now() + leaseMs), updatedAt: new Date() })
      .where(and(eq(RUNS.id, runId), eq(RUNS.leaseToken, leaseToken), eq(RUNS.status, 'running')))
      .returning({ id: RUNS.id });
    return rows.length === 1;
  }

  async completeIfLeased(runId: string, leaseToken: string, stats: Record<string, number>, errors: GovernanceReconciliationRunRecord['errors']): Promise<GovernanceReconciliationRunRecord | null> {
    const rows = await this.q
      .update(RUNS)
      .set({ status: 'completed', stats, errors, completedAt: new Date(), cursor: null, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(RUNS.id, runId), eq(RUNS.leaseToken, leaseToken), eq(RUNS.status, 'running')))
      .returning();
    return rows[0] ? runRowToRecord(rows[0]) : null;
  }

  async failIfLeased(runId: string, leaseToken: string, errors: GovernanceReconciliationRunRecord['errors']): Promise<GovernanceReconciliationRunRecord | null> {
    const rows = await this.q
      .update(RUNS)
      .set({ status: 'failed', errors, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(RUNS.id, runId), eq(RUNS.leaseToken, leaseToken)))
      .returning();
    return rows[0] ? runRowToRecord(rows[0]) : null;
  }
}
