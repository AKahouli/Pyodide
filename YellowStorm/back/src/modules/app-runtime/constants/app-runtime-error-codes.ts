/**
 * Mirror of `McpErrorCode` in APImanus
 * (`app/infrastructure/opencode/runtime_mcp/errors.py`). The internal
 * tool-invoke endpoint returns these numbers verbatim so the browser runtime
 * adapter can rebuild an `McpError` without translating HTTP statuses.
 */
export const AppRuntimeErrorCodes = {
  UNSUPPORTED_CAPABILITY: -32001,
  RUNTIME_OFFLINE: -32002,
  REVISION_CONFLICT: -32003,
  TOOL_TIMEOUT: -32005,
  TOOL_CANCELLED: -32006,
  PROCESS_FAILED: -32007,
  INTERNAL_ERROR: -32603,
} as const;

export type AppRuntimeErrorCode =
  (typeof AppRuntimeErrorCodes)[keyof typeof AppRuntimeErrorCodes];
