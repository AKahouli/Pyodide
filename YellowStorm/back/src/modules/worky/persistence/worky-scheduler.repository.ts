import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyScheduledEventRecord } from '../worky.types';

const t = schema.workyScheduledEvents;

/** PostgreSQL worky.scheduled_events repository: durable timers with a claim lease (roadmap P7). */
@Injectable()
export class WorkySchedulerRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(input: { streamId: string; taskId: string | null; eventType: string; fireAt: Date }): Promise<WorkyScheduledEventRecord> {
    const [row] = await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        taskId: input.taskId ? normalizeObjectId(input.taskId) : null,
        eventType: input.eventType,
        fireAt: input.fireAt,
      })
      .returning();
    return row;
  }

  /** Cancels a timer nobody has claimed yet. A claimed timer is left to the worker that holds it. */
  async cancelPending(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(t)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(and(eq(t.id, normalizeObjectId(id)), eq(t.status, 'pending')));
  }

  /**
   * Claims the next due timer in one statement: FOR UPDATE SKIP LOCKED means concurrent workers never
   * take the same row, and the loser simply gets the next one (or nothing).
   */
  async claimDue(now: Date, claimToken: string): Promise<WorkyScheduledEventRecord | null> {
    const result = await this.q.execute<{ id: string }>(sql`
      UPDATE worky.scheduled_events
         SET status = 'claimed', claim_token = ${claimToken}, claimed_at = ${now.toISOString()}::timestamptz, updated_at = now()
       WHERE id = (
         SELECT id FROM worky.scheduled_events
          WHERE status = 'pending' AND fire_at <= ${now.toISOString()}::timestamptz
          ORDER BY fire_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id
    `);
    const id = result.rows[0]?.id;
    if (!id) return null;
    const [row] = await this.q.select().from(t).where(eq(t.id, id)).limit(1);
    return row ?? null;
  }

  /** Marks a claimed timer fired. False when it was no longer claimed. */
  async markFired(id: string, firedAt: Date): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(t)
      .set({ status: 'fired', firedAt, updatedAt: new Date() })
      .where(and(eq(t.id, normalizeObjectId(id)), eq(t.status, 'claimed')))
      .returning({ id: t.id });
    return rows.length > 0;
  }

  /** Puts claimed timers whose lease ran out back in the queue (the claimer crashed). Returns how many. */
  async requeueExpired(leaseCutoff: Date): Promise<number> {
    const rows = await this.q
      .update(t)
      .set({ status: 'pending', claimToken: null, claimedAt: null, updatedAt: new Date() })
      .where(and(eq(t.status, 'claimed'), lte(t.claimedAt, leaseCutoff)))
      .returning({ id: t.id });
    return rows.length;
  }
}
