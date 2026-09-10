export const APP_DATA_MCP_TOOL_NAMES = [
  'appdata_status',
  'provision',
  'schema_get',
  'schema_plan',
  'schema_apply',
  'policy_get',
  'policy_apply',
  'table_sample',
  'row_insert',
  'row_get',
  'row_query',
  'row_update',
  'row_delete',
] as const;

export type AppDataMcpToolName = (typeof APP_DATA_MCP_TOOL_NAMES)[number];

export const APP_DATA_MCP_TOOL_SET = new Set<string>(APP_DATA_MCP_TOOL_NAMES);

export const APP_DATA_MCP_TOOL_DESCRIPTIONS: Record<AppDataMcpToolName, string> = {
  appdata_status: 'Get App Data provisioning and schema status for the bound workspace',
  provision:
    'Provision DEV PostgreSQL schema for persistent app data (idempotent). After success, restart the Vite dev server (yellowruntime_dev_server action=restart) so VITE_YM_* env reaches the Nodepod preview.',
  schema_get: 'Get current DEV schema manifest and version',
  schema_plan: 'Plan typed schema migration without applying',
  schema_apply:
    'Apply typed schema migration to DEV. New tables automatically receive default DEV policies (anonymous + yellowmind_owner CRUD).',
  policy_get: 'Get table policies for DEV',
  policy_apply:
    'Apply table policies for DEV. Format: { "<table>": { "select": ["anonymous","yellowmind_owner"], "insert": [...], "update": [...], "delete": [...] } }. Preview uses principal anonymous; MCP row_* uses yellowmind_owner.',
  table_sample:
    'Sample rows from a DEV table (owner/MCP diagnostic — bypasses policy checks; use row_query to verify policy enforcement)',
  row_insert: 'Insert a row into a DEV table',
  row_get: 'Get rows by equality filters in DEV',
  row_query: 'Query rows with pagination in DEV',
  row_update: 'Update a row in DEV',
  row_delete: 'Delete a row in DEV',
};

/**
 * Shared JSON Schema for the `manifest` argument of schema_plan / schema_apply.
 * Fully described so the model cannot misplace `version` inside `tables` —
 * the shape must be { version, tables: { <name>: { columns: { <col>: {...} } } } }.
 */
const APP_DATA_MANIFEST_ARG = {
  type: 'object',
  description:
    'Declarative schema manifest. Exact shape: {"version": <integer>, "tables": {"<table_name>": {"columns": {"<column_name>": {"type": "text"|"integer"|"boolean"|"timestamptz"|"uuid", "primaryKey"?: true, "nullable"?: true, "unique"?: true, "default"?: <literal>}}}}}. ' +
    'IMPORTANT: "version" belongs at the manifest level only — NEVER place a "version" key inside "tables". ' +
    'Table and column names must match ^[a-z][a-z0-9_]{0,62}$.',
  required: ['version', 'tables'],
  properties: {
    version: {
      type: 'integer',
      description:
        'Manifest version. Must be strictly greater than the current schema version reported by schema_get.',
    },
    tables: {
      type: 'object',
      description:
        'Map of table name to its definition. Every key inside this object is a table name — do NOT put "version" or any metadata here.',
      additionalProperties: {
        type: 'object',
        description: 'One table definition.',
        required: ['columns'],
        properties: {
          columns: {
            type: 'object',
            description:
              'Map of column name to column definition. At least one column; exactly one primaryKey column per table.',
            additionalProperties: {
              type: 'object',
              description: 'One column definition.',
              required: ['type'],
              properties: {
                type: { type: 'string', enum: ['text', 'integer', 'boolean', 'timestamptz', 'uuid'] },
                primaryKey: { type: 'boolean' },
                nullable: { type: 'boolean' },
                unique: { type: 'boolean' },
                default: {
                  description: 'Literal default value (string, number, boolean or null).',
                },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

export const APP_DATA_MCP_TOOL_SCHEMAS: Record<AppDataMcpToolName, Record<string, unknown>> = {
  appdata_status: { type: 'object', properties: {}, additionalProperties: false },
  provision: { type: 'object', properties: {}, additionalProperties: false },
  schema_get: {
    type: 'object',
    properties: { environment: { type: 'string', enum: ['dev'] } },
    additionalProperties: false,
  },
  schema_plan: {
    type: 'object',
    required: ['manifest', 'expectedVersion'],
    properties: {
      manifest: APP_DATA_MANIFEST_ARG,
      expectedVersion: { type: 'integer' },
    },
    additionalProperties: false,
  },
  schema_apply: {
    type: 'object',
    required: ['manifest', 'expectedVersion'],
    properties: {
      manifest: APP_DATA_MANIFEST_ARG,
      expectedVersion: { type: 'integer' },
      confirmDestructive: { type: 'boolean' },
      toolCallId: { type: 'string' },
      manifestHash: { type: 'string' },
    },
    additionalProperties: false,
  },
  policy_get: { type: 'object', properties: {}, additionalProperties: false },
  policy_apply: {
    type: 'object',
    required: ['policies'],
    properties: { policies: { type: 'object' } },
    additionalProperties: false,
  },
  table_sample: {
    type: 'object',
    required: ['table'],
    properties: { table: { type: 'string' }, limit: { type: 'integer' } },
    additionalProperties: false,
  },
  row_insert: {
    type: 'object',
    required: ['table', 'row'],
    properties: { table: { type: 'string' }, row: { type: 'object' } },
    additionalProperties: false,
  },
  row_get: {
    type: 'object',
    required: ['table', 'filters'],
    properties: {
      table: { type: 'string' },
      filters: { type: 'object' },
    },
    additionalProperties: false,
  },
  row_query: {
    type: 'object',
    required: ['table'],
    properties: {
      table: { type: 'string' },
      filters: { type: 'object' },
      orderBy: { type: 'string' },
      orderDir: { type: 'string', enum: ['asc', 'desc'] },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
    additionalProperties: false,
  },
  row_update: {
    type: 'object',
    required: ['table', 'id', 'patch'],
    properties: {
      table: { type: 'string' },
      id: { type: 'string' },
      idColumn: { type: 'string' },
      patch: { type: 'object' },
    },
    additionalProperties: false,
  },
  row_delete: {
    type: 'object',
    required: ['table', 'id'],
    properties: { table: { type: 'string' }, id: { type: 'string' }, idColumn: { type: 'string' } },
    additionalProperties: false,
  },
};
