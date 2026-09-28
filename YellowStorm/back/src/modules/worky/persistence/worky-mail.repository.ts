import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyMailSubscriptionRecord } from '../worky.types';

const led = schema.workyMailEventLedger;
const sub = schema.workyMailSubscriptions;

/** The fields of a mailbox subscription an upsert may write. */
export interface WorkyMailSubscriptionFields {
  subscriptionId?: string | null;
  clientState?: string | null;
  expiresAt?: Date | null;
  notificationUrl?: string | null;
}

/** PostgreSQL worky.mail_event_ledger and worky.mail_subscriptions repository (roadmap P7). */
@Injectable()
export class WorkyMailRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  // ---------------------------------------------------------------- ledger

  /**
   * Records an outbound mail, or reports that it was recorded before. True means this call is the
   * first for `dedupKey` in the stream, so the caller should send the mail; false means skip it.
   * ON CONFLICT DO NOTHING, so a repeat neither fails nor aborts an ambient transaction.
   */
  async recordMail(input: { streamId: string; taskId: string | null; kind: string; dedupKey: string }): Promise<boolean> {
    const rows = await this.q
      .insert(led)
      .values({
        id: newObjectId(),
        streamId: normalizeObjectId(input.streamId),
        taskId: input.taskId ? normalizeObjectId(input.taskId) : null,
        kind: input.kind,
        dedupKey: input.dedupKey,
        sentAt: new Date(),
      })
      .onConflictDoNothing({ target: [led.streamId, led.dedupKey] })
      .returning({ id: led.id });
    return rows.length > 0;
  }

  // ---------------------------------------------------------------- subscriptions

  /** The user's first mailbox subscription (there is normally one per user). */
  async findByUser(userId: string): Promise<WorkyMailSubscriptionRecord | null> {
    if (!isObjectId(userId)) return null;
    const [row] = await this.q.select().from(sub).where(eq(sub.userId, normalizeObjectId(userId))).orderBy(asc(sub.createdAt), asc(sub.id)).limit(1);
    return row ?? null;
  }

  async findByClientState(clientState: string): Promise<WorkyMailSubscriptionRecord | null> {
    if (!clientState) return null;
    const [row] = await this.q.select().from(sub).where(eq(sub.clientState, clientState)).limit(1);
    return row ?? null;
  }

  async listAll(): Promise<WorkyMailSubscriptionRecord[]> {
    return this.q.select().from(sub).orderBy(asc(sub.createdAt), asc(sub.id));
  }

  /** Push subscriptions that expire before `cutoff`. Poll-only mailboxes have nothing to renew. */
  async listExpiring(cutoff: Date): Promise<WorkyMailSubscriptionRecord[]> {
    return this.q
      .select()
      .from(sub)
      .where(and(isNotNull(sub.subscriptionId), isNotNull(sub.expiresAt), lte(sub.expiresAt, cutoff)))
      .orderBy(asc(sub.expiresAt), asc(sub.id));
  }

  /** Creates the (user, mailbox) row or overwrites the given fields of the existing one. */
  async upsertMailbox(userId: string, mailboxAppKey: string, fields: WorkyMailSubscriptionFields): Promise<WorkyMailSubscriptionRecord> {
    const [row] = await this.q
      .insert(sub)
      .values({ id: newObjectId(), userId: normalizeObjectId(userId), mailboxAppKey, ...fields })
      .onConflictDoUpdate({ target: [sub.userId, sub.mailboxAppKey], set: { ...fields, updatedAt: new Date() } })
      .returning();
    return row;
  }

  async setExpiry(id: string, expiresAt: Date): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q.update(sub).set({ expiresAt, updatedAt: new Date() }).where(eq(sub.id, normalizeObjectId(id)));
  }

  async setLastSwept(id: string, lastSweptAt: Date): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q.update(sub).set({ lastSweptAt, updatedAt: new Date() }).where(eq(sub.id, normalizeObjectId(id)));
  }

  async deleteById(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q.delete(sub).where(eq(sub.id, normalizeObjectId(id)));
  }
}
