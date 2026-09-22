import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, char, check, index, integer, jsonb, pgSchema, text, timestamp, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

/** P1B ops tables (plan 2026-09-19 step 1B). */
export const opsSchema = pgSchema('ops');

export const opsNotifications = opsSchema.table(
  'notifications',
  {
    id: objectId('id').primaryKey(),
    /** No user FK: system events may outlive their users. */
    userId: objectId('user_id'),
    type: varchar('type', { length: 16 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    message: varchar('message', { length: 2000 }).notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    actions: jsonb('actions').$type<Array<{ label?: string; url?: string; action?: string }>>().notNull().default([]),
    destination: varchar('destination', { length: 64 }).notNull().default('user'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    sourceModule: varchar('source_module', { length: 100 }).notNull(),
    priority: varchar('priority', { length: 16 }).notNull().default('normal'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Mongo `metadata.extra` flattened to its own column (plan DDL). */
    extra: jsonb('metadata_extra').$type<Record<string, unknown>>(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    lastError: text('last_error'),
    ...timestamps(),
  },
  (t) => [
    check('ops_notifications_type_enum', sql`${t.type} IN ('info','warning','error','success','system')`),
    check('ops_notifications_status_enum', sql`${t.status} IN ('pending','sent','failed','read')`),
    check('ops_notifications_priority_enum', sql`${t.priority} IN ('low','normal','high','urgent')`),
    index('idx_notifications_user_status_created').on(t.userId, t.status, t.createdAt.desc()),
    index('idx_notifications_destination_status').on(t.destination, t.status),
    index('idx_notifications_expires').on(t.expiresAt).where(sql`${t.expiresAt} IS NOT NULL`),
    index('idx_notifications_created').on(t.createdAt.desc()),
    index('idx_notifications_status_retry').on(t.status, t.retryCount),
  ],
);

export const opsHealthHistory = opsSchema.table(
  'health_history',
  {
    id: objectId('id').primaryKey(),
    status: varchar('status', { length: 16 }).notNull(),
    /** Mongo stored the ISO stamp as a string; kept verbatim for parity. */
    timestamp: varchar('timestamp', { length: 64 }).notNull(),
    version: varchar('version', { length: 64 }).notNull(),
    uptime: doublePrecision('uptime').notNull(),
    checks: jsonb('checks').$type<Record<string, unknown>>().notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    /** TTL column — swept hourly. */
    expireAt: timestamp('expire_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('ops_health_status_enum', sql`${t.status} IN ('healthy','unhealthy','degraded')`),
    index('idx_health_history_recorded').on(t.recordedAt.desc()),
    index('idx_health_history_status_recorded').on(t.status, t.recordedAt.desc()),
    index('idx_health_history_expire').on(t.expireAt),
  ],
);
