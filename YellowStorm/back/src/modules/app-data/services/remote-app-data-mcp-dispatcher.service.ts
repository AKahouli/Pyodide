import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { AppRuntimeBinding } from '@modules/app-runtime/schemas/app-runtime-binding.schema';
import {
  AuthError,
  JsonRpcErrorCode,
  McpErrorCode,
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
import type {
  AppDataSchemaManifest,
  AppDataStatus,
} from '../constants/app-data.types';
import { AppDataErrorCode, AppDataException } from '../constants/app-data.errors';
import { AppDataClientService } from './app-data-client.service';
import { AppDataMcpAuthService } from './app-data-mcp-auth.service';
import {
  normalizeSchemaManifest,
  safeSqlDefault,
  validateSeedTables,
} from '../utils/app-data-sql.util';

/**
 * Remote implementation of the AppDataMcpDispatcherService contract.
 *
 * Tool calls are served from the app-data microservice over its
 * service-token-gated internal API. Authority arguments (workspaceId,
 * appDataId, sql, query) stay rejected; the workspace is always derived
 * from the MCP token binding.
 *
 * Transitional limitations (microservice tracks no manifest versions):
 * schema_get / schema_plan / policy_get / policy_apply return a
 * NOT_SUPPORTED_REMOTE JSON-RPC error.
 */
/**
 * Tools advertised to the agent in remote mode. The remaining names
 * (schema_get/plan handled below, policy_*) either need manifest-version
 * tracking or policy documents the microservice does not keep — advertising
 * them only produced confusing call-time errors.
 */
const REMOTE_SUPPORTED_TOOLS: ReadonlySet<string> = new Set([
  'appdata_status',
  'provision',
  'schema_apply',
  'schema_get',
  'table_sample',
  'row_insert',
  'row_get',
  'row_query',
  'row_update',
  'row_delete',
  'seed',
]);

@Injectable()
export class RemoteAppDataMcpDispatcherService {
  private readonly logger = new Logger(RemoteAppDataMcpDispatcherService.name);
  constructor(
    private readonly auth: AppDataMcpAuthService,
    private readonly config: ConfigService,
    private readonly client: AppDataClientService,
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
      const tools = [...APP_DATA_MCP_TOOL_NAMES]
        .filter((name) => REMOTE_SUPPORTED_TOOLS.has(name))
        .sort()
        .map((name) => ({
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
      const result = await this.dispatchTool(tool, args, binding);
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
      this.logger.error(
        `Remote App Data MCP tool failed tool=${tool}`,
        err instanceof Error ? err.stack : String(err),
      );
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

  private async requireRemoteApp(binding: AppRuntimeBinding): Promise<{ id: string }> {
    const app = await this.client.getAppByWorkspace(binding.workspaceId);
    if (!app) {
      throw new AppDataException(
        AppDataErrorCode.NOT_PROVISIONED,
        `No app data registered for workspace ${binding.workspaceId} in the app-data service`,
      );
    }
    return app;
  }

  private async dispatchTool(
    tool: AppDataMcpToolName,
    args: Record<string, unknown>,
    binding: AppRuntimeBinding,
  ): Promise<Record<string, unknown>> {
    const ownerUserId = binding.userId;

    switch (tool) {
      case 'appdata_status':
        return this.remoteStatus(binding);
      case 'provision': {
        // Attribute the app to the YellowStorm owner (preview data tickets
        // resolve against apps.owner_user_id).
        const ensured = await this.client.ensureApp(binding.workspaceId, undefined, binding.userId);
        const provisioned = await this.client.provision(ensured.id, 'dev');
        return {
          provisioned: true,
          appDataId: ensured.id,
          database: provisioned.database,
          devServerHint:
            'Call yellowruntime_dev_server with action "restart" so VITE_YM_APP_DATA_* env is injected into the Nodepod preview (skips login gate in dev).',
        };
      }
      case 'schema_get': {
        // Remote mode tracks no manifest versions — return the live table
        // list instead, and steer the model straight to schema_apply.
        const app = await this.requireRemoteApp(binding);
        const tables = await this.client.listTables(app.id, 'dev');
        return {
          environment: 'dev',
          tables,
          note: 'Column-level introspection is not tracked remotely. Call schema_apply directly — reserved columns (id, owner_id, created_at, updated_at) are filtered automatically and never need to be declared.',
        };
      }
      case 'schema_plan':
      case 'policy_get':
      case 'policy_apply':
        throw new McpError(
          McpErrorCode.UNSUPPORTED_CAPABILITY,
          `Tool "${tool}" is not available in remote mode — call schema_apply directly (no planning or policy documents are tracked)`,
        );
      case 'schema_apply': {
        const app = await this.requireRemoteApp(binding);
        const rawManifest = args.manifest as AppDataSchemaManifest | undefined;
        if (!rawManifest || typeof rawManifest !== 'object' || !rawManifest.tables) {
          throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, 'schema_apply requires a manifest with tables');
        }
        const { manifest: normalized, warnings: normalizeWarnings } = normalizeSchemaManifest(rawManifest);
        const { tables, warnings: mapWarnings } = this.mapManifestTables(normalized);
        const applied = await this.client.applySchema(app.id, 'dev', tables);
        const warnings = [...normalizeWarnings, ...mapWarnings];
        return warnings.length > 0
          ? { applied: true, message: applied.message, tables: applied.tables, warnings }
          : { applied: true, message: applied.message, tables: applied.tables };
      }
      case 'table_sample': {
        const app = await this.requireRemoteApp(binding);
        const limit = args.limit != null ? Math.min(Math.max(Number(args.limit) || 20, 1), 200) : 20;
        return {
          rows: await this.client.listOwnerRows(app.id, 'dev', String(args.table), {
            page: '1',
            pageSize: String(limit),
          }).then((r) => r.rows),
        };
      }
      case 'row_insert': {
        const app = await this.requireRemoteApp(binding);
        return {
          row: await this.client.insertOwnerRow(
            app.id,
            'dev',
            String(args.table),
            (args.row ?? {}) as Record<string, unknown>,
            ownerUserId,
          ),
        };
      }
      case 'row_get':
      case 'row_query': {
        const app = await this.requireRemoteApp(binding);
        const filters = (args.filters ?? (tool === 'row_get' ? args : {})) as Record<
          string,
          unknown
        >;
        const query: Record<string, string> = {
          page: args.page != null ? String(Number(args.page) || 1) : '1',
        };
        if (args.pageSize != null) query.pageSize = String(Number(args.pageSize) || 20);
        for (const [key, value] of Object.entries(filters)) {
          if (value !== undefined && value !== null && typeof value !== 'object') {
            query[key] = String(value);
          }
        }
        return this.client.listOwnerRows(app.id, 'dev', String(args.table), query);
      }
      case 'row_update': {
        const app = await this.requireRemoteApp(binding);
        return {
          row: await this.client.updateOwnerRow(
            app.id,
            'dev',
            String(args.table),
            String(args.id),
            (args.patch ?? {}) as Record<string, unknown>,
          ),
        };
      }
      case 'row_delete': {
        const app = await this.requireRemoteApp(binding);
        return {
          row: await this.client.deleteOwnerRow(
            app.id,
            'dev',
            String(args.table),
            String(args.id),
          ).then((deleted) => ({ deleted })),
        };
      }
      case 'seed': {
        const app = await this.requireRemoteApp(binding);
        const tables = validateSeedTables(args.tables);
        const seeded = await this.client.seedRows(app.id, 'dev', tables, ownerUserId);
        return {
          environment: 'dev',
          message: `Seeded ${seeded.inserted} row${seeded.inserted === 1 ? '' : 's'}`,
          ...seeded,
        };
      }
      default:
        throw new McpError(JsonRpcErrorCode.METHOD_NOT_FOUND, `Unhandled tool: ${tool}`);
    }
  }

  private async remoteStatus(binding: AppRuntimeBinding): Promise<{ status: AppDataStatus }> {
    const app = await this.client.getAppByWorkspace(binding.workspaceId);
    if (!app) {
      return {
        status: {
          enabled: true,
          appDataId: null,
          workspaceId: binding.workspaceId,
          lifecycleState: null,
          endUserAuthEnabled: false,
          dev: { provisioned: false, schemaName: null, currentVersion: null },
          prod: { provisioned: false, schemaName: null, currentVersion: null },
        },
      };
    }
    const remote = await this.client.getStatus(app.id);
    const envRow = (env: string) =>
      (remote.environments ?? []).find(
        (e) => (e as { env?: string }).env === env || (e as { environment?: string }).environment === env,
      );
    const dev = envRow('dev') as { provisioned_at?: string | null } | undefined;
    const prod = envRow('prod') as { provisioned_at?: string | null } | undefined;
    return {
      status: {
        enabled: true,
        appDataId: app.id,
        workspaceId: binding.workspaceId,
        lifecycleState: 'active',
        endUserAuthEnabled: true,
        dev: { provisioned: !!dev?.provisioned_at, schemaName: null, currentVersion: null },
        prod: { provisioned: !!prod?.provisioned_at, schemaName: null, currentVersion: null },
      },
    };
  }

  private mapManifestTables(
    manifest: AppDataSchemaManifest,
  ): { tables: Array<Record<string, unknown>>; warnings: string[] } {
    const warnings: string[] = [];
    const tables = Object.entries(manifest.tables).map(([tableName, def]) => ({
      name: tableName,
      columns: Object.entries(def.columns ?? {}).map(([columnName, columnDef]) => {
        const mapped: Record<string, unknown> = {
          name: columnName,
          type: String(columnDef.type),
          nullable: columnDef.nullable === true,
        };
        if (columnDef.default !== undefined && columnDef.default !== null) {
          // Only literal-safe values and a fixed function allowlist survive:
          // the microservice inlines DEFAULT into SQL, and a bare identifier
          // (e.g. "now") becomes a column reference there (PG error 0A000).
          const safe = safeSqlDefault(columnDef.default);
          if (safe !== null) {
            mapped.default = safe;
          } else {
            warnings.push(
              `Column ${tableName}.${columnName}: DEFAULT ${JSON.stringify(
                columnDef.default,
              )} ignored — supported: literals, now(), current_timestamp, gen_random_uuid(), uuid_generate_v4()`,
            );
          }
        }
        return mapped;
      }),
    }));
    return { tables, warnings };
  }
}
