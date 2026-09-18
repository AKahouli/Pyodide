import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { LoggerService } from '@modules/logger';
import { DRIZZLE_DB } from '../postgres.constants';
import type * as schema from '../schema';

export interface TtlSweepSpec {
  schema: string;
  table: string;
  /** Timestamp column whose expiry (<= now()) makes a row deletable. */
  column: string;
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 1000;
// ponytail: one cron tick deletes at most 100 batches/table (~100k rows); a
// bigger backlog needs more ticks, not a longer cron. Raise if sweeps must drain faster.
const MAX_BATCHES_PER_TABLE = 100;

/**
 * App-level TTL sweeper for PostgreSQL tables that replace Mongo TTL indexes
 * (pg_cron is not installed). Each registered table is swept hourly: batches
 * of expired rows are deleted FOR UPDATE SKIP LOCKED, guarded by a per-table
 * transaction-scoped advisory lock so replicas never double-sweep.
 */
@Injectable()
export class PgTtlSweeper {
  private readonly specs = new Map<string, TtlSweepSpec>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PgTtlSweeper.name);
  }

  /** Idempotent by (schema, table); later registrations for the same key are ignored. */
  register(spec: TtlSweepSpec): void {
    const key = `${spec.schema}.${spec.table}`;
    if (!this.specs.has(key)) this.specs.set(key, spec);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweepAll(): Promise<void> {
    for (const spec of this.specs.values()) {
      await this.sweepTable(spec);
    }
  }

  /** Returns the number of deleted rows, or null when another replica held the lock. */
  async sweepTable(spec: TtlSweepSpec): Promise<number | null> {
    const label = `${spec.schema}.${spec.table}`;
    const batchSize = spec.batchSize ?? DEFAULT_BATCH_SIZE;
    try {
      return await this.db.transaction(async (tx) => {
        // xact-scoped lock: auto-released at commit/rollback, no unlock leak.
        const lock = await tx.execute(
          sql`SELECT pg_try_advisory_xact_lock(hashtext(${`ttl:${label}`})) AS acquired`,
        );
        if (!lock.rows[0]?.acquired) return null;

        let deleted = 0;
        for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch += 1) {
          const result = await tx.execute(sql`
            DELETE FROM ${sql.identifier(spec.schema)}.${sql.identifier(spec.table)}
            WHERE id IN (
              SELECT id
              FROM ${sql.identifier(spec.schema)}.${sql.identifier(spec.table)}
              WHERE ${sql.identifier(spec.column)} <= now()
              ORDER BY ${sql.identifier(spec.column)}
              LIMIT ${batchSize}
              FOR UPDATE SKIP LOCKED
            )
          `);
          const rowCount = result.rowCount ?? 0;
          deleted += rowCount;
          if (rowCount < batchSize) break;
        }
        if (deleted > 0) {
          this.logger.log(`TTL sweep deleted ${String(deleted)} expired row(s) from ${label}`);
        }
        return deleted;
      });
    } catch (error: unknown) {
      this.logger.error(`TTL sweep failed for ${label}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}
