import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias, type PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const op = schema.playbookDesignOperations;
type DesignOperationRow = typeof op.$inferSelect;

export type PlaybookDesignOperationStatus = 'queued' | 'running' | 'applying' | 'completed' | 'failed' | 'cancelled';
export type PlaybookDesignOperationRecord = Omit<DesignOperationRow, 'status'> & { status: PlaybookDesignOperationStatus };

export interface NewPlaybookDesignOperation {
  ownerId: string;
  flowId: string;
  query: string;
  idempotencyKey?: string;
  snapshotBefore: Record<string, unknown>;
}

const ACTIVE_STATUSES = ['running', 'applying'];
/** The claim looks at the oldest queued operations only, like the Mongo drain did. */
const CLAIM_WINDOW = 20;

function toDesignOperationRecord(row: DesignOperationRow): PlaybookDesignOperationRecord {
  return row as PlaybookDesignOperationRecord;
}

/**
 * PostgreSQL playbook.design_operations repository (roadmap P5): the queue of asynchronous design
 * operations. A claim bumps `lock_version`, and the claiming run finishes the operation only while
 * that version still holds.
 */
@Injectable()
export class PlaybookDesignOperationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /**
   * Queues an operation. With an idempotency key, the operation already queued under
   * (owner, flow, key) is returned unchanged instead (its `updated_at` is bumped).
   */
  async enqueue(input: NewPlaybookDesignOperation): Promise<PlaybookDesignOperationRecord> {
    const insert = this.q.insert(op).values({
      id: newObjectId(),
      ownerId: normalizeObjectId(input.ownerId),
      flowId: normalizeObjectId(input.flowId),
      query: stripNul(input.query),
      status: 'queued',
      idempotencyKey: input.idempotencyKey ?? null,
      snapshotBefore: stripNul(input.snapshotBefore),
      lockVersion: 0,
    });
    const [row] = input.idempotencyKey
      ? await insert
        .onConflictDoUpdate({
          target: [op.ownerId, op.flowId, op.idempotencyKey],
          targetWhere: sql`${op.idempotencyKey} IS NOT NULL`,
          set: { updatedAt: new Date() },
        })
        .returning()
      : await insert.returning();
    return toDesignOperationRecord(row);
  }

  async findById(id: string): Promise<PlaybookDesignOperationRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(op).where(eq(op.id, normalizeObjectId(id))).limit(1);
    return row ? toDesignOperationRecord(row) : null;
  }

  async findForOwner(id: string, ownerId: string, flowId: string): Promise<PlaybookDesignOperationRecord | null> {
    if (!isObjectId(id) || !isObjectId(ownerId) || !isObjectId(flowId)) return null;
    const [row] = await this.q
      .select()
      .from(op)
      .where(and(eq(op.id, normalizeObjectId(id)), eq(op.ownerId, normalizeObjectId(ownerId)), eq(op.flowId, normalizeObjectId(flowId))))
      .limit(1);
    return row ? toDesignOperationRecord(row) : null;
  }

  /** Cancels the operation while it is still queued; null otherwise. */
  async cancelQueued(id: string, ownerId: string, flowId: string): Promise<PlaybookDesignOperationRecord | null> {
    if (!isObjectId(id) || !isObjectId(ownerId) || !isObjectId(flowId)) return null;
    const [row] = await this.q
      .update(op)
      .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(op.id, normalizeObjectId(id)),
        eq(op.ownerId, normalizeObjectId(ownerId)),
        eq(op.flowId, normalizeObjectId(flowId)),
        eq(op.status, 'queued'),
      ))
      .returning();
    return row ? toDesignOperationRecord(row) : null;
  }

  /** Operations running or applying, across every user and flow. */
  async countActive(): Promise<number> {
    const [row] = await this.q.select({ count: sql<number>`count(*)::int` }).from(op).where(inArray(op.status, ACTIVE_STATUSES));
    return row?.count ?? 0;
  }

  /**
   * Claims the oldest queued operation whose flow has no active operation and whose owner has fewer
   * than `userLimit` active ones: queued -> running, `lock_version` + 1. Claims are serialised by a
   * transaction-scoped advisory lock, so two claimers cannot both see a flow idle and start two
   * writers on it; the candidate row is locked so a concurrent cancel waits for the claim.
   */
  async claimNext(userLimit: number): Promise<PlaybookDesignOperationRecord | null> {
    return withTransaction(this.db, async () => {
      await this.q.execute(sql`SELECT pg_advisory_xact_lock(hashtext('playbook.design_operations.claim'))`);
      const queued = alias(op, 'queued_op');
      const flowActive = alias(op, 'flow_active_op');
      const ownerActive = alias(op, 'owner_active_op');
      const [candidate] = await this.q
        .select({ id: op.id })
        .from(op)
        .where(and(
          eq(op.status, 'queued'),
          inArray(op.id, this.q.select({ id: queued.id }).from(queued).where(eq(queued.status, 'queued')).orderBy(asc(queued.createdAt), asc(queued.id)).limit(CLAIM_WINDOW)),
          notExists(this.q.select({ one: sql`1` }).from(flowActive).where(and(eq(flowActive.flowId, op.flowId), inArray(flowActive.status, ACTIVE_STATUSES)))),
          sql`(${this.q.select({ count: sql`count(*)` }).from(ownerActive).where(and(eq(ownerActive.ownerId, op.ownerId), inArray(ownerActive.status, ACTIVE_STATUSES)))}) < ${userLimit}`,
        ))
        .orderBy(asc(op.createdAt), asc(op.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!candidate) return null;
      const [row] = await this.q
        .update(op)
        .set({ status: 'running', startedAt: new Date(), lockVersion: sql`${op.lockVersion} + 1`, updatedAt: new Date() })
        .where(and(eq(op.id, candidate.id), eq(op.status, 'queued')))
        .returning();
      return row ? toDesignOperationRecord(row) : null;
    });
  }

  /** running -> applying, for the run holding `lockVersion`. */
  async markApplying(id: string, lockVersion: number): Promise<boolean> {
    return this.finishWhere(id, lockVersion, { status: 'applying' }, 'running');
  }

  /**
   * Terminal state of the run holding `lockVersion`. The applied message is linked only if it still
   * exists: the user may have cleared the design history while the run was going.
   */
  async finish(
    id: string,
    lockVersion: number,
    outcome:
      | { status: 'completed'; resultPreview: Record<string, unknown>; appliedMessageId: string | null }
      | { status: 'failed'; error: string },
  ): Promise<boolean> {
    if (outcome.status === 'failed') {
      return this.finishWhere(id, lockVersion, { status: 'failed', completedAt: new Date(), error: stripNul(outcome.error) });
    }
    const messageId = outcome.appliedMessageId && isObjectId(outcome.appliedMessageId) ? normalizeObjectId(outcome.appliedMessageId) : null;
    const dm = schema.playbookDesignMessages;
    return this.finishWhere(id, lockVersion, {
      status: 'completed',
      completedAt: new Date(),
      resultPreview: stripNul(outcome.resultPreview),
      appliedMessageId: messageId ? sql`(SELECT ${dm.id} FROM ${dm} WHERE ${dm.id} = ${messageId})` : null,
    });
  }

  private async finishWhere(id: string, lockVersion: number, set: PgUpdateSetSource<typeof op>, fromStatus?: string): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(op)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(op.id, normalizeObjectId(id)), eq(op.lockVersion, lockVersion), fromStatus ? eq(op.status, fromStatus) : undefined))
      .returning({ id: op.id });
    return rows.length > 0;
  }
}
