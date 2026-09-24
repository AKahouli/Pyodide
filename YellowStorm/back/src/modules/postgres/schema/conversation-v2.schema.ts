import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { objectId, objectIdArray, timestamps } from '../../../common/postgres/columns';

/** P8 conversation-v2 schema (plan 2026-09-22). Separate from conversation.* V1. */
export const conversationV2Schema = pgSchema('conversation_v2');

export const conversationV2Sessions = conversationV2Schema.table(
  'sessions',
  {
    id: objectId('id').primaryKey(),
    ownerId: objectId('owner_id').notNull(),
    aiSessionId: text('ai_session_id'),
    title: varchar('title', { length: 500 }).notNull().default(''),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull().defaultNow(),
    isShared: boolean('is_shared').notNull().default(false),
    shareTokenHash: text('share_token_hash'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deployStatus: varchar('deploy_status', { length: 16 }).notNull().default('idle'),
    deployedUrl: text('deployed_url'),
    deployedAppTitle: text('deployed_app_title'),
    lastDeployedAt: timestamp('last_deployed_at', { withTimezone: true }),
    lastDeployedRevisionId: text('last_deployed_revision_id'),
    hasAiFeatures: boolean('has_ai_features').notNull().default(false),
    aiFeaturesCheckedRevisionId: text('ai_features_checked_revision_id'),
    workspaceIds: objectIdArray('workspace_ids').notNull().default(sql`'{}'::char(24)[]`),
    selectedSkillIds: objectIdArray('selected_skill_ids').notNull().default(sql`'{}'::char(24)[]`),
    selectedConnectorIds: objectIdArray('selected_connector_ids')
      .notNull()
      .default(sql`'{}'::char(24)[]`),
    eventSequence: integer('event_sequence').notNull().default(0),
    eventCount: integer('event_count').notNull().default(0),
    systemWorkspaceId: objectId('system_workspace_id'),
    ...timestamps(),
  },
  (t) => [
    check(
      'c2_sessions_status_enum',
      sql`${t.status} IN ('active','waiting','paused','stopped','completed','error')`,
    ),
    check(
      'c2_sessions_deploy_status_enum',
      sql`${t.deployStatus} IN ('idle','deploying','deployed','error')`,
    ),
    check('c2_sessions_event_sequence_nonneg', sql`${t.eventSequence} >= 0`),
    check('c2_sessions_event_count_nonneg', sql`${t.eventCount} >= 0`),
    index('idx_c2_sessions_owner_deleted_last').on(t.ownerId, t.deletedAt, t.lastEventAt.desc()),
    uniqueIndex('uq_c2_sessions_ai_session')
      .on(t.aiSessionId)
      .where(sql`${t.aiSessionId} IS NOT NULL`),
    uniqueIndex('uq_c2_sessions_share_token')
      .on(t.shareTokenHash)
      .where(sql`${t.shareTokenHash} IS NOT NULL`),
  ],
);

export const conversationV2Events = conversationV2Schema.table(
  'events',
  {
    id: objectId('id').primaryKey(),
    sessionId: objectId('session_id')
      .notNull()
      .references(() => conversationV2Sessions.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    eventId: text('event_id').notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    emittedAt: integer('emitted_at').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    modelId: varchar('model_id', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('c2_events_sequence_nonneg', sql`${t.sequence} >= 0`),
    check(
      'c2_events_type_enum',
      sql`${t.type} IN (
        'message','tool','step','plan','title','done','wait','error',
        'application_component','app_build_progress'
      )`,
    ),
    uniqueIndex('uq_c2_events_session_sequence').on(t.sessionId, t.sequence),
    uniqueIndex('uq_c2_events_session_event_id').on(t.sessionId, t.eventId),
    index('idx_c2_events_session_type_sequence').on(t.sessionId, t.type, t.sequence),
  ],
);

export const conversationV2AppShares = conversationV2Schema.table(
  'app_shares',
  {
    id: objectId('id').primaryKey(),
    sessionId: objectId('session_id')
      .notNull()
      .references(() => conversationV2Sessions.id, { onDelete: 'cascade' }),
    ownerId: objectId('owner_id').notNull(),
    recipientUserId: objectId('recipient_user_id'),
    recipientEmail: text('recipient_email'),
    title: varchar('title', { length: 500 }).notNull(),
    deployedUrl: text('deployed_url').notNull(),
    lastDeployedAt: timestamp('last_deployed_at', { withTimezone: true }),
    includeConversation: boolean('include_conversation').notNull().default(true),
    inviteTokenHash: text('invite_token_hash'),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    inviteConsumedAt: timestamp('invite_consumed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_c2_shares_session_user')
      .on(t.sessionId, t.recipientUserId)
      .where(sql`${t.recipientUserId} IS NOT NULL`),
    uniqueIndex('uq_c2_shares_session_email')
      .on(t.sessionId, t.recipientEmail)
      .where(sql`${t.recipientEmail} IS NOT NULL`),
    uniqueIndex('uq_c2_shares_invite_token')
      .on(t.inviteTokenHash)
      .where(sql`${t.inviteTokenHash} IS NOT NULL`),
    index('idx_c2_shares_recipient_updated').on(t.recipientUserId, t.updatedAt.desc()),
  ],
);
