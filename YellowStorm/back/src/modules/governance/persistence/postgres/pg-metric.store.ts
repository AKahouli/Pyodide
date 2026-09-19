import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { resolveQueryable } from '@common/postgres/transaction';
import { METRIC_STORE, type MetricStore } from '../metric-store';
import type { GovernanceMetricRecord } from '../governance-records';

const METRICS = schema.governanceMetrics;
type MetricRow = typeof METRICS.$inferSelect;

export function metricRowToRecord(row: MetricRow): GovernanceMetricRecord {
  return {
    id: row.id,
    programId: row.programId,
    scopeId: row.scopeId ?? undefined,
    deploymentId: row.deploymentId ?? undefined,
    agentId: row.agentId ?? undefined,
    channel: row.channel ?? undefined,
    type: row.type,
    value: row.value,
    dimensions: row.dimensions ?? {},
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgMetricStore implements MetricStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  private scopeFilter(programId: string, scopeIds: string[] | '*') {
    // Mirrors the Mongo filter: the '*' wildcard selects every program metric,
    // otherwise only explicit scopes (program-level null-scope rows excluded).
    if (scopeIds === '*') return [eq(METRICS.programId, programId)];
    return [eq(METRICS.programId, programId), inArray(METRICS.scopeId, scopeIds)];
  }

  async listForProgramScopes(programId: string, scopeIds: string[] | '*', limit: number): Promise<GovernanceMetricRecord[]> {
    const rows = await this.q
      .select()
      .from(METRICS)
      .where(and(...this.scopeFilter(programId, scopeIds)))
      .orderBy(desc(METRICS.periodStart))
      .limit(limit);
    return rows.map(metricRowToRecord);
  }

  async listByProgramAndScope(programId: string, scopeId: string): Promise<GovernanceMetricRecord[]> {
    const rows = await this.q
      .select()
      .from(METRICS)
      .where(and(eq(METRICS.programId, programId), eq(METRICS.scopeId, scopeId)));
    return rows.map(metricRowToRecord);
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.q.delete(METRICS).where(and(eq(METRICS.programId, programId), eq(METRICS.scopeId, scopeId)));
  }
}
