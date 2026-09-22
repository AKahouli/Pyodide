import { Inject } from '@nestjs/common';
import { and, between, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  HEALTH_HISTORY_STORE,
  type HealthHistoryRangeOptions,
  type HealthHistoryRow,
  type HealthHistoryStore,
  type NewHealthHistoryEntry,
} from './health-history.store';

type Row = typeof schema.opsHealthHistory.$inferSelect;

function toRow(row: Row): HealthHistoryRow {
  return {
    _id: row.id,
    status: row.status as HealthHistoryRow['status'],
    timestamp: row.timestamp,
    version: row.version,
    uptime: row.uptime,
    checks: (row.checks ?? {}) as HealthHistoryRow['checks'],
    recordedAt: row.recordedAt,
    expireAt: row.expireAt,
  };
}

/** PostgreSQL ops.health_history implementation of HealthHistoryStore (plan 1B.2.4). */
export class PgHealthHistoryStore implements HealthHistoryStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async insert(entry: NewHealthHistoryEntry, expireAt: Date): Promise<HealthHistoryRow> {
    const [row] = await this.q
      .insert(schema.opsHealthHistory)
      .values({ id: newObjectId(), ...entry, expireAt })
      .returning();
    return toRow(row);
  }

  async findRange(options: HealthHistoryRangeOptions): Promise<{ records: HealthHistoryRow[]; total: number }> {
    const conditions: SQL[] = [
      between(schema.opsHealthHistory.recordedAt, options.from, options.to),
    ];
    if (options.status) conditions.push(eq(schema.opsHealthHistory.status, options.status));
    const filter = and(...conditions)!;

    const [rows, [tally]] = await Promise.all([
      this.q
        .select()
        .from(schema.opsHealthHistory)
        .where(filter)
        .orderBy(desc(schema.opsHealthHistory.recordedAt))
        .offset(options.skip ?? 0)
        .limit(options.limit ?? 100),
      this.q.select({ n: count() }).from(schema.opsHealthHistory).where(filter),
    ]);

    return { records: rows.map(toRow), total: tally?.n ?? 0 };
  }

  async findAllInRange(from: Date, to: Date): Promise<HealthHistoryRow[]> {
    const rows = await this.q
      .select()
      .from(schema.opsHealthHistory)
      .where(and(gte(schema.opsHealthHistory.recordedAt, from), lte(schema.opsHealthHistory.recordedAt, to)))
      .orderBy(desc(schema.opsHealthHistory.recordedAt));
    return rows.map(toRow);
  }
}
