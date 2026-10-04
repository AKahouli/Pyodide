import { Inject } from '@nestjs/common';
import { and, count, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { isObjectId, newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  type NewNotification,
  type NotificationFindOptions,
  type NotificationRecord,
} from './notification.store';

type Row = typeof schema.opsNotifications.$inferSelect;

function toRecord(row: Row): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    message: row.message,
    data: row.data ?? null,
    actions: (row.actions ?? []),
    destination: row.destination,
    status: row.status,
    sourceModule: row.sourceModule,
    priority: row.priority,
    expiresAt: row.expiresAt,
    extra: row.extra ?? null,
    sentAt: row.sentAt,
    readAt: row.readAt,
    retryCount: row.retryCount,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** PostgreSQL ops.notifications store (plan 1B.1.2). */
export class PgNotificationStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Owner-or-broadcast condition, shared by listing/read paths. */
  private ownerScope(userId: string): SQL {
    return or(eq(schema.opsNotifications.userId, userId), eq(schema.opsNotifications.destination, 'broadcast'))!;
  }

  async findForUser(
    userId: string,
    options: NotificationFindOptions,
  ): Promise<{ records: NotificationRecord[]; total: number }> {
    const conditions: SQL[] = [this.ownerScope(userId)];
    if (options.status) conditions.push(eq(schema.opsNotifications.status, options.status));
    if (options.type) conditions.push(eq(schema.opsNotifications.type, options.type));
    if (options.unreadOnly) conditions.push(ne(schema.opsNotifications.status, 'read'));
    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      this.q
        .select()
        .from(schema.opsNotifications)
        .where(where)
        .orderBy(desc(schema.opsNotifications.createdAt))
        .offset(options.skip)
        .limit(options.limit),
      this.q.select({ n: count() }).from(schema.opsNotifications).where(where),
    ]);
    return { records: rows.map(toRecord), total: totals[0]?.n ?? 0 };
  }

  async findUnread(userId: string, limit = 50): Promise<NotificationRecord[]> {
    const rows: Row[] = await this.q
      .select()
      .from(schema.opsNotifications)
      .where(and(this.ownerScope(userId), ne(schema.opsNotifications.status, 'read')))
      .orderBy(desc(schema.opsNotifications.createdAt))
      .limit(limit);
    return rows.map(toRecord);
  }

  async countUnread(userId: string): Promise<number> {
    const rows = await this.q
      .select({ n: count() })
      .from(schema.opsNotifications)
      .where(and(this.ownerScope(userId), ne(schema.opsNotifications.status, 'read')));
    return rows[0]?.n ?? 0;
  }

  async markReadByIdsForUser(userId: string, notificationIds: string[]): Promise<number> {
    const valid = notificationIds.filter(isObjectId);
    if (valid.length === 0) return 0;
    const rows = await this.q
      .update(schema.opsNotifications)
      .set({ status: 'read', readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          inArray(schema.opsNotifications.id, valid),
          this.ownerScope(userId),
        ),
      )
      .returning();
    return rows.length;
  }

  async markAllReadForUser(userId: string): Promise<number> {
    const rows = await this.q
      .update(schema.opsNotifications)
      .set({ status: 'read', readAt: new Date(), updatedAt: new Date() })
      .where(and(this.ownerScope(userId), ne(schema.opsNotifications.status, 'read')))
      .returning();
    return rows.length;
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    if (!isObjectId(id)) return null;
    const rows: Row[] = await this.q.select().from(schema.opsNotifications).where(eq(schema.opsNotifications.id, id)).limit(1);
    return rows.length ? toRecord(rows[0]) : null;
  }

  async deleteById(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q.delete(schema.opsNotifications).where(eq(schema.opsNotifications.id, id));
  }

  async create(init: NewNotification): Promise<NotificationRecord> {
    const rows: Row[] = await this.q
      .insert(schema.opsNotifications)
      .values({
        id: newObjectId(),
        userId: init.userId ?? null,
        type: init.type,
        title: init.title,
        message: init.message,
        data: init.data ?? null,
        actions: (init.actions ?? []) as typeof schema.opsNotifications.$inferInsert.actions,
        destination: init.destination,
        status: 'pending',
        sourceModule: init.sourceModule ?? 'system',
        priority: init.priority ?? 'normal',
        expiresAt: init.expiresAt,
        extra: init.extra ?? null,
      })
      .returning();
    return toRecord(rows[0]);
  }

  async markSent(id: string): Promise<void> {
    await this.q
      .update(schema.opsNotifications)
      .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.opsNotifications.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.q
      .update(schema.opsNotifications)
      .set({
        status: 'failed',
        lastError: error,
        retryCount: sql`${schema.opsNotifications.retryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.opsNotifications.id, id));
  }
}