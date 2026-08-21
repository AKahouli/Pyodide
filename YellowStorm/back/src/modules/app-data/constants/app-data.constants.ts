/** PostgreSQL control-plane schema. */
export const APP_DATA_CONTROL_SCHEMA = 'app_data';

/** Tenant schema prefix — full name: ymapp_<appDataId>_<env>. */
export const APP_DATA_TENANT_PREFIX = 'ymapp_';

export const APP_DATA_ENVIRONMENTS = ['dev', 'prod'] as const;
export type AppDataEnvironment = (typeof APP_DATA_ENVIRONMENTS)[number];

export const APP_DATA_LIFECYCLE_STATES = [
  'active',
  'archived',
  'purge_pending',
  'purged',
] as const;
export type AppDataLifecycleState = (typeof APP_DATA_LIFECYCLE_STATES)[number];

export const APP_DATA_MIGRATION_CLASSIFICATIONS = ['safe', 'destructive'] as const;
export type AppDataMigrationClassification =
  (typeof APP_DATA_MIGRATION_CLASSIFICATIONS)[number];

/** Policy principals enforced on public HTTP and MCP policy tools. */
export const APP_DATA_PRINCIPALS = [
  'anonymous',
  'public',
  'yellowmind_owner',
] as const;
export type AppDataPrincipal = (typeof APP_DATA_PRINCIPALS)[number];

/** Allowlisted column types for declarative manifests. */
export const APP_DATA_COLUMN_TYPES = [
  'text',
  'integer',
  'boolean',
  'timestamptz',
  'uuid',
] as const;
export type AppDataColumnType = (typeof APP_DATA_COLUMN_TYPES)[number];

/** Safe identifier pattern for table/column names. */
export const APP_DATA_IDENTIFIER_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** Opaque appDataId — server-generated lowercase slug. */
export const APP_DATA_ID_RE = /^[a-z0-9]{8,32}$/;

export const MCP_SERVER_NAME = 'yellowmind-app-data';
export const MCP_SERVER_VERSION = '0.1.0';

/** Optional client headers (allowed in CORS preflight for generated preview apps). */
export const APP_DATA_CORS_REQUEST_HEADERS = [
  'X-YM-App-Data-Id',
  'X-YM-App-Data-Env',
] as const;

/** Default DEV table policy: preview browser (anonymous) + MCP builder (yellowmind_owner). */
export const DEFAULT_DEV_TABLE_POLICY: {
  select: AppDataPrincipal[];
  insert: AppDataPrincipal[];
  update: AppDataPrincipal[];
  delete: AppDataPrincipal[];
} = {
  select: ['anonymous', 'yellowmind_owner'],
  insert: ['anonymous', 'yellowmind_owner'],
  update: ['anonymous', 'yellowmind_owner'],
  delete: ['anonymous', 'yellowmind_owner'],
};
