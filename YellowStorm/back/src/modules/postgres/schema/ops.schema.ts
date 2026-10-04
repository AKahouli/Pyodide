import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, char, check, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
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
    actions: jsonb('actions').$type<{ label?: string; url?: string; action?: string }[]>().notNull().default([]),
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

/**
 * Transactional outbox of the integration events (roadmap P6). A row is written in the caller's
 * transaction, then claimed by the dispatcher with FOR UPDATE SKIP LOCKED; `attempts` counts claims.
 * Per-handler delivery state lives in `integration_event_deliveries`, not in an embedded array.
 */
export const opsIntegrationEvents = opsSchema.table(
  'integration_events',
  {
    id: objectId('id').primaryKey(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockOwner: text('lock_owner'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastError: text('last_error'),
    correlationId: text('correlation_id'),
    causationId: text('causation_id'),
    ...timestamps(),
  },
  (t) => [
    check('ops_integration_events_status', sql`${t.status} IN ('pending','processing','completed','failed','dead_letter')`),
    check('ops_integration_events_attempts', sql`${t.attempts} >= 0`),
    uniqueIndex('uq_integration_events_event_id').on(t.eventId),
    index('idx_integration_events_claim').on(t.nextAttemptAt).where(sql`${t.status} IN ('pending','failed')`),
    index('idx_integration_events_processing').on(t.lockedAt).where(sql`${t.status} = 'processing'`),
    index('idx_integration_events_aggregate').on(t.aggregateType, t.aggregateId, t.occurredAt),
  ],
);

export const opsIntegrationEventDeliveries = opsSchema.table(
  'integration_event_deliveries',
  {
    integrationEventId: objectId('integration_event_id').notNull(),
    handlerKey: text('handler_key').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.integrationEventId, t.handlerKey] }),
    check('ops_integration_event_deliveries_status', sql`${t.status} IN ('pending','completed','failed')`),
    check('ops_integration_event_deliveries_attempts', sql`${t.attempts} >= 0`),
  ],
);

/**
 * Application logs (roadmap P6): buffered by LogBufferService, read by the admin logs screen, swept by
 * the TTL sweeper once older than `logging.retentionDays`. `created_at` is the time the entry was
 * logged (not the flush time), so range filters and ordering follow the log line itself.
 */
export const opsLogs = opsSchema.table(
  'logs',
  {
    id: objectId('id').primaryKey(),
    /** The ISO stamp the logger produced, kept verbatim like Mongo did. */
    timestamp: text('timestamp').notNull(),
    level: varchar('level', { length: 8 }).notNull(),
    context: text('context'),
    message: text('message').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    traceId: text('trace_id'),
    requestId: text('request_id'),
    hostname: text('hostname'),
    nodeEnv: text('node_env'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ops_logs_level', sql`${t.level} IN ('ERROR','WARN','INFO','DEBUG','VERBOSE')`),
    index('idx_logs_created').on(t.createdAt.desc()),
    index('idx_logs_level_created').on(t.level, t.createdAt.desc()),
    index('idx_logs_context_created').on(t.context, t.createdAt.desc()),
    index('idx_logs_request').on(t.requestId).where(sql`${t.requestId} IS NOT NULL`),
    index('idx_logs_trace').on(t.traceId).where(sql`${t.traceId} IS NOT NULL`),
  ],
);

