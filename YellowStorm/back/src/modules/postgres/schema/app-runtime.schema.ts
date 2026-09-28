import { sql } from 'drizzle-orm';
import {
  bigint,
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
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

/** P8 app-runtime tables (Mongo cutover). */
export const appRuntimeSchema = pgSchema('app_runtime');

export const appRuntimeBindings = appRuntimeSchema.table(
  'bindings',
  {
    bindingId: varchar('binding_id', { length: 64 }).primaryKey(),
    workspaceId: varchar('workspace_id', { length: 128 }).unique().notNull(),
    conversationSessionId: varchar('conversation_session_id', { length: 128 }).notNull(),
    userId: varchar('user_id', { length: 24 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('created'),
    latestRevisionId: text('latest_revision_id').notNull().default('starter_react_vite_v6'),
    mcpTokenHash: text('mcp_token_hash').notNull(),
    browserRuntimeId: text('browser_runtime_id'),
    browserCapabilities: jsonb('browser_capabilities').$type<Record<string, unknown> | null>(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check(
      'ar_bindings_status_enum',
      sql`${t.status} IN ('created','waiting_for_browser','browser_active','paused','failed')`,
    ),
    index('idx_ar_bindings_mcp_token_hash').on(t.mcpTokenHash),
    index('idx_ar_bindings_conversation_session').on(t.conversationSessionId),
    index('idx_ar_bindings_user').on(t.userId),
  ],
);

export const appRuntimeTickets = appRuntimeSchema.table(
  'tickets',
  {
    runtimeSessionId: varchar('runtime_session_id', { length: 64 }).primaryKey(),
    ticketHash: text('ticket_hash').unique().notNull(),
    bindingId: varchar('binding_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    userId: varchar('user_id', { length: 24 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // Leading indexes of the 0037 foreign keys (binding, user).
    index('idx_ar_tickets_binding').on(t.bindingId),
    index('idx_ar_tickets_user').on(t.userId),
  ],
);

export const appRuntimeToolCalls = appRuntimeSchema.table(
  'tool_calls',
  {
    toolCallId: text('tool_call_id').primaryKey(),
    bindingId: varchar('binding_id', { length: 64 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    tool: text('tool').notNull(),
    argumentsHash: text('arguments_hash').notNull(),
    baseRevisionId: text('base_revision_id'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    error: jsonb('error').$type<Record<string, unknown> | null>(),
    resultingRevisionId: text('resulting_revision_id'),
    // Epoch ms (Date.now()) exceeds int4 (~2.1e9); use bigint.
    startedAtMs: bigint('started_at_ms', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    ...timestamps(),
  },
  (t) => [
    check(
      'ar_tool_calls_status_enum',
      sql`${t.status} IN ('pending','running','succeeded','failed')`,
    ),
    index('idx_ar_tool_calls_binding').on(t.bindingId, t.createdAt.desc()),
    index('idx_ar_tool_calls_workspace').on(t.workspaceId, t.createdAt.desc()),
    index('idx_ar_tool_calls_tool').on(t.tool, t.createdAt.desc()),
  ],
);

export const appRuntimeSourceRevisions = appRuntimeSchema.table(
  'source_revisions',
  {
    id: objectId('id').primaryKey(),
    revisionId: text('revision_id').notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    parentRevisionId: text('parent_revision_id'),
    manifestHash: text('manifest_hash').notNull(),
    manifestObjectKey: text('manifest_object_key').notNull(),
    files: jsonb('files').$type<Array<{ path: string; sha256: string; objectKey: string; size: number }>>().notNull().default([]),
    createdByToolCallId: text('created_by_tool_call_id'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_ar_source_revisions_ws_rev').on(t.workspaceId, t.revisionId)],
);

export const appRuntimeFinalizedRevisions = appRuntimeSchema.table(
  'finalized_revisions',
  {
    id: objectId('id').primaryKey(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    revisionId: text('revision_id').notNull(),
    title: text('title').notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull(),
    eventId: text('event_id').notNull(),
    fileCount: integer('file_count'),
    cephManifestPath: text('ceph_manifest_path'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_ar_finalized_revisions_ws_rev').on(t.workspaceId, t.revisionId),
    index('idx_ar_finalized_revisions_ws_at').on(t.workspaceId, t.finalizedAt.desc()),
  ],
);

export const appRuntimeAiPreviewTickets = appRuntimeSchema.table(
  'ai_preview_tickets',
  {
    id: objectId('id').primaryKey(),
    ticketHash: text('ticket_hash').unique().notNull(),
    conversationSessionId: varchar('conversation_session_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    bindingId: varchar('binding_id', { length: 64 }).notNull(),
    billableUserId: varchar('billable_user_id', { length: 24 }).notNull(),
    purpose: text('purpose').notNull().default('ai_preview'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index('idx_ar_ai_preview_tickets_session').on(t.conversationSessionId),
    index('idx_ar_ai_preview_tickets_workspace').on(t.workspaceId),
    index('idx_ar_ai_preview_tickets_binding').on(t.bindingId),
    index('idx_ar_ai_preview_tickets_billable_user').on(t.billableUserId),
  ],
);
