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
  /**
   * Expiry column (rows go when column <= now()), or — with `olderThan` — an
   * age column (rows go when column < now() - interval), e.g. created_at.
   */
  column: string;
  batchSize?: number;
  /**
   * PG interval literal for retention-based sweeps on non-expiry columns
   * (timestamptz + interval is not immutable, so no generated expires_at).
   * Example: '730 days' for audit_logs.created_at.
   */
  olderThan?: string;
}

const DEFAULT_BATCH_SIZE = 1000;
// One cron tick deletes at most 100 batches/table (~100k rows), each batch in
// its own short transaction; a bigger backlog drains over several ticks.
const MAX_BATCHES_PER_TABLE = 100;

/**
 * App-level TTL sweeper for PostgreSQL tables that replace Mongo TTL indexes
 * (pg_cron is not installed). Each registered table is swept hourly: batches
 * of expired rows are deleted FOR UPDATE SKIP LOCKED, each batch in its own
 * short transaction guarded by a per-table transaction-scoped advisory lock so
 * replicas never double-sweep and no long-running transaction is held.
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

  /**
   * Returns the number of deleted rows, or null when another replica held the
   * lock on the first batch (or the sweep failed before deleting anything).
   * Each batch runs in its OWN short transaction (xact-scoped advisory lock +
   * one bounded DELETE + commit) so locks are never held across batches.
   */
  async sweepTable(spec: TtlSweepSpec): Promise<number | null> {
    const label = `${spec.schema}.${spec.table}`;
    const batchSize = spec.batchSize ?? DEFAULT_BATCH_SIZE;
    const table = sql`${sql.identifier(spec.schema)}.${sql.identifier(spec.table)}`;
    const expired = spec.olderThan
      ? sql`${sql.identifier(spec.column)} < now() - ${spec.olderThan}::interval`
      : sql`${sql.identifier(spec.column)} <= now()`;
    let deleted = 0;
    let batches = 0;
    try {
      for (; batches < MAX_BATCHES_PER_TABLE; batches += 1) {
        const rowCount = await this.db.transaction(async (tx) => {
          // xact-scoped lock: auto-released at commit/rollback, no unlock leak.
          const lock = await tx.execute(
            sql`SELECT pg_try_advisory_xact_lock(hashtext(${`ttl:${label}`})) AS acquired`,
          );
          if (!lock.rows[0]?.acquired) return null;
          const result = await tx.execute(sql`
            DELETE FROM ${table}
            WHERE ctid = ANY(ARRAY(
              SELECT ctid
              FROM ${table}
              WHERE ${expired}
              LIMIT ${batchSize}
              FOR UPDATE SKIP LOCKED
            ))
          `);
          return result.rowCount ?? 0;
        });
        if (rowCount === null) {
          // Another replica is sweeping this table: skip it for this run.
          if (batches === 0) return null;
          break;
        }
        deleted += rowCount;
        if (rowCount < batchSize) break;
      }
      if (deleted > 0) {
        this.logger.log(`TTL sweep deleted ${String(deleted)} expired row(s) from ${label}`);
      }
      return deleted;
    } catch (error: unknown) {
      this.logger.error(`TTL sweep failed for ${label}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        deletedBeforeFailure: deleted,
      });
      return deleted > 0 ? deleted : null;
    }
  }
}
