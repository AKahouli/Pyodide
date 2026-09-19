import { sql } from 'drizzle-orm';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { bigint, boolean, check, index, integer, jsonb, primaryKey, smallint, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';
// Reuse the schema instance created in Step B — do not create a second pgSchema('workspace').
import { workspaceSchema } from './workspace-artifact.schema';

export const workspaceSettings = workspaceSchema.table(
  'workspace_settings',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    tag: varchar('tag', { length: 50 }),
    llmModel: varchar('llm_model', { length: 100 }), // deprecated, kept for back-compat
    isTemplate: boolean('is_template').notNull().default(false),
    isPredefined: boolean('is_predefined').notNull().default(false),
    createdBy: objectId('created_by').notNull(),
    instruction: varchar('instruction', { length: 10000 }),
    chunks: integer('chunks').notNull().default(5),
    hybridSearch: boolean('hybrid_search').notNull().default(false),
    ragType: varchar('rag_type', { length: 20 }).notNull().default('standard'),
    maxToken: integer('max_token').notNull().default(4096),
    topK: integer('top_k').notNull().default(10),
    ...timestamps(),
  },
  (t) => [
    check('ws_settings_chunks_range', sql`${t.chunks} BETWEEN 1 AND 100`),
    check('ws_settings_max_token_range', sql`${t.maxToken} BETWEEN 100 AND 128000`),
    check('ws_settings_top_k_range', sql`${t.topK} BETWEEN 1 AND 100`),
    check('ws_settings_rag_type', sql`${t.ragType} IN ('standard','advancedRag','smartRag')`),
    index('idx_ws_settings_owner_created').on(t.createdBy, sql`${t.createdAt} DESC`),
    index('idx_ws_settings_template').on(t.isTemplate, sql`${t.createdAt} DESC`),
    index('idx_ws_settings_tag_template').on(t.tag, t.isTemplate),
  ],
);

export const workspaces = workspaceSchema.table(
  'workspaces',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    alias: varchar('alias', { length: 100 }).notNull(),
    storagePrefix: varchar('storage_prefix', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    createdBy: objectId('created_by').notNull(),
    settingsId: objectId('settings_id').references((): AnyPgColumn => workspaceSettings.id, { onDelete: 'set null' }),
    documentCount: integer('document_count').notNull().default(0),
    usedStorage: bigint('used_storage', { mode: 'number' }).notNull().default(0),
    allocatedStorage: bigint('allocated_storage', { mode: 'number' }).notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    isPersonal: boolean('is_personal').notNull().default(false),
    shareCount: integer('share_count').notNull().default(0),
    isPublic: boolean('is_public').notNull().default(false),
    conversationId: objectId('conversation_id'),
    ...timestamps(),
  },
  (t) => [
    check('workspaces_document_count_non_negative', sql`${t.documentCount} >= 0`),
    check('workspaces_used_storage_non_negative', sql`${t.usedStorage} >= 0`),
    check('workspaces_allocated_storage_non_negative', sql`${t.allocatedStorage} >= 0`),
    check('workspaces_share_count_non_negative', sql`${t.shareCount} >= 0`),
    uniqueIndex('uq_workspaces_owner_name').on(t.createdBy, t.name),
    uniqueIndex('uq_workspaces_owner_alias').on(t.createdBy, t.alias),
    uniqueIndex('uq_workspaces_owner_prefix').on(t.createdBy, t.storagePrefix),
    index('idx_workspaces_owner_created').on(t.createdBy, sql`${t.createdAt} DESC`),
    index('idx_workspaces_alias').on(t.alias),
    index('idx_workspaces_flags').on(t.isSystem, t.isPersonal, t.isPublic),
  ],
);

export const workspaceDocuments = workspaceSchema.table(
  'workspace_documents',
  {
    id: objectId('id').primaryKey(),
    filename: varchar('filename', { length: 255 }),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    path: varchar('path', { length: 500 }),
    url: varchar('url', { length: 1000 }),
    contentHash: varchar('content_hash', { length: 64 }),
    workspaceId: objectId('workspace_id')
      .notNull()
      .references((): AnyPgColumn => workspaces.id, { onDelete: 'cascade' }),
    createdBy: objectId('created_by').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    errorMessage: varchar('error_message', { length: 500 }),
    metadata: jsonb('metadata'),
    indexingStatus: varchar('indexing_status', { length: 20 }).notNull().default('none'),
    indexingError: text('indexing_error'),
    indexingTaskName: text('indexing_task_name'),
    indexingTaskId: text('indexing_task_id'),
    indexingAttemptId: text('indexing_attempt_id'),
    indexingAttemptStartedAt: timestamp('indexing_attempt_started_at', { withTimezone: true }),
    indexingAttemptCompletedAt: timestamp('indexing_attempt_completed_at', { withTimezone: true }),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
    indexingStartedAt: timestamp('indexing_started_at', { withTimezone: true }),
    detectedLanguage: text('detected_language'),
    chunkSize: integer('chunk_size').default(1200),
    parentId: objectId('parent_id').references((): AnyPgColumn => workspaceDocuments.id, { onDelete: 'cascade' }),
    isFolder: boolean('is_folder').notNull().default(false),
    folderName: varchar('folder_name', { length: 255 }),
    type: varchar('type', { length: 10 }).notNull().default('doc'),
    sourceUrl: varchar('source_url', { length: 2000 }),
    ...timestamps(),
  },
  (t) => [
    check('documents_size_non_negative', sql`${t.size} >= 0`),
    check('documents_status', sql`${t.status} IN ('pending','uploading','processing','completed','failed')`),
    check('documents_indexing_status', sql`${t.indexingStatus} IN ('none','pending','processing','ready','failed')`),
    check('documents_type', sql`${t.type} IN ('doc','url')`),
    index('idx_documents_ws_created').on(t.workspaceId, sql`${t.createdAt} DESC`),
    index('idx_documents_ws_status').on(t.workspaceId, t.status),
    index('idx_documents_ws_parent').on(t.workspaceId, t.parentId),
    index('idx_documents_ws_folder').on(t.workspaceId, t.isFolder),
    index('idx_documents_path').on(t.path),
    index('idx_documents_indexing').on(t.indexingStatus),
    index('idx_documents_attempt').on(t.indexingAttemptId),
    index('idx_documents_type').on(t.type),
    uniqueIndex('uq_documents_ws_name_files').on(t.workspaceId, t.originalName).where(sql`${t.isFolder} = false`),
  ],
);

export const workspaceShares = workspaceSchema.table(
  'workspace_shares',
  {
    id: objectId('id').primaryKey(),
    workspaceId: objectId('workspace_id')
      .notNull()
      .references((): AnyPgColumn => workspaces.id, { onDelete: 'cascade' }),
    ownerId: objectId('owner_id').notNull(),
    sharedWithUserId: objectId('shared_with_user_id').notNull(),
    permission: varchar('permission', { length: 16 }).notNull(),
    sharedBy: objectId('shared_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('ws_shares_permission', sql`${t.permission} IN ('read','readwrite')`),
    uniqueIndex('uq_ws_shares_ws_user').on(t.workspaceId, t.sharedWithUserId),
    index('idx_ws_shares_user_created').on(t.sharedWithUserId, sql`${t.createdAt} DESC`),
    index('idx_ws_shares_ws_created').on(t.workspaceId, sql`${t.createdAt} DESC`),
    index('idx_ws_shares_owner').on(t.ownerId),
  ],
);

export const uploadSessions = workspaceSchema.table(
  'upload_sessions',
  {
    id: objectId('id').primaryKey(),
    workspaceId: objectId('workspace_id')
      .notNull()
      .references((): AnyPgColumn => workspaces.id, { onDelete: 'cascade' }),
    userId: objectId('user_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    totalFiles: integer('total_files').notNull(),
    totalSize: bigint('total_size', { mode: 'number' }).notNull(),
    completedFiles: integer('completed_files').notNull().default(0),
    failedFiles: integer('failed_files').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    check('upload_sessions_status', sql`${t.status} IN ('pending','in_progress','completed','expired','failed')`),
    index('idx_upload_sessions_ws_status').on(t.workspaceId, t.status),
    index('idx_upload_sessions_user').on(t.userId, sql`${t.createdAt} DESC`),
    index('idx_upload_sessions_expires').on(t.expiresAt),
  ],
);

export const uploadSessionFiles = workspaceSchema.table(
  'upload_session_files',
  {
    sessionId: objectId('session_id')
      .notNull()
      .references((): AnyPgColumn => uploadSessions.id, { onDelete: 'cascade' }),
    fileIndex: integer('file_index').notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    documentId: objectId('document_id'),
    uploadUrl: varchar('upload_url', { length: 2000 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    progress: smallint('progress').notNull().default(0),
    error: varchar('error', { length: 500 }),
  },
  (t) => [
    check('upload_session_files_status', sql`${t.status} IN ('pending','uploading','completed','failed')`),
    check('upload_session_files_progress_range', sql`${t.progress} BETWEEN 0 AND 100`),
    primaryKey({ columns: [t.sessionId, t.fileIndex] }),
  ],
);
