import { sql } from 'drizzle-orm';
import { bigint, boolean, char, check, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { agents } from './agents.schema';
import { objectId, timestamps } from '../../../common/postgres/columns';

/** P4 channels schema: telegram and widget (plan 2026-09-19 step 4b/4c). WhatsApp tables were dropped by 0032. */
export const channelsSchema = pgSchema('channels');

// ── telegram ──────────────────────────────────────────────────────────

export const channelsTelegramIntegrations = channelsSchema.table(
  'telegram_integrations',
  {
    id: objectId('id').primaryKey(),
    userId: objectId('user_id').notNull(),
    /** Safety net — agent delete teardown runs first (plan 4.6). */
    agentId: objectId('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Ciphertext; copied byte-exact. */
    encryptedBotToken: text('encrypted_bot_token').notNull(),
    botUsername: varchar('bot_username', { length: 100 }),
    webhookSecret: varchar('webhook_secret', { length: 128 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    errorMessage: varchar('error_message', { length: 500 }),
    lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
    lastUpdateId: bigint('last_update_id', { mode: 'number' }),
    ...timestamps(),
  },
  (t) => [
    check('telegram_integrations_status_enum', sql`${t.status} IN ('pending','active','error')`),
    uniqueIndex('uq_telegram_integrations_agent').on(t.agentId),
    index('idx_telegram_integrations_user_enabled').on(t.userId, t.enabled),
    index('idx_telegram_integrations_status').on(t.status),
  ],
);

export const channelsTelegramChatBindings = channelsSchema.table(
  'telegram_chat_bindings',
  {
    id: objectId('id').primaryKey(),
    integrationId: objectId('integration_id')
      .notNull()
      .references(() => channelsTelegramIntegrations.id, { onDelete: 'cascade' }),
    userId: objectId('user_id').notNull(),
    agentId: objectId('agent_id').notNull(),
    telegramChatId: varchar('telegram_chat_id', { length: 64 }).notNull(),
    telegramUserId: varchar('telegram_user_id', { length: 64 }),
    conversationId: objectId('conversation_id'),
    /** 'member' = owner-linked chat, 'guest' = external visitor inbox. */
    bindingType: varchar('binding_type', { length: 16 }).notNull().default('member'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('telegram_chat_bindings_type_enum', sql`${t.bindingType} IN ('member','guest')`),
    uniqueIndex('uq_telegram_chat_bindings_chat').on(t.integrationId, t.telegramChatId),
    index('idx_telegram_chat_bindings_user').on(t.userId),
    index('idx_telegram_chat_bindings_agent').on(t.agentId),
    index('idx_telegram_chat_bindings_conv').on(t.conversationId).where(sql`${t.conversationId} IS NOT NULL`),
  ],
);

export const channelsTelegramLinkCodes = channelsSchema.table(
  'telegram_link_codes',
  {
    id: objectId('id').primaryKey(),
    integrationId: objectId('integration_id')
      .notNull()
      .references(() => channelsTelegramIntegrations.id, { onDelete: 'cascade' }),
    userId: objectId('user_id').notNull(),
    agentId: objectId('agent_id').notNull(),
    codeHash: char('code_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed: boolean('consumed').notNull().default(false),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_telegram_link_codes_hash').on(t.codeHash),
    index('idx_telegram_link_codes_integration').on(t.integrationId, t.consumed),
    index('idx_telegram_link_codes_expires').on(t.expiresAt),
  ],
);

/** Owner validation (human-in-the-loop): guest asks, owner answers async. */
export const channelsTelegramHumanValidations = channelsSchema.table(
  'telegram_human_validations',
  {
    id: objectId('id').primaryKey(),
    integrationId: objectId('integration_id')
      .notNull()
      .references(() => channelsTelegramIntegrations.id, { onDelete: 'cascade' }),
    agentId: objectId('agent_id').notNull(),
    conversationId: objectId('conversation_id').notNull(),
    guestTelegramChatId: varchar('guest_telegram_chat_id', { length: 64 }).notNull().default(''),
    guestLabel: varchar('guest_label', { length: 200 }),
    question: text('question').notNull(),
    choices: text('choices').array().notNull().default([]),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    answer: text('answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ownerMessageId: integer('owner_message_id'),
    ...timestamps(),
  },
  (t) => [
    check('telegram_human_validations_status_enum', sql`${t.status} IN ('pending','answered','expired','failed')`),
    index('idx_telegram_validations_integration_status').on(t.integrationId, t.status, t.expiresAt),
    index('idx_telegram_validations_conversation').on(t.conversationId, t.status),
  ],
);

// ── widget ────────────────────────────────────────────────────────────

export const channelsWidgetTokens = channelsSchema.table(
  'widget_tokens',
  {
    id: objectId('id').primaryKey(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    agentId: objectId('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 200 }),
    allowedOrigins: text('allowed_origins').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    /** NOT a TTL: checked in code (parity). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdBy: objectId('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_widget_tokens_hash').on(t.tokenHash),
    index('idx_widget_tokens_agent_active').on(t.agentId, t.isActive),
  ],
);

export const channelsWidgetSessions = channelsSchema.table(
  'widget_sessions',
  {
    id: objectId('id').primaryKey(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    agentId: objectId('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    visitorId: varchar('visitor_id', { length: 128 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    clientContext: jsonb('client_context').$type<Record<string, unknown>>().notNull().default({}),
    appSource: jsonb('app_source').$type<Record<string, unknown>>().notNull().default({}),
    geo: jsonb('geo').$type<Record<string, unknown>>().notNull().default({ status: 'unavailable', reason: 'provider_not_configured' }),
    status: varchar('status', { length: 8 }).notNull().default('active'),
    messageCount: integer('message_count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    check('widget_sessions_status_enum', sql`${t.status} IN ('active','closed')`),
    uniqueIndex('uq_widget_sessions_active_visitor').on(t.tokenHash, t.visitorId).where(sql`${t.status} = 'active'`),
    index('idx_widget_sessions_agent').on(t.agentId),
  ],
);

export const channelsWidgetMessages = channelsSchema.table(
  'widget_messages',
  {
    id: objectId('id').primaryKey(),
    sessionId: objectId('session_id')
      .notNull()
      .references(() => channelsWidgetSessions.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    agentId: objectId('agent_id').notNull(),
    role: varchar('role', { length: 16 }).notNull(),
    content: varchar('content', { length: 50000 }).notNull(),
    components: jsonb('components').$type<unknown[]>().notNull().default([]),
    interaction: jsonb('interaction'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('widget_messages_role_enum', sql`${t.role} IN ('user','assistant')`),
    index('idx_widget_messages_session_created').on(t.sessionId, t.createdAt),
  ],
);
