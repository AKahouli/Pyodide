import { sql } from 'drizzle-orm';
import { bigint, char, check, index, integer, jsonb, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { conversationSchema, conversations, rootExecutions } from './conversation.schema';

/** Background ownership is separate from native invocation/stream observers. */
export const rootBackgroundJobs = conversationSchema.table('root_background_jobs', {
  executionId: char('execution_id', { length: 24 }).primaryKey().references(() => rootExecutions.id, { onDelete: 'cascade' }),
  parentExecutionId: char('parent_execution_id', { length: 24 }).notNull().references(() => rootExecutions.id, { onDelete: 'cascade' }),
  conversationId: char('conversation_id', { length: 24 }).notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  actorId: char('actor_id', { length: 24 }).notNull(),
  conversationEpoch: integer('conversation_epoch').notNull(),
  requestDigest: char('request_digest', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('queued'),
  owner: varchar('owner', { length: 128 }),
  fence: integer('fence').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  deadline: timestamp('deadline', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  nativeSessionId: varchar('native_session_id', { length: 256 }).notNull(),
  nativeInvocationId: varchar('native_invocation_id', { length: 128 }),
  initialInputEventId: varchar('initial_input_event_id', { length: 128 }),
  initialInputDigest: char('initial_input_digest', { length: 64 }),
  nativeOwner: varchar('native_owner', { length: 128 }),
  nativeOwnerFence: integer('native_owner_fence'),
  pendingInputResponses: jsonb('pending_input_responses').$type<Array<{ input_id: string; function_name: string;
    input_version: number; response: Record<string, unknown> }>>(),
  inputResponseDigest: char('input_response_digest', { length: 64 }),
  inputResponseEventId: varchar('input_response_event_id', { length: 128 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('root_background_jobs_status', sql`${table.status} IN ('queued','running','waiting','completed','failed','cancelled','outcome_unknown')`),
  check('root_background_jobs_attempts', sql`${table.attempts} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 5 AND ${table.fence} >= 0`),
  index('idx_root_background_jobs_claim').on(table.status, table.availableAt, table.leaseUntil),
  index('idx_root_background_jobs_parent').on(table.parentExecutionId),
  index('idx_root_background_jobs_actor').on(table.actorId),
]);

export const rootBackgroundEvents = conversationSchema.table('root_background_events', {
  sequence: bigint('sequence', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  executionId: char('execution_id', { length: 24 }).notNull().references(() => rootBackgroundJobs.executionId, { onDelete: 'cascade' }),
  conversationId: char('conversation_id', { length: 24 }).notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  actorId: char('actor_id', { length: 24 }).notNull(),
  conversationEpoch: integer('conversation_epoch').notNull(),
  eventId: varchar('event_id', { length: 128 }).notNull(),
  payloadDigest: char('payload_digest', { length: 64 }).notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('root_background_events_execution_event').on(table.executionId, table.eventId),
  index('idx_root_background_events_replay').on(table.conversationId, table.conversationEpoch, table.sequence),
]);
