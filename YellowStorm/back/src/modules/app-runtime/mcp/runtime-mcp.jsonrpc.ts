import {
  JsonRpcErrorCode,
  McpError,
} from './runtime-mcp.errors';

export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_SERVER_NAME = 'yellowmind-runtime';
export const MCP_SERVER_VERSION = '0.3.0';

export interface JsonRpcRequest {
  id: unknown;
  method: string;
  params?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  isNotification: boolean;
}

export function parseJsonRpcBody(body: unknown): JsonRpcRequest {
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new McpError(JsonRpcErrorCode.PARSE_ERROR, 'Parse error');
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new McpError(JsonRpcErrorCode.INVALID_REQUEST, 'Request must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  if (record.jsonrpc !== '2.0') {
    throw new McpError(
      JsonRpcErrorCode.INVALID_REQUEST,
      `Unsupported jsonrpc version: ${String(record.jsonrpc)}`,
    );
  }

  const method = record.method;
  if (typeof method !== 'string' || !method) {
    throw new McpError(JsonRpcErrorCode.INVALID_REQUEST, "Missing or invalid 'method' field");
  }

  const params = record.params;
  if (params !== undefined && params !== null && typeof params !== 'object') {
    throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "'params' must be an object");
  }

  const id = record.id;
  return {
    id: id ?? null,
    method,
    params: (params as Record<string, unknown> | undefined) ?? undefined,
    raw: record,
    isNotification: id === undefined || id === null,
  };
}

export function jsonrpcSuccessResponse(
  requestId: unknown,
  result: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: requestId,
    result,
  };
}

export function jsonrpcErrorResponse(
  requestId: unknown,
  error: McpError,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: requestId,
    error: error.toJsonRpcError(),
  };
}

export function jsonrpcInternalError(
  requestId: unknown,
  message = 'Internal error',
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: requestId,
    error: {
      code: JsonRpcErrorCode.INTERNAL_ERROR,
      message,
    },
  };
}

export function mcpInitializeResponse(requestId: unknown): Record<string, unknown> {
  return jsonrpcSuccessResponse(requestId, {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
  });
}

export function mcpToolResultResponse(
  requestId: unknown,
  contentText: string,
  structured?: Record<string, unknown>,
  isError = false,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    content: [{ type: 'text', text: contentText }],
  };
  if (structured !== undefined) {
    result.structuredContent = structured;
  }
  if (isError) {
    result.isError = true;
  }
  return jsonrpcSuccessResponse(requestId, result);
}
