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
  provision: 'Provision DEV PostgreSQL schema for persistent app data (idempotent)',
  schema_get: 'Get current DEV schema manifest and version',
  schema_plan: 'Plan typed schema migration without applying',
  schema_apply: 'Apply typed schema migration to DEV',
  policy_get: 'Get table policies for DEV',
  policy_apply: 'Apply table policies for DEV',
  table_sample: 'Sample rows from a DEV table (owner/MCP)',
  row_insert: 'Insert a row into a DEV table',
  row_get: 'Get rows by equality filters in DEV',
  row_query: 'Query rows with pagination in DEV',
  row_update: 'Update a row in DEV',
  row_delete: 'Delete a row in DEV',
};

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
      manifest: { type: 'object' },
      expectedVersion: { type: 'integer' },
    },
    additionalProperties: false,
  },
  schema_apply: {
    type: 'object',
    required: ['manifest', 'expectedVersion'],
    properties: {
      manifest: { type: 'object' },
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
