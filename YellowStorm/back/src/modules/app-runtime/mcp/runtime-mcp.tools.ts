/**
 * Runtime MCP tool registry — mirrors APImanus `runtime_mcp/schemas.py`.
 */

export const TOOL_NAMES = [
  'list',
  'read',
  'search',
  'write',
  'apply_patch',
  'delete',
  'diff',
  'run',
  'dev_server',
  'preview_inspect',
  'preview_action',
  'finalize',
] as const;

export type RuntimeMcpToolName = (typeof TOOL_NAMES)[number];

export const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

export const TOOL_DESCRIPTIONS: Record<RuntimeMcpToolName, string> = {
  list: 'List files and directories in the remote workspace',
  read: 'Read file content from the remote workspace with SHA-256 hash',
  search: 'Search for a text pattern across workspace files',
  write: 'Write or create a file in the remote workspace (commits a revision)',
  apply_patch:
    'Apply a unified diff to a workspace file (commits a revision). Context lines must match; use write to replace a whole file.',
  delete: 'Delete a file from the remote workspace (commits a revision)',
  diff: 'Show differences between revisions or current state',
  run:
    'Spawn a binary with arguments in the remote runtime. Not a shell: quotes group one argument; `&&` and `;` chain steps; pipes, redirections, substitutions, globs, and background `&` are rejected. Do not start a long-lived dev server — use `dev_server`.',
  dev_server:
    'Report or restart the managed preview (Vite). The preview is a virtual URL served by the browser runtime, not localhost:5173.',
  preview_inspect: 'Inspect the rendered preview: visible text, DOM, console, errors',
  preview_action: 'Interact with the preview: reload, click, input, scroll',
  finalize: 'Finalize a revision as the completed application with verification evidence',
};

/** JSON Schema fragments for tools/list (OpenCode MCP). */
export const TOOL_INPUT_SCHEMAS: Record<RuntimeMcpToolName, Record<string, unknown>> = {
  list: {
    type: 'object',
    properties: {
      path: { type: 'string', default: '.' },
      depth: { type: 'integer', minimum: 1, maximum: 10, default: 2 },
    },
  },
  read: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 },
    },
  },
  search: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1 },
      path: { type: 'string' },
      maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
  },
  write: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', minLength: 1 },
      content: { type: 'string' },
      expectedSha256: { type: 'string' },
      create: { type: 'boolean', default: false },
    },
  },
  apply_patch: {
    type: 'object',
    required: ['path', 'expectedSha256', 'patch'],
    properties: {
      path: { type: 'string', minLength: 1 },
      expectedSha256: { type: 'string', minLength: 1 },
      patch: { type: 'string', minLength: 1 },
    },
  },
  delete: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', minLength: 1 },
      expectedSha256: { type: 'string' },
    },
  },
  diff: {
    type: 'object',
    properties: {
      revisionId: { type: 'string' },
      path: { type: 'string' },
    },
  },
  run: {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'string', minLength: 1 },
      cwd: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, default: 180000 },
    },
  },
  dev_server: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'restart'], default: 'status' },
    },
  },
  preview_inspect: {
    type: 'object',
    properties: {
      url: { type: 'string' },
    },
  },
  preview_action: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['reload', 'click', 'input', 'press_key', 'select', 'scroll'],
      },
      selector: { type: 'string' },
      value: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
    },
  },
  finalize: {
    type: 'object',
    required: ['title'],
    properties: {
      revisionId: { type: 'string' },
      title: { type: 'string', minLength: 1 },
      verification: {
        type: 'object',
        properties: {
          build: { type: 'string' },
          preview: { type: 'string' },
          tests: { type: 'string' },
        },
      },
    },
  },
};

export const MUTATING_BROKER_TOOLS = new Set<string>(['write', 'apply_patch', 'delete']);
