/**
 * Typed error codes for the YellowMind Runtime MCP.
 * Mirror of APImanus `runtime_mcp/errors.py`.
 */

export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export const McpErrorCode = {
  UNSUPPORTED_CAPABILITY: -32001,
  RUNTIME_OFFLINE: -32002,
  REVISION_CONFLICT: -32003,
  CHECKPOINT_FAILED: -32004,
  TOOL_TIMEOUT: -32005,
  TOOL_CANCELLED: -32006,
  PROCESS_FAILED: -32007,
  SECURITY_DENIED: -32008,
  QUOTA_EXCEEDED: -32009,
} as const;

export class McpError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'McpError';
  }

  toJsonRpcError(): { code: number; message: string; data?: unknown } {
    const err: { code: number; message: string; data?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.data !== undefined) {
      err.data = this.data;
    }
    return err;
  }
}

export class InvalidParamsError extends McpError {
  constructor(reason: string, details?: unknown) {
    super(JsonRpcErrorCode.INVALID_PARAMS, `Invalid parameters: ${reason}`, details);
  }
}

export class InvalidToolNameError extends McpError {
  constructor(name: string) {
    super(JsonRpcErrorCode.METHOD_NOT_FOUND, `Unknown tool: ${name}`, { tool: name });
  }
}

export class SecurityDeniedError extends McpError {
  constructor(reason: string, path = '') {
    super(McpErrorCode.SECURITY_DENIED, `Security denied: ${reason}`, { path, reason });
  }
}

export class AuthError extends Error {
  constructor(
    readonly statusCode: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'AuthError';
  }
}
