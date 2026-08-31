import {
  jsonrpcSuccessResponse,
  mcpInitializeResponse,
  parseJsonRpcBody,
  jsonrpcErrorResponse,
  jsonrpcInternalError,
  mcpToolResultResponse,
  MCP_PROTOCOL_VERSION,
  type JsonRpcRequest,
} from '@modules/app-runtime/mcp/runtime-mcp.jsonrpc';

export {
  JsonRpcErrorCode,
  McpError,
  AuthError,
} from '@modules/app-runtime/mcp/runtime-mcp.errors';

export {
  parseJsonRpcBody,
  jsonrpcSuccessResponse,
  jsonrpcErrorResponse,
  jsonrpcInternalError,
  mcpToolResultResponse,
  MCP_PROTOCOL_VERSION,
  type JsonRpcRequest,
};

export const APP_DATA_MCP_SERVER_NAME = 'yellowmind-app-data';
export const APP_DATA_MCP_SERVER_VERSION = '0.1.0';

export function appDataMcpInitializeResponse(requestId: unknown): Record<string, unknown> {
  const base = mcpInitializeResponse(requestId) as { result: Record<string, unknown> };
  return jsonrpcSuccessResponse(requestId, {
    ...base.result,
    serverInfo: {
      name: APP_DATA_MCP_SERVER_NAME,
      version: APP_DATA_MCP_SERVER_VERSION,
    },
  });
}
