import { sql } from 'drizzle-orm';
import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
  boolean,
} from 'drizzle-orm/pg-core';
import { APP_DATA_CONTROL_SCHEMA } from '../../app-data/constants/app-data.constants';

export const appDataSchema = pgSchema(APP_DATA_CONTROL_SCHEMA);

export const appDataApps = appDataSchema.table(
  'apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appDataId: varchar('app_data_id', { length: 32 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    ownerUserId: varchar('owner_user_id', { length: 24 }).notNull(),
    jwtSecret: varchar('jwt_secret', { length: 128 }),
    endUserAuthEnabled: boolean('end_user_auth_enabled').notNull().default(false),
    lifecycleState: varchar('lifecycle_state', { length: 32 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_app_data_apps_app_data_id').on(t.appDataId),
    uniqueIndex('uq_app_data_apps_workspace_id').on(t.workspaceId),
    index('idx_app_data_apps_owner').on(t.ownerUserId),
    check(
      'chk_app_data_apps_lifecycle',
      sql`${t.lifecycleState} IN ('active', 'archived', 'purge_pending', 'purged')`,
    ),
  ],
);

export const appDataEnvironments = appDataSchema.table(
  'environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appDataApps.id, { onDelete: 'cascade' }),
    environment: varchar('environment', { length: 8 }).notNull(),
    schemaName: varchar('schema_name', { length: 128 }).notNull(),
    currentVersion: integer('current_version').notNull().default(0),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_app_data_env_app_env').on(t.appId, t.environment),
    uniqueIndex('uq_app_data_env_schema_name').on(t.schemaName),
    check(
      'chk_app_data_env_environment',
      sql`${t.environment} IN ('dev', 'prod')`,
    ),
  ],
);

export const appDataSchemaVersions = appDataSchema.table(
  'schema_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appDataApps.id, { onDelete: 'cascade' }),
    environment: varchar('environment', { length: 8 }).notNull(),
    version: integer('version').notNull(),
    manifestHash: varchar('manifest_hash', { length: 64 }).notNull(),
    manifestJson: jsonb('manifest_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_app_data_schema_version').on(t.appId, t.environment, t.version),
    index('idx_app_data_schema_versions_app').on(t.appId, t.environment),
  ],
);

export const appDataMigrations = appDataSchema.table(
  'migrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appDataApps.id, { onDelete: 'cascade' }),
    environment: varchar('environment', { length: 8 }).notNull(),
    fromVersion: integer('from_version').notNull(),
    toVersion: integer('to_version').notNull(),
    planJson: jsonb('plan_json').notNull(),
    classification: varchar('classification', { length: 16 }).notNull(),
    toolCallId: varchar('tool_call_id', { length: 128 }),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_app_data_migrations_app').on(t.appId, t.environment),
    check(
      'chk_app_data_migrations_classification',
      sql`${t.classification} IN ('safe', 'destructive')`,
    ),
  ],
);

export const appDataPolicies = appDataSchema.table(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appDataApps.id, { onDelete: 'cascade' }),
    environment: varchar('environment', { length: 8 }).notNull(),
    tableName: varchar('table_name', { length: 63 }).notNull(),
    policyJson: jsonb('policy_json').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_app_data_policies_table').on(t.appId, t.environment, t.tableName),
  ],
);

export const appDataReleaseBindings = appDataSchema.table(
  'release_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    revisionId: varchar('revision_id', { length: 128 }).notNull(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appDataApps.id, { onDelete: 'cascade' }),
    requiredSchemaVersion: integer('required_schema_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_app_data_release_binding').on(t.workspaceId, t.revisionId),
    index('idx_app_data_release_bindings_app').on(t.appId),
  ],
);

export const appDataAuditEvents = appDataSchema.table(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appDataApps.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    actorPrincipal: varchar('actor_principal', { length: 64 }).notNull(),
    metadataJson: jsonb('metadata_json').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_app_data_audit_app_created').on(t.appId, t.createdAt)],
);

export const appDataEndUsers = appDataSchema.table(
  'end_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appDataApps.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 128 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_app_data_end_users_app_email').on(t.appId, t.email),
    index('idx_app_data_end_users_app').on(t.appId),
    check(
      'chk_app_data_end_users_status',
      sql`${t.status} IN ('active', 'disabled')`,
    ),
  ],
);

export const appDataEndUserGrants = appDataSchema.table(
  'end_user_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appDataApps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => appDataEndUsers.id, { onDelete: 'cascade' }),
    canCreate: boolean('can_create').notNull().default(false),
    canRead: boolean('can_read').notNull().default(false),
    canUpdate: boolean('can_update').notNull().default(false),
    canDelete: boolean('can_delete').notNull().default(false),
    /** Nest-local only. With APP_DATA_REMOTE=true, AI grant lives in MS ACL (`use_ai`). */
    canUseAi: boolean('can_use_ai').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_app_data_end_user_grants_app_user').on(t.appId, t.userId)],
);

export type AppDataAppRow = typeof appDataApps.$inferSelect;
export type AppDataEnvironmentRow = typeof appDataEnvironments.$inferSelect;
export type AppDataEndUserRow = typeof appDataEndUsers.$inferSelect;
export type AppDataEndUserGrantRow = typeof appDataEndUserGrants.$inferSelect;
