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

/** P8 app-builder schema (plan 2026-09-22). Separate from conversation.* V1. */
export const appBuilderSchema = pgSchema('conversation_v2');

export const appBuilderSessions = appBuilderSchema.table(
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
    starterRevisionId: text('starter_revision_id'),
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
    index('idx_c2_sessions_system_workspace').on(t.systemWorkspaceId),
    uniqueIndex('uq_c2_sessions_ai_session')
      .on(t.aiSessionId)
      .where(sql`${t.aiSessionId} IS NOT NULL`),
    uniqueIndex('uq_c2_sessions_share_token')
      .on(t.shareTokenHash)
      .where(sql`${t.shareTokenHash} IS NOT NULL`),
  ],
);

export const appBuilderEvents = appBuilderSchema.table(
  'events',
  {
    id: objectId('id').primaryKey(),
    sessionId: objectId('session_id')
      .notNull()
      .references(() => appBuilderSessions.id, { onDelete: 'cascade' }),
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

export const appBuilderAppShares = appBuilderSchema.table(
  'app_shares',
  {
    id: objectId('id').primaryKey(),
    sessionId: objectId('session_id')
      .notNull()
      .references(() => appBuilderSessions.id, { onDelete: 'cascade' }),
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
    index('idx_c2_app_shares_owner').on(t.ownerId),
  ],
);

/**
 * Admin-managed catalog of app templates shown in the Conversation V2 gallery.
 * `slug` is the stable public key; `icon` is a display hint (emoji/name).
 */
export const appBuilderTemplateCategories = appBuilderSchema.table(
  'template_categories',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    icon: varchar('icon', { length: 500 }).notNull().default(''),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_c2_tpl_categories_slug').on(t.slug),
    uniqueIndex('uq_c2_tpl_categories_name').on(t.name),
    check(
      'c2_tpl_categories_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

/**
 * A template is a full React/Vite project published to Ceph by a superadmin.
 * `revisionId` (`template_<id>`) resolves through RuntimeRevisionService, and
 * `manifestObjectKey` points at `appbuilder/manifests/_system/<revisionId>.json`.
 * `coverImage` is the Ceph object key of the uploaded cover (served as a
 * presigned URL), never a client-supplied URL.
 */
export const appBuilderTemplates = appBuilderSchema.table(
  'templates',
  {
    id: objectId('id').primaryKey(),
    categoryId: objectId('category_id')
      .notNull()
      .references(() => appBuilderTemplateCategories.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    coverImage: text('cover_image').notNull().default(''),
    revisionId: text('revision_id'),
    manifestObjectKey: text('manifest_object_key'),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    /** Platform Kit analysis of the uploaded ZIP, computed at publish time. */
    platformReport: jsonb('platform_report').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    check('c2_templates_status_enum', sql`${t.status} IN ('draft','published')`),
    uniqueIndex('uq_c2_templates_category_title').on(t.categoryId, t.title),
    uniqueIndex('uq_c2_templates_revision')
      .on(t.revisionId)
      .where(sql`${t.revisionId} IS NOT NULL`),
    index('idx_c2_templates_category').on(t.categoryId),
  ],
);

/**
 * Dedicated template manifest/revision persistence. Mirror of the App Builder
 * runtime `source_revisions` shape, scoped to templates: keeps the Ceph
 * manifest binding plus the manifest's files list for fast, DB-only
 * resolution in `RuntimeRevisionService`. One row per publish event;
 * extensible to a revision history per template.
 */
export const appBuilderTemplateRevisions = appBuilderSchema.table(
  'template_revisions',
  {
    id: objectId('id').primaryKey(),
    templateId: objectId('template_id')
      .notNull()
      .references(() => appBuilderTemplates.id, { onDelete: 'cascade' }),
    revisionId: text('revision_id').notNull(),
    manifestObjectKey: text('manifest_object_key').notNull(),
    manifestHash: varchar('manifest_hash', { length: 64 }).notNull(),
    files: jsonb('files').$type<Array<{ path: string; sha256: string; objectKey: string; size: number }>>().notNull(),
    fileCount: integer('file_count').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    ...timestamps(),
  },
  (t) => [
    check('c2_tpl_revisions_status_enum', sql`${t.status} IN ('draft','published')`),
    check('c2_tpl_revisions_file_count_nonneg', sql`${t.fileCount} >= 0`),
    uniqueIndex('uq_c2_tpl_revisions_revision').on(t.revisionId),
    index('idx_c2_tpl_revisions_template').on(t.templateId),
  ],
);
