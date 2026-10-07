import { sql } from 'drizzle-orm';
import { boolean, char, check, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

/** P3 integrations tables (plan 2026-09-19 step 3). */
export const integrationsSchema = pgSchema('integrations');

export const integrationsConnectedAppDefinitions = integrationsSchema.table(
  'connected_app_definitions',
  {
    id: objectId('id').primaryKey(),
    appKey: varchar('app_key', { length: 50 }).notNull(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    iconKey: varchar('icon_key', { length: 50 }),
    authorizationUrl: text('authorization_url').notNull(),
    tokenUrl: text('token_url').notNull(),
    revokeUrl: text('revoke_url'),
    /** Ciphertext columns keep the Mongo plaintext-at-rest parity (out of scope). */
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret').notNull(),
    tenantId: text('tenant_id'),
    scopes: text('scopes').array().notNull().default([]),
    pkceEnabled: boolean('pkce_enabled').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_connected_app_definitions_key').on(t.appKey),
    index('idx_connected_app_definitions_enabled').on(t.enabled, t.sortOrder),
  ],
);

export const integrationsUserAppConnections = integrationsSchema.table(
  'user_app_connections',
  {
    id: objectId('id').primaryKey(),
    userId: objectId('user_id').notNull(),
    appKey: varchar('app_key', { length: 50 }).notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').array().notNull().default([]),
    providerAccountId: varchar('provider_account_id', { length: 255 }),
    providerEmail: varchar('provider_email', { length: 320 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    ...timestamps(),
  },
  (t) => [
    check('integrations_uac_status_enum', sql`${t.status} IN ('active','expired','revoked','error')`),
    uniqueIndex('uq_user_app_connections_user_app').on(t.userId, t.appKey),
    index('idx_user_app_connections_app').on(t.appKey),
  ],
);

export const integrationsConnectedAppOauthStates = integrationsSchema.table(
  'connected_app_oauth_states',
  {
    id: objectId('id').primaryKey(),
    state: varchar('state', { length: 256 }).notNull(),
    appKey: varchar('app_key', { length: 50 }).notNull(),
    userId: objectId('user_id').notNull(),
    codeVerifier: text('code_verifier'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_connected_app_oauth_states_state').on(t.state),
    index('idx_connected_app_oauth_states_expires').on(t.expiresAt),
    index('idx_connected_app_oauth_states_user').on(t.userId),
  ],
);

export const integrationsConnectorCategories = integrationsSchema.table(
  'connector_categories',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 1024 }).notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    /** System sentinel possible → no user FK. */
    createdBy: objectId('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_connector_categories_owner_name').on(t.name, t.createdBy),
    index('idx_connector_categories_created_by').on(t.createdBy),
  ],
);

export const integrationsConnectors = integrationsSchema.table(
  'connectors',
  {
    id: objectId('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 1024 }).notNull(),
    icon: varchar('icon', { length: 64 }).notNull().default(''),
    color: varchar('color', { length: 64 }).notNull().default(''),
    iconColor: varchar('icon_color', { length: 8 }).notNull().default('light'),
    categoryId: objectId('category_id').references(() => integrationsConnectorCategories.id, { onDelete: 'set null' }),
    authType: varchar('auth_type', { length: 16 }).notNull().default('none'),
    authConfigSchema: jsonb('auth_config_schema').$type<Record<string, unknown>>().notNull().default({}),
    authSourceType: varchar('auth_source_type', { length: 32 }).notNull().default('credential'),
    connectedAppKey: varchar('connected_app_key', { length: 64 }).notNull().default(''),
    /** May hold static secrets (parity: plaintext). */
    runtimeAuthConfig: jsonb('runtime_auth_config').$type<Record<string, unknown>>().notNull().default({}),
    mcpTransportType: varchar('mcp_transport_type', { length: 32 }).notNull().default('streamable_http'),
    mcpServerUrl: varchar('mcp_server_url', { length: 1024 }).notNull(),
    /** May hold headers/env secrets (parity). */
    mcpServerConfig: jsonb('mcp_server_config').$type<Record<string, unknown>>().notNull().default({}),
    workerPolicy: jsonb('worker_policy').$type<import('../../connector/connector.types').ConnectorWorkerPolicy>().notNull().default({ enabled: true, defaultExecutionKind: 'leaf', agentLaunchEnabled: false }),
    dynamicHeaders: jsonb('dynamic_headers').$type<Record<string, unknown>[]>().notNull().default([]),
    /** Subdocument _ids preserved inside (plan DDL note). */
    actions: jsonb('actions').$type<Record<string, unknown>[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
    isHidden: boolean('is_hidden').notNull().default(false),
    /** System sentinel possible → no user FK. */
    createdBy: objectId('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_connectors_owner_slug').on(t.slug, t.createdBy),
    uniqueIndex('uq_connectors_system_slug').on(t.slug).where(sql`${t.isSystem}`),
    index('idx_connectors_active_owner').on(t.isActive, t.createdBy),
    index('idx_connectors_category').on(t.categoryId),
    index('idx_connectors_created_by').on(t.createdBy),
    index('idx_connectors_flags').on(t.isSystem, t.isHidden),
  ],
);

export const integrationsConnectorSkills = integrationsSchema.table(
  'connector_skills',
  {
    connectorId: objectId('connector_id')
      .notNull()
      .references(() => integrationsConnectors.id, { onDelete: 'cascade' }),
    skillId: objectId('skill_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.connectorId, t.skillId] }), index('idx_connector_skills_skill').on(t.skillId)],
);

export const integrationsConnectorCredentials = integrationsSchema.table(
  'connector_credentials',
  {
    id: objectId('id').primaryKey(),
    connectorId: objectId('connector_id')
      .notNull()
      .references(() => integrationsConnectors.id, { onDelete: 'cascade' }),
    displayName: varchar('display_name', { length: 128 }).notNull(),
    authPayload: jsonb('auth_payload').$type<Record<string, unknown>>().notNull().default({}),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    userId: objectId('user_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('integrations_cred_status_enum', sql`${t.status} IN ('active','invalid','expired')`),
    index('idx_connector_credentials_connector_user').on(t.connectorId, t.userId),
    index('idx_connector_credentials_user_status').on(t.userId, t.status),
  ],
);

export const integrationsAdminConnectorAuthTokens = integrationsSchema.table(
  'admin_connector_auth_tokens',
  {
    id: objectId('id').primaryKey(),
    userId: objectId('user_id').notNull(),
    appKey: varchar('app_key', { length: 64 }).notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').array().notNull().default([]),
    providerAccountId: varchar('provider_account_id', { length: 255 }),
    providerEmail: varchar('provider_email', { length: 320 }),
    connected: boolean('connected').notNull().default(true),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    ...timestamps(),
  },
  (t) => [
    check('integrations_admin_status_enum', sql`${t.status} IN ('active','expired','revoked','error')`),
    uniqueIndex('uq_admin_connector_auth_user_app').on(t.userId, t.appKey),
    index('idx_admin_connector_auth_app_connected').on(t.appKey, t.connected),
  ],
);

export const integrationsAdminConnectorOauthStates = integrationsSchema.table(
  'admin_connector_oauth_states',
  {
    id: objectId('id').primaryKey(),
    state: varchar('state', { length: 256 }).notNull(),
    appKey: varchar('app_key', { length: 64 }).notNull(),
    userId: objectId('user_id').notNull(),
    codeVerifier: text('code_verifier'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_admin_connector_oauth_states_state').on(t.state),
    index('idx_admin_connector_oauth_states_expires').on(t.expiresAt),
    index('idx_admin_connector_oauth_states_user').on(t.userId),
  ],
);
