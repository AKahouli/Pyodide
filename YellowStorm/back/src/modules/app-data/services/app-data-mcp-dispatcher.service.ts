import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { AppRuntimeBinding } from '@modules/app-runtime/schemas/app-runtime-binding.schema';
import {
  AuthError,
  JsonRpcErrorCode,
  McpError,
} from '@modules/app-runtime/mcp/runtime-mcp.errors';
import {
  appDataMcpInitializeResponse,
  jsonrpcErrorResponse,
  jsonrpcInternalError,
  jsonrpcSuccessResponse,
  mcpToolResultResponse,
  parseJsonRpcBody,
  type JsonRpcRequest,
} from '../mcp/app-data-mcp.jsonrpc';
import {
  APP_DATA_MCP_TOOL_DESCRIPTIONS,
  APP_DATA_MCP_TOOL_NAMES,
  APP_DATA_MCP_TOOL_SCHEMAS,
  APP_DATA_MCP_TOOL_SET,
  type AppDataMcpToolName,
} from '../mcp/app-data-mcp.tools';
import type { AppDataSchemaManifest } from '../constants/app-data.types';
import { AppDataException } from '../constants/app-data.errors';
import { normalizeSchemaManifest, validateSeedTables } from '../utils/app-data-sql.util';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataMcpAuthService } from './app-data-mcp-auth.service';
import { AppDataPolicyService } from './app-data-policy.service';
import { AppDataProvisioningService } from './app-data-provisioning.service';
import { AppDataQueryService } from './app-data-query.service';
import { AppDataRowService } from './app-data-row.service';
import { AppDataSchemaService } from './app-data-schema.service';

@Injectable()
export class AppDataMcpDispatcherService {
  private readonly logger = new Logger(AppDataMcpDispatcherService.name);

  constructor(
    private readonly auth: AppDataMcpAuthService,
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly provisioning: AppDataProvisioningService,
    private readonly schema: AppDataSchemaService,
    private readonly policies: AppDataPolicyService,
    private readonly rows: AppDataRowService,
    private readonly query: AppDataQueryService,
  ) {}

  isEnabled(): boolean {
    return (
      this.config.get<boolean>('appData.enabled', false) &&
      this.config.get<boolean>('appData.mcpEnabled', false)
    );
  }

  async handleRequest(
    body: unknown,
    authorization: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (!this.isEnabled()) {
      return jsonrpcInternalError(null, 'App Data MCP is disabled on this host');
    }

    let request: JsonRpcRequest;
    try {
      request = parseJsonRpcBody(body);
    } catch (err) {
      if (err instanceof McpError) return jsonrpcErrorResponse(null, err);
      throw err;
    }

    if (request.isNotification) return {};

    const reqId = request.id;
    if (request.method === 'initialize') {
      return appDataMcpInitializeResponse(reqId);
    }
    if (request.method === 'tools/list') {
      const tools = [...APP_DATA_MCP_TOOL_NAMES].sort().map((name) => ({
        name,
        description: APP_DATA_MCP_TOOL_DESCRIPTIONS[name],
        inputSchema: APP_DATA_MCP_TOOL_SCHEMAS[name],
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
    if (typeof toolName !== 'string' || !APP_DATA_MCP_TOOL_SET.has(toolName)) {
      return jsonrpcErrorResponse(
        reqId,
        new McpError(JsonRpcErrorCode.INVALID_PARAMS, `Unknown tool: ${String(toolName)}`),
      );
    }

    let binding: AppRuntimeBinding;
    try {
      binding = await this.auth.resolveBinding(authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return { jsonrpc: '2.0', id: reqId, error: { code: err.statusCode, message: err.detail } };
      }
      throw err;
    }

    const args =
      params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};

    this.rejectAuthorityArgs(args);

    const tool = toolName as AppDataMcpToolName;
    const toolCallId =
      typeof params.toolCallId === 'string' && params.toolCallId
        ? params.toolCallId
        : `tc_${randomBytes(6).toString('hex')}`;

    try {
      const result = await this.dispatchTool(tool, args, binding, toolCallId);
      return mcpToolResultResponse(reqId, JSON.stringify(result), result);
    } catch (err) {
      if (err instanceof AppDataException) {
        return jsonrpcErrorResponse(
          reqId,
          new McpError(JsonRpcErrorCode.INVALID_PARAMS, err.message, {
            code: err.appDataCode,
            ...err.data,
          }),
        );
      }
      if (err instanceof McpError) return jsonrpcErrorResponse(reqId, err);
      this.logger.error(`App Data MCP tool failed tool=${tool}`, err instanceof Error ? err.stack : String(err));
      return jsonrpcInternalError(reqId, err instanceof Error ? err.message : 'Internal error');
    }
  }

  private rejectAuthorityArgs(args: Record<string, unknown>): void {
    for (const key of ['workspaceId', 'appDataId', 'sql', 'query']) {
      if (key in args) {
        throw new McpError(
          JsonRpcErrorCode.INVALID_PARAMS,
          `Authority argument "${key}" is not allowed — workspace is derived from MCP token`,
        );
      }
    }
  }

  private async dispatchTool(
    tool: AppDataMcpToolName,
    args: Record<string, unknown>,
    binding: AppRuntimeBinding,
    toolCallId: string,
  ): Promise<Record<string, unknown>> {
    const workspaceId = binding.workspaceId;
    const ownerUserId = binding.userId;
    const principal = 'yellowmind_owner' as const;

    switch (tool) {
      case 'appdata_status':
        return { status: await this.catalog.getStatus(workspaceId) };
      case 'provision': {
        const result = await this.provisioning.provisionDev({
          workspaceId,
          ownerUserId,
          actorPrincipal: 'mcp',
        });
        return {
          ...result,
          devServerHint:
            'Call yellowruntime_dev_server with action "restart" so VITE_YM_APP_DATA_* env is injected into the Nodepod preview (skips login gate in dev).',
        };
      }
      case 'schema_get':
        return this.schema.getSchema(workspaceId, 'dev');
      case 'schema_plan': {
        const planned = normalizeSchemaManifest(args.manifest as AppDataSchemaManifest);
        return this.schema.planSchema({
          workspaceId,
          environment: 'dev',
          manifest: planned.manifest,
          expectedVersion: Number(args.expectedVersion),
        });
      }
      case 'schema_apply': {
        const applied = normalizeSchemaManifest(args.manifest as AppDataSchemaManifest);
        return this.schema.applySchema({
          workspaceId,
          environment: 'dev',
          manifest: applied.manifest,
          expectedVersion: Number(args.expectedVersion),
          confirmDestructive: args.confirmDestructive === true,
          toolCallId,
          actorPrincipal: 'mcp',
        });
      }
      case 'policy_get':
        return { policies: await this.policies.getPolicies(workspaceId, 'dev') };
      case 'policy_apply':
        return {
          policies: await this.policies.applyPolicies({
            workspaceId,
            environment: 'dev',
            policies: args.policies as import('../constants/app-data.types').AppDataPolicyDocument,
            actorPrincipal: 'mcp',
            expectedVersion: args.expectedVersion != null ? Number(args.expectedVersion) : undefined,
          }),
        };
      case 'table_sample':
        return {
          rows: await this.rows.sampleTable({
            workspaceId,
            table: String(args.table),
            limit: args.limit != null ? Number(args.limit) : undefined,
          }),
        };
      case 'row_insert': {
        const app = await this.catalog.requireAppByWorkspace(workspaceId);
        return {
          row: await this.rows.insertRow({
            appDataId: app.appDataId,
            environment: 'dev',
            table: String(args.table),
            row: args.row as Record<string, unknown>,
            principal,
            ownerUserId,
          }),
        };
      }
      case 'row_get':
      case 'row_query': {
        const app = await this.catalog.requireAppByWorkspace(workspaceId);
        const filters = (args.filters ?? (tool === 'row_get' ? args : {})) as Record<string, unknown>;
        return this.query.listRows({
          appDataId: app.appDataId,
          environment: 'dev',
          table: String(args.table),
          filters: filters as import('./app-data-query.service').RowQueryFilter,
          orderBy: args.orderBy != null ? String(args.orderBy) : undefined,
          orderDir: args.orderDir === 'desc' ? 'desc' : 'asc',
          page: args.page != null ? Number(args.page) : 1,
          pageSize: args.pageSize != null ? Number(args.pageSize) : undefined,
          principal,
          ownerUserId,
        });
      }
      case 'row_update': {
        const app = await this.catalog.requireAppByWorkspace(workspaceId);
        return {
          row: await this.rows.updateRow({
            appDataId: app.appDataId,
            environment: 'dev',
            table: String(args.table),
            id: String(args.id),
            idColumn: args.idColumn != null ? String(args.idColumn) : undefined,
            patch: args.patch as Record<string, unknown>,
            principal,
            ownerUserId,
          }),
        };
      }
      case 'row_delete': {
        const app = await this.catalog.requireAppByWorkspace(workspaceId);
        return {
          row: await this.rows.deleteRow({
            appDataId: app.appDataId,
            environment: 'dev',
            table: String(args.table),
            id: String(args.id),
            idColumn: args.idColumn != null ? String(args.idColumn) : undefined,
            principal,
            ownerUserId,
          }),
        };
      }
      case 'seed': {
        const app = await this.catalog.requireAppByWorkspace(workspaceId);
        const tables = validateSeedTables(args.tables);
        const results: { table: string; inserted: number; skipped: number }[] = [];
        let insertedTotal = 0;
        let skippedTotal = 0;
        for (const { name: tableName, rows: tableRows } of tables) {
          if (tableRows.length === 0) continue;
          const batchResult = await this.rows.batchInsert({
            appDataId: app.appDataId,
            environment: 'dev',
            table: tableName,
            rows: tableRows,
            principal,
            ownerUserId,
          });
          results.push({ table: tableName, inserted: batchResult.inserted, skipped: batchResult.skipped });
          insertedTotal += batchResult.inserted;
          skippedTotal += batchResult.skipped;
        }
        return {
          environment: 'dev',
          message: `Seeded ${insertedTotal} row${insertedTotal === 1 ? '' : 's'}`,
          total: insertedTotal + skippedTotal,
          inserted: insertedTotal,
          skipped: skippedTotal,
          tables: results,
        };
      }
      default:
        throw new McpError(JsonRpcErrorCode.METHOD_NOT_FOUND, `Unhandled tool: ${tool}`);
    }
  }
}
