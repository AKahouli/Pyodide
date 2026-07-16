import { Inject, Injectable } from '@nestjs/common';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import { ConnectorService } from '../connector.service';
import type { ConnectorAuthService } from '../interfaces/connector-auth.interface';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';

const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const SENSITIVE_HEADER_PATTERN = /authorization|api[-_]?key|token|secret|cookie/i;

export interface ConnectorMcpToolCallInput {
  connectorId: string;
  workspaceId: string;
  authorizationUserId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  allowedTools: readonly string[];
  authoritativeHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export interface ConnectorMcpToolCallResult {
  value: unknown;
  text: string;
}

@Injectable()
export class ConnectorMcpRuntimeService {
  constructor(
    private readonly connectors: ConnectorService,
    @Inject('ConnectorAuthService') private readonly auth: ConnectorAuthService,
    private readonly logger: LoggerService,
    private readonly workspaceShares: WorkspaceShareService,
  ) {
    this.logger.setContext(ConnectorMcpRuntimeService.name);
  }

  async callTool(input: ConnectorMcpToolCallInput): Promise<ConnectorMcpToolCallResult> {
    if (!input.allowedTools.includes(input.toolName)) {
      throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'The requested MCP tool is not allowlisted for evidence retrieval.');
    }

    const connector = await this.connectors.findById(input.connectorId);
    if (!connector.isActive) {
      throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'The selected evidence-search connector is inactive.');
    }
    if (!['streamable_http', 'sse'].includes(connector.mcpTransportType)) {
      throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'Evidence retrieval only supports HTTP MCP transports.');
    }

    const configuredAction = connector.actions.find((action) => action.key === input.toolName);
    if (!configuredAction || configuredAction.isEnabled === false || configuredAction.safety !== 'read') {
      throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'The selected connector does not allow this read operation.');
    }

    await this.workspaceShares.assertUserHasAccess(input.authorizationUserId, [input.workspaceId]);
    const credentialOwnerUserId = connector.createdBy.toString();
    const resolvedAuth = await this.auth.resolveRuntimeAuth(credentialOwnerUserId, {
      authSourceType: connector.authSourceType,
      connectedAppKey: connector.connectedAppKey,
      runtimeAuthConfig: connector.runtimeAuthConfig ?? {},
      connectorId: connector.id,
    });
    if (connector.authSourceType !== 'none' && Object.keys(resolvedAuth.headers).length === 0) {
      throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'The selected connector has no usable background credential.');
    }

    const dynamicHeaders = await this.auth.resolveDynamicHeaders(credentialOwnerUserId, connector.dynamicHeaders ?? []);
    const headers = {
      ...this.safeConfiguredHeaders(connector.mcpServerConfig),
      ...resolvedAuth.headers,
      ...dynamicHeaders,
      ...(input.authoritativeHeaders ?? {}),
    };
    const transport = await this.createTransport(connector.mcpTransportType, connector.mcpServerUrl, headers);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const client = new Client({ name: 'yellowstorm-evidence-search', version: '1.0.0' });

    try {
      const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      await client.connect(transport, { timeout });
      const tools = await client.listTools(undefined, { timeout });
      if (!tools.tools.some((tool) => tool.name === input.toolName)) {
        throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, `The selected connector does not expose the ${input.toolName} tool.`);
      }
      const result = await client.callTool(
        { name: input.toolName, arguments: input.arguments },
        undefined,
        { timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      );
      if (result.isError === true) {
        throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, `The ${input.toolName} evidence-search call failed.`);
      }
      if (!('content' in result)) {
        throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'The evidence-search connector returned an unsupported task response.');
      }
      return this.parseResult(result as { structuredContent?: unknown; content?: unknown[] });
    } catch (error) {
      this.logger.warn('MCP evidence tool call failed', {
        connectorId: connector.id,
        toolName: input.toolName,
        error: error instanceof Error ? error.message : 'Unknown MCP error',
      });
      throw error;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async createTransport(transportType: string, serverUrl: string, headers: Record<string, string>): Promise<Transport> {
    const requestInit: RequestInit = { headers };
    if (transportType === 'sse') {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      return new SSEClientTransport(new URL(serverUrl), { requestInit });
    }
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    return new StreamableHTTPClientTransport(new URL(serverUrl), { requestInit });
  }

  private safeConfiguredHeaders(config: Record<string, unknown>): Record<string, string> {
    const raw = config.headers;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string>>((headers, [name, value]) => {
      if (!SENSITIVE_HEADER_PATTERN.test(name) && typeof value === 'string' && value.trim()) headers[name] = value;
      return headers;
    }, {});
  }

  private parseResult(result: { structuredContent?: unknown; content?: unknown[] }): ConnectorMcpToolCallResult {
    const text = (result.content ?? [])
      .filter((item): item is { type: 'text'; text: string } => this.isTextContent(item))
      .map((item) => item.text)
      .join('\n');
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'The evidence-search response exceeded the allowed size.');
    }
    if (result.structuredContent !== undefined) {
      let structuredSize = 0;
      try { structuredSize = Buffer.byteLength(JSON.stringify(result.structuredContent), 'utf8'); } catch { throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'The evidence-search response could not be safely serialized.'); }
      if (structuredSize > MAX_RESPONSE_BYTES) throw new BadRequestException(ErrorCode.EXTERNAL_SERVICE_ERROR, 'The evidence-search response exceeded the allowed size.');
      return { value: result.structuredContent, text };
    }
    if (!text.trim()) return { value: null, text: '' };
    try {
      return { value: JSON.parse(text) as unknown, text };
    } catch {
      return { value: text, text };
    }
  }

  private isTextContent(value: unknown): value is { type: 'text'; text: string } {
    return typeof value === 'object' && value !== null && 'type' in value && 'text' in value
      && value.type === 'text' && typeof value.text === 'string';
  }
}
