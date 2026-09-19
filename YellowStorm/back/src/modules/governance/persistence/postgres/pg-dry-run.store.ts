import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { DRY_RUN_STORE, type DryRunStore, type GovernanceDryRunCreateInput, type GovernanceDryRunPatch } from '../dry-run-store';
import type { GovernanceDryRunRecord } from '../governance-records';

const DRY_RUNS = schema.governanceDryRuns;
type DryRunRow = typeof DRY_RUNS.$inferSelect;

export function dryRunRowToRecord(row: DryRunRow): GovernanceDryRunRecord {
  return {
    id: row.id,
    programId: row.programId,
    scopeId: row.scopeId,
    deploymentId: row.deploymentId,
    revisionId: row.revisionId,
    conversationId: row.conversationId ?? undefined,
    testerId: row.testerId,
    status: row.status as GovernanceDryRunRecord['status'],
    executionMode: row.executionMode as GovernanceDryRunRecord['executionMode'],
    testCases: row.testCases ?? [],
    checks: row.checks ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgDryRunStore implements DryRunStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async insert(input: GovernanceDryRunCreateInput): Promise<GovernanceDryRunRecord> {
    const [row] = await this.q
      .insert(DRY_RUNS)
      .values({
        id: newObjectId(),
        programId: input.programId,
        scopeId: input.scopeId,
        deploymentId: input.deploymentId,
        revisionId: input.revisionId,
        conversationId: input.conversationId ?? null,
        testerId: input.testerId,
        status: input.status,
        executionMode: input.executionMode,
        testCases: input.testCases ?? [],
        checks: input.checks ?? {},
      })
      .returning();
    return dryRunRowToRecord(row);
  }

  async findById(dryRunId: string): Promise<GovernanceDryRunRecord | null> {
    const rows = await this.q.select().from(DRY_RUNS).where(eq(DRY_RUNS.id, dryRunId)).limit(1);
    return rows[0] ? dryRunRowToRecord(rows[0]) : null;
  }

  async findContinuation(deploymentId: string, revisionId: string, conversationId: string, testerId: string): Promise<GovernanceDryRunRecord | null> {
    const rows = await this.q
      .select()
      .from(DRY_RUNS)
      .where(
        and(
          eq(DRY_RUNS.deploymentId, deploymentId),
          eq(DRY_RUNS.revisionId, revisionId),
          eq(DRY_RUNS.conversationId, conversationId),
          eq(DRY_RUNS.testerId, testerId),
        ),
      )
      .limit(1);
    return rows[0] ? dryRunRowToRecord(rows[0]) : null;
  }

  async findLatestByDeployment(deploymentId: string): Promise<GovernanceDryRunRecord | null> {
    const rows = await this.q
      .select()
      .from(DRY_RUNS)
      .where(eq(DRY_RUNS.deploymentId, deploymentId))
      .orderBy(desc(DRY_RUNS.createdAt))
      .limit(1);
    return rows[0] ? dryRunRowToRecord(rows[0]) : null;
  }

  async findPassedByDeploymentAndRevision(deploymentId: string, revisionId: string): Promise<GovernanceDryRunRecord | null> {
    const rows = await this.q
      .select()
      .from(DRY_RUNS)
      .where(and(eq(DRY_RUNS.deploymentId, deploymentId), eq(DRY_RUNS.revisionId, revisionId), eq(DRY_RUNS.status, 'passed')))
      .limit(1);
    return rows[0] ? dryRunRowToRecord(rows[0]) : null;
  }

  async listByDeployment(deploymentId: string): Promise<GovernanceDryRunRecord[]> {
    const rows = await this.q.select().from(DRY_RUNS).where(eq(DRY_RUNS.deploymentId, deploymentId)).orderBy(desc(DRY_RUNS.createdAt));
    return rows.map(dryRunRowToRecord);
  }

  async update(dryRunId: string, patch: GovernanceDryRunPatch): Promise<GovernanceDryRunRecord | null> {
    const rows = await this.q
      .update(DRY_RUNS)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.checks !== undefined ? { checks: patch.checks } : {}),
        updatedAt: new Date(),
      })
      .where(eq(DRY_RUNS.id, dryRunId))
      .returning();
    return rows[0] ? dryRunRowToRecord(rows[0]) : null;
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.q.delete(DRY_RUNS).where(and(eq(DRY_RUNS.programId, programId), eq(DRY_RUNS.scopeId, scopeId)));
  }
}
