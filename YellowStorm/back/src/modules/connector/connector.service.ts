import { DEFAULT_WORKER_POLICY, isPlatformOrchestration } from './utils/connector-worker-policy';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import {
  SandboxRuntimeContext,
  CODE_INTERPRETER_CONNECTOR_SLUG,
  buildSandboxScopeHeaders,
} from '../../common/runtime/sandbox-scope';
import { BadRequestException, ConflictException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { CreateConnectorDto, QueryConnectorDto, UpdateConnectorDto } from './dto';
import { PublicConnectorDto } from './dto/public-connector.dto';
import { RuntimeConnectorDefinition } from './interfaces/connector-runtime.interface';
import {
  assertNoUrlCredentials,
  isRemoteInspectableMcpTransport,
  sanitizeEndpointUrl,
} from './utils/remote-mcp-transport.util';
import { assertMcpDestinationAllowed, McpDestinationPolicyError, McpDestinationPolicyOptions } from './utils/mcp-destination-policy.util';
import { ConnectorAction, ConnectorDynamicHeader, ConnectorActionResultKind, ConnectorCitationMode, DynamicHeaderSource } from './connector.types';
import {
  type ConnectorRow,
} from './persistence/connector.store';
import {
  IMcpInspectResult,
  IGrpcConnector,
} from './interfaces/connector.interface';
import { ConnectorAuthService } from './interfaces/connector-auth.interface';
import { ConnectedAppTokenService } from '../connected-app/services/connected-app-token.service';
import { ConnectorPlaybookBindingSyncService } from './services/connector-playbook-binding-sync.service';
import { RESERVED_SYSTEM_OWNER_ID } from '../agent/constants/platform-copilot.constants';
import { PgConnectorCategoryStore } from './persistence/pg-connector.store';
import { PgConnectorStore } from './persistence/pg-connector.store';
import { SemanticModelMcpJwtService } from './services/semantic-model-mcp-jwt.service';

/**
 * What an MCP tool may do, from its annotations: read-only, destructive or another change. A server that
 * declares nothing keeps 'read', as before annotations were read.
 */
export function mcpToolSafety(annotations: unknown): 'read' | 'write' | 'delete' {
  const hints = (annotations && typeof annotations === 'object' ? annotations : {}) as { readOnlyHint?: unknown; destructiveHint?: unknown };
  if (hints.readOnlyHint === true) return 'read';
  if (hints.destructiveHint === true) return 'delete';
  return hints.readOnlyHint === false ? 'write' : 'read';
}

@Injectable()
export class ConnectorService {
  private static readonly CONNECTOR_ACTION_KEY_MAX_LENGTH = 128;
  private static readonly CONNECTOR_ACTION_LABEL_MAX_LENGTH = 128;
  private static readonly CONNECTOR_ACTION_DESCRIPTION_MAX_LENGTH = 1024;

  constructor(
    private readonly connectorStore: PgConnectorStore,
    private readonly connectorCategoryStore: PgConnectorCategoryStore,
    private readonly logger: LoggerService,
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    @Inject('ConnectorAuthService')
    private readonly connectorAuthService: ConnectorAuthService,
    private readonly playbookBindingSyncService: ConnectorPlaybookBindingSyncService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly mcpJwt?: SemanticModelMcpJwtService,
  ) {
    this.logger.setContext(ConnectorService.name);
  }

  async create(createdBy: string, dto: CreateConnectorDto): Promise<PublicConnectorDto> {
    this.assertRemoteMcpTransport(dto.mcpTransportType);
    if (dto.mcpServerUrl) {
      assertNoUrlCredentials(dto.mcpServerUrl);
    }
    const existing = await this.connectorStore.findBySlugAndOwner(dto.slug, createdBy);
    if (existing) {
      throw new ConflictException(ErrorCode.CONNECTOR_ALREADY_EXISTS);
    }

    const actions = this.normalizeConnectorActions(dto.actions);
    const sanitizedMcpServerConfig = this.sanitizeMcpServerConfig(dto.mcpServerConfig);
    const dynamicHeaders = this.normalizeDynamicHeaders(dto.dynamicHeaders);

    const connector = await this.connectorStore.insert({
      slug: dto.slug,
      name: dto.name,
      description: dto.description,
      icon: dto.icon ?? '',
      color: dto.color ?? '',
      iconColor: dto.iconColor ?? 'light',
      categoryId: dto.categoryId ?? null,
      authType: dto.authType ?? 'none',
      authConfigSchema: dto.authConfigSchema ?? {},
      authSourceType: dto.authSourceType ?? 'credential',
      connectedAppKey: dto.connectedAppKey ?? '',
      runtimeAuthConfig: dto.runtimeAuthConfig ?? {},
      mcpTransportType: dto.mcpTransportType ?? 'streamable_http',
      mcpServerUrl: dto.mcpServerUrl ?? '',
      mcpServerConfig: sanitizedMcpServerConfig,
      dynamicHeaders,
      workerPolicy: dto.workerPolicy ?? DEFAULT_WORKER_POLICY,
      actions,
      skillIds: dto.referencedSkillIds ?? [],
      isActive: dto.isActive ?? true,
      isSystem: dto.isSystem ?? false,
      isHidden: dto.isHidden ?? false,
      createdBy,
    });

    return this.toPublicResponse(connector);
  }

  async findAll(query: QueryConnectorDto): Promise<PaginatedResponseDto<PublicConnectorDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const { rows, total } = await this.connectorStore.list({
      search: query.search,
      isActive: query.isActive,
      page,
      limit,
    });

    return new PaginatedResponseDto(
      rows.map((c) => this.toPublicResponse(c)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<PublicConnectorDto> {
    const connector = await this.connectorStore.findById(id);
    if (!connector) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }
    return this.toPublicResponse(connector);
  }

  async findBySlug(slug: string): Promise<PublicConnectorDto | null> {
    const connector = await this.connectorStore.findActiveBySlug(slug);
    return connector ? this.toPublicResponse(connector) : null;
  }

  async findByIds(ids: string[]): Promise<PublicConnectorDto[]> {
    const connectors = await this.connectorStore.findByIds(ids);
    return connectors.map((c) => this.toPublicResponse(c));
  }

  /**
   * SERVER-ONLY: load the raw connector definition, including secret-capable
   * material, for server-side auth resolution, inspection and bindings. Never
   * return a value of this method from an HTTP response — use the public
   * projections instead.
   */
  async getRuntimeById(id: string): Promise<RuntimeConnectorDefinition> {
    const connector = await this.connectorStore.findById(id);
    if (!connector) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }
    return connector;
  }

  /** SERVER-ONLY raw lookup; see {@link getRuntimeById}. */
  async findRuntimeById(id: string): Promise<RuntimeConnectorDefinition | null> {
    return this.connectorStore.findById(id);
  }

  /** SERVER-ONLY raw lookup; see {@link getRuntimeById}. */
  async findRuntimeBySlug(slug: string): Promise<RuntimeConnectorDefinition | null> {
    return this.connectorStore.findActiveBySlug(slug);
  }

  /** SERVER-ONLY raw lookup; see {@link getRuntimeById}. */
  async findRuntimeByIds(ids: string[]): Promise<RuntimeConnectorDefinition[]> {
    return this.connectorStore.findByIds(ids);
  }

  async findIdsByCategoryName(ids: string[], categoryName: string): Promise<string[]> {
    if (!ids.length) return [];
    const categoryIds = await this.connectorCategoryStore.findIdsByNameInsensitive(categoryName);
    if (!categoryIds.length) return [];
    return this.connectorStore.findIdsInCategories(ids, categoryIds);
  }

  /**
   * Resolve connectors by id and map them to the gRPC `ConnectorBinding` wire
   * shape, with per-user auth resolved (OAuth token / credential + dynamic
   * identity headers). Mirrors the v1 agent runtime binding (agent.service
   * `buildConnectorBindings`) but targets the conv-v2 proto, where the action
   * parameter schema travels as a JSON string. Connectors with no enabled
   * action are dropped.
   */
  async findByIdsForGrpc(
    ids: string[],
    userId: string,
    ctx?: SandboxRuntimeContext,
  ): Promise<IGrpcConnector[]> {
    // Raw store rows: gRPC bindings consume secret-capable config server-side
    // and must never round-trip through the public response shape (WP-02).
    const connectors = await this.connectorStore.findByIds(ids);

    const bindings: IGrpcConnector[] = [];
    for (const connector of connectors) {
      // Stored stdio (or unknown) transports are never handed to the agent
      // runtime: binding one would let the runtime spawn a local process from
      // stored config (WP-01).
      if (!isRemoteInspectableMcpTransport(connector.mcpTransportType)) {
        this.logger.warn('Skipping connector with non-remote MCP transport for runtime binding', {
          connector_id: connector.id,
        });
        continue;
      }
      const actions = (connector.actions || [])
        .filter((action) => action.isEnabled)
        .map((action) => ({
          action_key: action.key,
          label: action.label || action.key,
          description: action.description || '',
          parameter_schema_json: JSON.stringify(action.parameterSchema || {}),
          result_kind: action.resultKind || ConnectorActionResultKind.GENERIC,
          citation_mode: action.citationMode || ConnectorCitationMode.NONE,
          result_mapping_json: JSON.stringify(action.resultMapping || {}),
        }));
      if (actions.length === 0) continue;

      let authHeaders: Record<string, string> = {};
      let authEnv: Record<string, string> = {};

      if (userId && connector.authSourceType !== 'none') {
        try {
          const auth = await this.connectorAuthService.resolveRuntimeAuth(userId, {
            authSourceType: connector.authSourceType,
            connectedAppKey: connector.connectedAppKey || '',
            runtimeAuthConfig: connector.runtimeAuthConfig || {},
            connectorId: connector.id,
          });
          authHeaders = auth.headers;
          authEnv = auth.env;
        } catch (err) {
          this.logger.warn('Failed to resolve connector auth for conv-v2 runtime', {
            connector_id: connector.id,
            error: (err as Error).message,
          });
        }
      }

      if (userId) {
        try {
          const dynamicHeaders = await this.connectorAuthService.resolveDynamicHeaders(
            userId,
            connector.dynamicHeaders || [],
          );
          authHeaders = { ...authHeaders, ...dynamicHeaders };
        } catch (err) {
          this.logger.warn('Failed to resolve connector dynamic headers for conv-v2 runtime', {
            connector_id: connector.id,
            error: (err as Error).message,
          });
        }
      }

      // Runtime scope identity for the Code Interpreter (MCP Manus) connector:
      // stamp x-sandbox-* so MCP Manus forwards it to the Runtime Coordinator.
      if (ctx && connector.slug === CODE_INTERPRETER_CONNECTOR_SLUG) {
        authHeaders = { ...authHeaders, ...buildSandboxScopeHeaders(ctx) };
      }

      if (userId && this.mcpJwt) {
        const auth = await this.mcpJwt.bindingAuth(connector.mcpServerUrl, userId,
          connector.id, authHeaders, authEnv);
        authHeaders = auth.headers;
        authEnv = auth.env;
      }
      bindings.push({
        connector_id: connector.id,
        connector_name: connector.name,
        mcp_transport_type: connector.mcpTransportType || '',
        mcp_server_url: connector.mcpServerUrl || '',
        auth_headers: authHeaders,
        auth_env: authEnv,
        mcp_server_config_json: JSON.stringify(connector.mcpServerConfig || {}),
        actions,
      });
    }

    return bindings;
  }

  async findAllActive(): Promise<PublicConnectorDto[]> {
    const connectors = await this.connectorStore.findAllActiveVisible();

    const categoryNameById = await this.buildCategoryNameMap(connectors);

    return connectors.map((c) =>
      this.toPublicResponse({
        ...c,
        categoryName: c.categoryId ? (categoryNameById.get(c.categoryId) ?? null) : null,
      }),
    );
  }

  /** Resolve category id -> name for the given connectors in a single query. */
  private async buildCategoryNameMap(
    connectors: { categoryId?: string | null }[],
  ): Promise<Map<string, string>> {
    const categoryIds = Array.from(
      new Set(connectors.map((c) => c.categoryId).filter((id): id is string => Boolean(id))),
    );
    if (!categoryIds.length) return new Map();
    return this.connectorCategoryStore.findNamesByIds(categoryIds);
  }

  async update(id: string, dto: UpdateConnectorDto): Promise<PublicConnectorDto> {
    this.assertRemoteMcpTransport(dto.mcpTransportType);
    if (dto.mcpServerUrl) {
      assertNoUrlCredentials(dto.mcpServerUrl);
    }
    const existing = await this.connectorStore.findById(id);
    if (!existing) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }

    if (dto.slug && dto.slug !== existing.slug) {
      const duplicate = await this.connectorStore.findBySlugExcludingOwner(dto.slug, id, existing.createdBy);
      if (duplicate) {
        throw new ConflictException(ErrorCode.CONNECTOR_ALREADY_EXISTS);
      }
    }

    const updateData: Record<string, unknown> = { ...dto };
    // Explicit authenticated clear: an admin clears stored runtime credentials
    // without ever reading them (WP02.5). Omitted fields preserve secrets.
    if ((dto as { clearRuntimeAuthConfig?: boolean }).clearRuntimeAuthConfig === true) {
      (updateData).runtimeAuthConfig = {};
    }
    delete (updateData as { clearRuntimeAuthConfig?: boolean }).clearRuntimeAuthConfig;
    let normalizedActions: ConnectorAction[] | null = null;
    if (dto.actions) {
      normalizedActions = this.normalizeConnectorActions(dto.actions);
      (updateData).actions = normalizedActions;
    }
    if (dto.referencedSkillIds) {
      (updateData).skillIds = dto.referencedSkillIds;
      delete (updateData).referencedSkillIds;
    }
    if (dto.mcpServerConfig) {
      (updateData).mcpServerConfig = this.sanitizeMcpServerConfig(dto.mcpServerConfig);
    }
    if (dto.dynamicHeaders) {
      (updateData).dynamicHeaders = this.normalizeDynamicHeaders(dto.dynamicHeaders);
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'categoryId')) {
      (updateData).categoryId = dto.categoryId || null;
    }

    const updated = await this.connectorStore.update(id, updateData);
    if (!updated) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }
    if (normalizedActions) {
      try {
        await this.playbookBindingSyncService.syncConnectorActions(
          id,
          this.getEnabledActionContracts(existing.actions || []),
          this.getEnabledActionContracts(normalizedActions),
        );
      } catch (err) {
        this.logger.warn('Failed to synchronize playbook connector action bindings after connector update', {
          connectorId: id,
          error: (err as Error).message,
        });
      }
    }
    return this.toPublicResponse(updated);
  }

  async delete(id: string): Promise<void> {
    // Credentials and connector_skills cascade via validated FKs (plan 3.5);
    // agent junction rows keep the explicit pullConnectorFromAll until their
    // FK lands with the agent-side pass.
    const connector = await this.connectorStore.delete(id);
    if (!connector) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }
  }

  private getEnabledActionContracts(actions: ConnectorAction[]) {
    return actions
      .filter((action) => action.isEnabled)
      .map((action) => ({
        key: String(action.key || '').trim(),
        parameterSchema: action.parameterSchema || {},
      }))
      .filter((action) => Boolean(action.key));
  }

  async importFromMcp(createdBy: string, transportType: string, serverUrl: string, serverConfig?: Record<string, unknown>): Promise<IMcpInspectResult> {
    // inspectMcp validates the transport BEFORE the endpoint URL, so a denied
    // import always surfaces the deterministic ERR_3102 400 first (WP-01/WP02.6).
    const inspectResult = await this.inspectMcp(transportType, serverUrl, serverConfig, createdBy);
    if (inspectResult.error) {
      return inspectResult;
    }

    const actions = inspectResult.tools.map((tool) => ({
      key: tool.name,
      label: this.humanizeToolName(tool.name),
      description: tool.description ?? '',
      parameterSchema: tool.inputSchema ?? {},
      outputSchema: {},
      safety: tool.safety ?? 'read',
      supportsBatch: false,
      supportsIteration: false,
      isEnabled: true,
      resultKind: ConnectorActionResultKind.GENERIC,
      citationMode: ConnectorCitationMode.NONE,
    })) as ConnectorAction[];

    const baseName = inspectResult.serverName || this.slugify(serverUrl.split('/').pop() ?? serverUrl) || 'connector';
    const baseSlug = this.slugify(baseName) || 'connector';
    const { name, slug } = await this.getUniqueImportedIdentity(baseName, baseSlug, createdBy);

    await this.connectorStore.insert({
      slug,
      name,
      description: `MCP connector imported from ${serverUrl}`,
      icon: '',
      color: '',
      iconColor: 'light',
      categoryId: null,
      authType: 'none',
      authConfigSchema: {},
      authSourceType: 'credential',
      connectedAppKey: '',
      runtimeAuthConfig: {},
      mcpTransportType: transportType,
      mcpServerUrl: serverUrl,
      mcpServerConfig: this.sanitizeMcpServerConfig(serverConfig),
      dynamicHeaders: [],
      actions,
      skillIds: [],
      isActive: true,
      isSystem: false,
      isHidden: false,
      createdBy,
    });

    return inspectResult;
  }

  private async getUniqueImportedIdentity(
    baseName: string,
    baseSlug: string,
    createdBy: string,
  ): Promise<{ name: string; slug: string }> {
    // `slug` OR `slug-<n>` on the owner — regex-escaped inside the store (plan 3.4).
    const existingSlugs = new Set(await this.connectorStore.findImportSlugs(createdBy, baseSlug));

    if (!existingSlugs.has(baseSlug)) {
      return { name: baseName, slug: baseSlug };
    }

    let suffix = 2;
    let nextSlug = `${baseSlug}-${suffix}`;
    while (existingSlugs.has(nextSlug)) {
      suffix += 1;
      nextSlug = `${baseSlug}-${suffix}`;
    }

    return {
      name: `${baseName} (${suffix})`,
      slug: nextSlug,
    };
  }

  async inspectMcp(
    transportType: string,
    serverUrl: string,
    serverConfig?: Record<string, unknown>,
    userId?: string,
    connectedAppKey?: string,
    runtimeAuthConfig?: Record<string, unknown>,
    resolvedToken?: string,
    resolvedAuthHeaders?: Record<string, string>,
  ): Promise<IMcpInspectResult> {
    // Hard deny BEFORE any credential resolution, network I/O or transport
    // construction (WP01.1/WP01.2): only remote HTTP transports are inspectable,
    // so no API request can start a caller-selected OS process. Thrown outside
    // the try/catch so a denial surfaces as 400, never as a 200 { error } body.
    if (!isRemoteInspectableMcpTransport(transportType)) {
      this.logger.warn('Denied MCP inspection for unsupported transport', { transportType });
      throw new BadRequestException(
        ErrorCode.CONNECTOR_MCP_TRANSPORT_UNSUPPORTED,
        'Only remote MCP transports (sse, streamable_http) can be inspected.',
      );
    }
    assertNoUrlCredentials(serverUrl);
    // SSRF egress policy (WP-05): the destination must be a permitted public
    // HTTP(S) endpoint BEFORE any DNS-consuming transport is built. Thrown
    // outside the try/catch like the transport denial, with non-sensitive
    // telemetry only (actor, host, reason — never the full URL or headers).
    try {
      await assertMcpDestinationAllowed(serverUrl, this.mcpDestinationPolicyOptions());
    } catch (error) {
      if (error instanceof McpDestinationPolicyError) {
        this.logger.warn('Denied MCP inspection destination', {
          userId: userId ?? 'anonymous',
          host: error.host,
          reason: error.reason,
        });
        throw new BadRequestException(
          ErrorCode.CONNECTOR_MCP_DESTINATION_BLOCKED,
          'This MCP server destination is not allowed.',
        );
      }
      throw error;
    }

    try {

      let client: any;
      let transport: any;
      let finalServerConfig = this.sanitizeMcpServerConfig(serverConfig);

      if (resolvedToken) {
        finalServerConfig = this.applyRuntimeAuthToServerConfig(
          finalServerConfig,
          runtimeAuthConfig,
          resolvedToken,
        );
      } else if (userId && connectedAppKey) {
        // If using connected app auth, fetch the token and inject it per runtime strategy.
        try {
          const token = await this.connectedAppTokenService.getValidToken(userId, connectedAppKey);
          finalServerConfig = this.applyRuntimeAuthToServerConfig(
            finalServerConfig,
            runtimeAuthConfig,
            token,
          );
        } catch (error) {
          this.logger.error('Failed to get OAuth token for MCP inspection', {
            connectedAppKey,
            errorName: (error as Error).name,
          });
          return {
            serverName: '',
            tools: [],
            error: `Failed to get authentication token: ${this.toSafeInspectErrorMessage(error)}`,
          };
        }
      }

      if (resolvedAuthHeaders && Object.keys(resolvedAuthHeaders).length > 0) {
        finalServerConfig = {
          ...finalServerConfig,
          headers: {
            ...this.extractStringMap(finalServerConfig.headers),
            ...resolvedAuthHeaders,
          },
        };
      }

      let requestInit = this.buildMcpRequestInit(finalServerConfig);
      // No-follow redirects for every inspection hop (WP05.3): a redirect must
      // never move the probe to a destination the policy never validated.
      requestInit = { ...requestInit, redirect: 'error' };
      if (userId && this.mcpJwt?.isJwtServer(serverUrl)) {
        requestInit = { headers: await this.mcpJwt.headers(serverUrl, userId, this.buildMcpHeaders(finalServerConfig)), redirect: 'error' };
      }

      if (transportType === 'sse') {
         
        const sseMod = await import('@modelcontextprotocol/sdk/client/sse.js').catch(() => null);
        if (!sseMod) {
          return { serverName: '', tools: [], error: 'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk' };
        }
        const SSEClientTransport = sseMod.SSEClientTransport;
        transport = new SSEClientTransport(new URL(serverUrl), { requestInit });
      } else {
        // streamable_http — the guard above already rejected every other value.
        const httpMod = await import('@modelcontextprotocol/sdk/client/streamableHttp.js').catch(() => null);
        if (!httpMod) {
          return { serverName: '', tools: [], error: 'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk' };
        }
        const StreamableHTTPClientTransport = httpMod.StreamableHTTPClientTransport;
        transport = new StreamableHTTPClientTransport(new URL(serverUrl), { requestInit });
      }

       
      const clientMod = await import('@modelcontextprotocol/sdk/client/index.js').catch(() => null);
      if (!clientMod) {
        return { serverName: '', tools: [], error: 'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk' };
      }

      const Client = clientMod.Client;
      client = new Client({ name: 'yellowstorm-connector-inspector', version: '1.0.0' });
      await client.connect(transport);
      const { tools } = await client.listTools();
      await client.close();

      const mappedTools = (tools ?? []).map((t: any) => ({
        name: t.name ?? '',
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? {},
        safety: mcpToolSafety(t.annotations),
      }));

      return {
        serverName: this.slugify(serverUrl.split('/').pop() ?? serverUrl),
        tools: mappedTools,
      };
    } catch (err) {
      // Never log or echo raw provider/SDK errors: they can contain
      // credential-bearing URLs or auth material (WP02.8).
      this.logger.error('MCP inspection failed', {
        ...this.inspectLogContext(serverUrl),
        errorName: err instanceof Error ? err.name : typeof err,
      });
      return {
        serverName: '',
        tools: [],
        error: this.toSafeInspectErrorMessage(err),
      };
    }
  }

  /** Project provider/SDK errors to a client-safe message: strip credential-bearing URL userinfo and bearer tokens, cap length (WP02.8). */
  private toSafeInspectErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : 'Failed to inspect MCP server';
    // Consume ALL userinfo segments (user[:pass]@ repeated) so a second '@'
    // cannot leave password material behind the scrub.
    const scrubbed = raw
      .replace(/([a-z][a-z0-9+.-]*:\/\/)(?:[^@\s/]+@)+/gi, '$1***@')
      .replace(/(bearer\s+)[^\s"',;]+/gi, '$1***');
    return this.truncateValue(scrubbed, 300);
  }

  /** Host-only inspection log context: never the full URL or error payload. */
  private inspectLogContext(serverUrl: string): { host: string } {
    try {
      return { host: new URL(serverUrl).host };
    } catch {
      return { host: '' };
    }
  }

  private humanizeToolName(name: string): string {
    return name
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  private buildMcpRequestInit(serverConfig?: Record<string, unknown>): RequestInit | undefined {
    const headers = this.buildMcpHeaders(serverConfig);
    return Object.keys(headers).length > 0 ? { headers } : undefined;
  }

  /** Egress policy knobs from typed config; production stays https-only (WP05.1). */
  private mcpDestinationPolicyOptions(): McpDestinationPolicyOptions {
    const config = this.configService;
    const ports = (config?.get<string>('MCP_EGRESS_ALLOWED_PORTS') ?? '80,443,8443')
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0 && value < 65536);
    const nodeEnv = config?.get<string>('NODE_ENV', 'development');
    const allowInsecureHttp = (config?.get<boolean>('MCP_EGRESS_ALLOW_INSECURE_HTTP', false) ?? false) && nodeEnv !== 'production';
    return { allowedPorts: ports.length ? ports : [80, 443, 8443], allowInsecureHttp };
  }

  private buildMcpHeaders(serverConfig?: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = {};
    const configHeaders = serverConfig?.headers;

    if (configHeaders && typeof configHeaders === 'object' && !Array.isArray(configHeaders)) {
      for (const [key, value] of Object.entries(configHeaders as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) {
          headers[key] = value;
        }
      }
    }

    const githubPat = typeof serverConfig?.githubPat === 'string' ? serverConfig.githubPat.trim() : '';
    if (githubPat && !headers.Authorization) {
      headers.Authorization = `Bearer ${githubPat}`;
    }

    return headers;
  }

  private sanitizeMcpServerConfig(serverConfig?: Record<string, unknown>): Record<string, unknown> {
    if (!serverConfig || typeof serverConfig !== 'object') {
      return {};
    }

    const sanitized = { ...serverConfig };
    delete sanitized.githubPat;

    return sanitized;
  }

  private applyRuntimeAuthToServerConfig(
    serverConfig: Record<string, unknown>,
    runtimeAuthConfig: Record<string, unknown> | undefined,
    token: string,
  ): Record<string, unknown> {
    const config = runtimeAuthConfig ?? {};
    const strategy = typeof config.strategy === 'string' ? config.strategy : 'http_header_bearer';
    const nextConfig = { ...serverConfig };

    if (strategy === 'env_vars') {
      const envMap = this.extractStringMap(config.envMap);
      const existingEnv = this.extractStringMap(nextConfig.env);
      nextConfig.env = Object.entries(envMap).reduce<Record<string, string>>(
        (acc, [key, template]) => {
          acc[key] = template.replace('{token}', token);
          return acc;
        },
        { ...existingEnv },
      );
      return nextConfig;
    }

    const existingHeaders = this.extractStringMap(nextConfig.headers);
    const authHeaders =
      strategy === 'custom_headers'
        ? Object.entries(this.extractStringMap(config.headerMappings)).reduce<Record<string, string>>(
            (acc, [key, template]) => {
              acc[key] = template.replace('{token}', token);
              return acc;
            },
            {},
          )
        : {
            [typeof config.headerName === 'string' && config.headerName.trim()
              ? config.headerName
              : 'Authorization']:
              `${typeof config.headerPrefix === 'string' ? config.headerPrefix : 'Bearer '}${token}`,
          };

    nextConfig.headers = {
      ...existingHeaders,
      ...authHeaders,
    };

    return nextConfig;
  }

  private extractStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, entryValue]) => {
        if (typeof entryValue === 'string') {
          acc[key] = entryValue;
        }
        return acc;
      },
      {},
    );
  }

  private normalizeDynamicHeaders(
    dynamicHeaders?: { headerName: string; source: string; enabled?: boolean }[],
  ): ConnectorDynamicHeader[] {
    const allowed = new Set<string>(Object.values(DynamicHeaderSource));
    return (dynamicHeaders ?? [])
      .map((row) => ({
        headerName: (row.headerName || '').trim(),
        source: row.source,
        enabled: row.enabled ?? true,
      }))
      .filter((row) => row.headerName.length > 0 && allowed.has(row.source))
      .map((row) => ({
        headerName: this.truncateValue(row.headerName, 128),
        source: row.source as DynamicHeaderSource,
        enabled: row.enabled,
      }));
  }

  private normalizeConnectorActions(actions?: {
    key: string;
    label: string;
    description?: string;
    parameterSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    safety?: string;
    executionKind?: 'inherit' | 'leaf' | 'orchestration' | 'unknown';
    workerAccess?: 'inherit' | 'allow' | 'block';
    supportsBatch?: boolean;
    supportsIteration?: boolean;
    isEnabled?: boolean;
    resultKind?: ConnectorActionResultKind;
    citationMode?: ConnectorCitationMode;
    resultMapping?: Record<string, unknown>;
  }[]): ConnectorAction[] {
    return (actions ?? []).map((action) => {
      // Replace {variable_name} with [variable_name] to prevent Google ADK template substitution
      // This fixes "Context variable not found" errors when variables like {property_name}
      // appear in connector tool descriptions but are not meant to be substituted
      const sanitizedDescription = (action.description ?? '').replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, '[$1]');

      return {
        key: this.truncateValue(action.key, ConnectorService.CONNECTOR_ACTION_KEY_MAX_LENGTH),
        label: this.truncateValue(action.label, ConnectorService.CONNECTOR_ACTION_LABEL_MAX_LENGTH),
        description: this.truncateValue(sanitizedDescription, ConnectorService.CONNECTOR_ACTION_DESCRIPTION_MAX_LENGTH),
        parameterSchema: action.parameterSchema ?? {},
        outputSchema: action.outputSchema ?? {},
        safety: action.safety ?? 'read',
        executionKind: isPlatformOrchestration(action.key) ? 'orchestration' : action.executionKind ?? 'inherit',
        workerAccess: action.workerAccess ?? 'inherit',
        supportsBatch: action.supportsBatch ?? false,
        supportsIteration: action.supportsIteration ?? false,
        isEnabled: action.isEnabled ?? true,
        resultKind: action.resultKind ?? ConnectorActionResultKind.GENERIC,
        citationMode: action.citationMode ?? ConnectorCitationMode.NONE,
        ...(action.resultMapping ? { resultMapping: action.resultMapping } : {}),
      };
    }) as ConnectorAction[];
  }

  private truncateValue(value: string, maxLength: number): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  /**
   * Allowlisted public projection (SEC-02 / WP-02): secret-capable fields
   * (runtimeAuthConfig, mcpServerConfig) are never copied out of the row;
   * `credentialConfigured` and `inspectionStatus` summarise them instead.
   */
  private toPublicResponse(doc: ConnectorRow & { categoryName?: string | null }): PublicConnectorDto {
    const runtimeAuthConfig = doc.runtimeAuthConfig ?? {};
    const credentialConfigured = (doc.authSourceType ?? 'credential') === 'connected_app'
      ? Boolean(doc.connectedAppKey)
      : Object.keys(runtimeAuthConfig).length > 0;
    return {
      id: doc.id,
      slug: doc.slug,
      name: doc.name,
      description: doc.description,
      icon: doc.icon,
      color: doc.color,
      iconColor: (doc.iconColor as 'light' | 'dark') ?? 'light',
      categoryId: doc.categoryId ? doc.categoryId.toString() : null,
      categoryName: doc.categoryName ?? null,
      authType: doc.authType,
      authConfigSchema: doc.authConfigSchema ?? {},
      authSourceType: doc.authSourceType ?? 'credential',
      connectedAppKey: doc.connectedAppKey ?? '',
      credentialConfigured,
      mcpTransportType: doc.mcpTransportType,
      mcpServerUrl: sanitizeEndpointUrl(doc.mcpServerUrl),
      inspectionStatus: isRemoteInspectableMcpTransport(doc.mcpTransportType)
        ? 'supported'
        : 'unsupported_for_http_inspection',
      workerPolicy: doc.workerPolicy ?? DEFAULT_WORKER_POLICY,
      dynamicHeaders: (doc.dynamicHeaders ?? []).map((h: any) => ({
        headerName: h.headerName,
        source: h.source,
        enabled: h.enabled ?? true,
      })),
      actions: (doc.actions ?? []).map((a) => ({
        key: a.key,
        label: a.label,
        description: a.description ?? '',
        parameterSchema: a.parameterSchema ?? {},
        outputSchema: a.outputSchema ?? {},
        safety: a.safety ?? 'read',
        executionKind: isPlatformOrchestration(a.key) ? 'orchestration' : a.executionKind ?? 'inherit',
        workerAccess: a.workerAccess ?? 'inherit',
        supportsBatch: a.supportsBatch ?? false,
        supportsIteration: a.supportsIteration ?? false,
        isEnabled: a.isEnabled ?? true,
        resultKind: a.resultKind ?? ConnectorActionResultKind.GENERIC,
        citationMode: a.citationMode ?? ConnectorCitationMode.NONE,
        ...('resultMapping' in a && a.resultMapping ? { resultMapping: a.resultMapping } : {}),
      })),
      referencedSkillIds: doc.skillIds,
      isActive: doc.isActive,
      isSystem: doc.isSystem ?? false,
      isHidden: doc.isHidden ?? false,
      createdBy: doc.createdBy?.toString() ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /** WP01.3: service-level transport validation for connector writes. */
  private assertRemoteMcpTransport(transportType?: string): void {
    if (transportType !== undefined && !isRemoteInspectableMcpTransport(transportType)) {
      throw new BadRequestException(
        ErrorCode.CONNECTOR_MCP_TRANSPORT_UNSUPPORTED,
        'Connectors support only remote MCP transports (sse, streamable_http).',
      );
    }
  }

  /**
   * Public guard so controllers can reject non-remote transports BEFORE any
   * credential resolution, token refresh or network side effect (WP-01).
   */
  assertInspectableTransport(transportType: string): void {
    if (!isRemoteInspectableMcpTransport(transportType)) {
      this.logger.warn('Denied MCP operation for unsupported transport', { transportType });
      throw new BadRequestException(
        ErrorCode.CONNECTOR_MCP_TRANSPORT_UNSUPPORTED,
        'Only remote MCP transports (sse, streamable_http) are supported over HTTP.',
      );
    }
  }
}
