import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthError,
  InvalidToolNameError,
  JsonRpcErrorCode,
  McpError,
} from '../mcp/runtime-mcp.errors';
import {
  jsonrpcErrorResponse,
  jsonrpcInternalError,
  jsonrpcSuccessResponse,
  mcpInitializeResponse,
  mcpToolResultResponse,
  parseJsonRpcBody,
  type JsonRpcRequest,
} from '../mcp/runtime-mcp.jsonrpc';
import {
  TOOL_DESCRIPTIONS,
  TOOL_INPUT_SCHEMAS,
  TOOL_NAMES,
} from '../mcp/runtime-mcp.tools';
import { RuntimeBrokerService } from '../services/runtime-broker.service';
import { RuntimeMcpAuthService } from '../services/runtime-mcp-auth.service';

@Injectable()
export class RuntimeMcpDispatcherService {
  private readonly logger = new Logger(RuntimeMcpDispatcherService.name);

  constructor(
    private readonly auth: RuntimeMcpAuthService,
    private readonly broker: RuntimeBrokerService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<boolean>('appRuntime.mcpEnabled', true);
  }

  async handleRequest(
    body: unknown,
    authorization: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (!this.isEnabled()) {
      return jsonrpcInternalError(null, 'Runtime MCP is disabled on this host');
    }

    let request: JsonRpcRequest;
    try {
      request = parseJsonRpcBody(body);
    } catch (err) {
      if (err instanceof McpError) {
        return jsonrpcErrorResponse(null, err);
      }
      throw err;
    }

    if (request.isNotification) {
      if (request.method === 'notifications/initialized') {
        this.logger.debug('Runtime MCP client initialized');
      }
      return {};
    }

    const reqId = request.id;

    if (request.method === 'initialize') {
      this.logger.log('Runtime MCP initialize');
      return mcpInitializeResponse(reqId);
    }

    if (request.method === 'tools/list') {
      const tools = [...TOOL_NAMES]
        .sort()
        .map((name) => ({
          name,
          description: TOOL_DESCRIPTIONS[name],
          inputSchema: TOOL_INPUT_SCHEMAS[name],
        }));
      return jsonrpcSuccessResponse(reqId, { tools });
    }

    if (request.method === 'tools/call') {
      return this.handleToolsCall(request, authorization);
    }

    return jsonrpcErrorResponse(
      reqId,
      new McpError(JsonRpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${request.method}`),
    );
  }

  private async handleToolsCall(
    request: JsonRpcRequest,
    authorization: string | undefined,
  ): Promise<Record<string, unknown>> {
    const reqId = request.id;
    const params = request.params ?? {};
    const toolName = params.name;
    const argumentsRaw = params.arguments;

    if (typeof toolName !== 'string') {
      return jsonrpcErrorResponse(
        reqId,
        new McpError(JsonRpcErrorCode.INVALID_PARAMS, 'tools/call requires params.name'),
      );
    }

    let binding;
    try {
      binding = await this.auth.resolveBinding(authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return {
          jsonrpc: '2.0',
          id: reqId,
          error: { code: err.statusCode, message: err.detail },
        };
      }
      throw err;
    }

    const toolCallId =
      typeof params.toolCallId === 'string' && params.toolCallId
        ? params.toolCallId
        : RuntimeBrokerService.newToolCallId();

    const args =
      argumentsRaw && typeof argumentsRaw === 'object' && !Array.isArray(argumentsRaw)
        ? (argumentsRaw as Record<string, unknown>)
        : {};

    this.logger.log(
      `MCP tool_call bindingId=${binding.bindingId} workspaceId=${binding.workspaceId} tool=${toolName} toolCallId=${toolCallId}`,
    );

    try {
      const outcome = await this.broker.dispatch(toolName, args, binding, toolCallId);
      if (outcome.error) {
        return jsonrpcErrorResponse(
          reqId,
          new McpError(outcome.error.code, outcome.error.message, outcome.error.data),
        );
      }
      const structured = outcome.result ?? {};
      return mcpToolResultResponse(reqId, JSON.stringify(structured), structured);
    } catch (err) {
      if (err instanceof InvalidToolNameError || err instanceof McpError) {
        return jsonrpcErrorResponse(reqId, err);
      }
      this.logger.error(
        `MCP tool_call failed bindingId=${binding.bindingId} tool=${toolName}`,
        err instanceof Error ? err.stack : String(err),
      );
      return jsonrpcInternalError(reqId, err instanceof Error ? err.message : 'Internal error');
    }
  }
}
