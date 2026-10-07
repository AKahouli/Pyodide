import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, isUniqueViolation, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const l = schema.playbookExecutionLeases;

export type ExecutionLeaseScopeType = 'global' | 'owner' | 'flow' | 'provider' | 'model';

/** One concurrency slot an execution asks for. */
export interface ExecutionLeaseSlot {
  executionId: string;
  ownerId: string;
  flowId: string;
  scopeType: ExecutionLeaseScopeType;
  scopeKey: string;
  slot: number;
  expiresAt: Date;
}

/**
 * PostgreSQL playbook.execution_leases repository (roadmap P5): one row per concurrency slot an
 * execution holds. The unique (scope_key, slot) index arbitrates concurrent claims. A lease past its
 * `expires_at` is free and inactive even before the TTL sweep deletes it.
 */
@Injectable()
export class ExecutionLeaseRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /**
   * Claims the slot, taking it over when the lease holding it has expired. False when a live lease
   * holds it, or when the execution already holds a slot of this scope type (unique
   * (execution_id, scope_type)): both were a duplicate-key error in Mongo.
   */
  async claimSlot(input: ExecutionLeaseSlot): Promise<boolean> {
    const now = new Date();
    const values = {
      executionId: normalizeObjectId(input.executionId),
      ownerId: normalizeObjectId(input.ownerId),
      flowId: normalizeObjectId(input.flowId),
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
      slot: Math.trunc(input.slot),
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const rows = await this.q
        .insert(l)
        .values({ id: newObjectId(), ...values })
        .onConflictDoUpdate({ target: [l.scopeKey, l.slot], set: values, setWhere: sql`${l.expiresAt} <= now()` })
        .returning({ id: l.id });
      return rows.length > 0;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  /** Pushes the expiry of every lease the execution holds; returns how many. */
  async refresh(executionId: string, expiresAt: Date): Promise<number> {
    if (!isObjectId(executionId)) return 0;
    const rows = await this.q
      .update(l)
      .set({ expiresAt, updatedAt: new Date() })
      .where(eq(l.executionId, normalizeObjectId(executionId)))
      .returning({ id: l.id });
    return rows.length;
  }

  /** Whether the execution holds at least one lease that has not expired. */
  async hasActive(executionId: string): Promise<boolean> {
    if (!isObjectId(executionId)) return false;
    const rows = await this.q
      .select({ id: l.id })
      .from(l)
      .where(and(eq(l.executionId, normalizeObjectId(executionId)), sql`${l.expiresAt} > now()`))
      .limit(1);
    return rows.length > 0;
  }

  /** Frees every slot the execution holds; returns how many. */
  async releaseExecution(executionId: string): Promise<number> {
    if (!isObjectId(executionId)) return 0;
    const rows = await this.q.delete(l).where(eq(l.executionId, normalizeObjectId(executionId))).returning({ id: l.id });
    return rows.length;
  }

  /** Deletes the leases that have expired (what the Mongo TTL index removed); returns how many. */
  async deleteExpired(): Promise<number> {
    const rows = await this.q.delete(l).where(sql`${l.expiresAt} <= now()`).returning({ id: l.id });
    return rows.length;
  }
}
