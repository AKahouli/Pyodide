import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { escapeRegex, stripLeadingTrailingChar } from '../../common/utils';
import { BadRequestException, ConflictException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { CreateConnectorDto, QueryConnectorDto, UpdateConnectorDto } from './dto';
import {
  Connector,
  ConnectorDocument,
  ConnectorAction,
  ConnectorDynamicHeader,
  DynamicHeaderSource,
} from './schemas/connector.schema';
import { ConnectorCategory } from './schemas/connector-category.schema';
import {
  IConnectorResponse,
  IMcpInspectResult,
  IGrpcConnector,
} from './interfaces/connector.interface';
import { ConnectorAuthService } from './interfaces/connector-auth.interface';
import { ConnectedAppTokenService } from '../connected-app/services/connected-app-token.service';

@Injectable()
export class ConnectorService {
  private static readonly CONNECTOR_ACTION_KEY_MAX_LENGTH = 128;
  private static readonly CONNECTOR_ACTION_LABEL_MAX_LENGTH = 128;
  private static readonly CONNECTOR_ACTION_DESCRIPTION_MAX_LENGTH = 1024;

  constructor(
    @InjectModel(Connector.name)
    private readonly connectorModel: Model<ConnectorDocument>,
    @InjectModel(ConnectorCategory.name)
    private readonly connectorCategoryModel: Model<ConnectorCategory>,
    private readonly logger: LoggerService,
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    @Inject('ConnectorAuthService')
    private readonly connectorAuthService: ConnectorAuthService,
  ) {
    this.logger.setContext(ConnectorService.name);
  }

  async create(createdBy: string, dto: CreateConnectorDto): Promise<IConnectorResponse> {
    const existing = await this.connectorModel
      .findOne({ slug: dto.slug, createdBy: new Types.ObjectId(createdBy) })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException(ErrorCode.CONNECTOR_ALREADY_EXISTS);
    }

    const actions = this.normalizeConnectorActions(dto.actions);
    const sanitizedMcpServerConfig = this.sanitizeMcpServerConfig(dto.mcpServerConfig);
    const dynamicHeaders = this.normalizeDynamicHeaders(dto.dynamicHeaders);

    const connector = await this.connectorModel.create({
      slug: dto.slug,
      name: dto.name,
      description: dto.description,
      icon: dto.icon ?? '',
      color: dto.color ?? '',
      iconColor: dto.iconColor ?? 'light',
      categoryId: dto.categoryId ? new Types.ObjectId(dto.categoryId) : null,
      authType: dto.authType ?? 'none',
      authConfigSchema: dto.authConfigSchema ?? {},
      authSourceType: dto.authSourceType ?? 'credential',
      connectedAppKey: dto.connectedAppKey ?? '',
      runtimeAuthConfig: dto.runtimeAuthConfig ?? {},
      mcpTransportType: dto.mcpTransportType ?? 'streamable_http',
      mcpServerUrl: dto.mcpServerUrl ?? '',
      mcpServerConfig: sanitizedMcpServerConfig,
      dynamicHeaders,
      actions,
      referencedSkillIds: (dto.referencedSkillIds ?? []).map((id) => new Types.ObjectId(id)),
      isActive: dto.isActive ?? true,
      createdBy: new Types.ObjectId(createdBy),
    });

    return this.toResponse(connector);
  }

  async findAll(query: QueryConnectorDto): Promise<PaginatedResponseDto<IConnectorResponse>> {
    const filter: FilterQuery<ConnectorDocument> = {};
    if (query.search) {
      const regex = { $regex: escapeRegex(query.search), $options: 'i' };
      filter.$or = [{ slug: regex }, { name: regex }];
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [connectors, total] = await Promise.all([
      this.connectorModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.connectorModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(
      connectors.map((c) => this.toResponse(c)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<IConnectorResponse> {
    const connector = await this.connectorModel.findById(id).lean().exec();
    if (!connector) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }
    return this.toResponse(connector);
  }

  async findBySlug(slug: string): Promise<IConnectorResponse | null> {
    const connector = await this.connectorModel
      .findOne({ slug, isActive: true })
      .lean()
      .exec();
    return connector ? this.toResponse(connector) : null;
  }

  async findByIds(ids: string[]): Promise<IConnectorResponse[]> {
    if (!ids.length) return [];

    const connectors = await this.connectorModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();

    return connectors.map((c) => this.toResponse(c));
  }

  /**
   * Resolve connectors by id and map them to the gRPC `ConnectorBinding` wire
   * shape, with per-user auth resolved (OAuth token / credential + dynamic
   * identity headers). Mirrors the v1 agent runtime binding (agent.service
   * `buildConnectorBindings`) but targets the conv-v2 proto, where the action
   * parameter schema travels as a JSON string. Connectors with no enabled
   * action are dropped.
   */
  async findByIdsForGrpc(ids: string[], userId: string): Promise<IGrpcConnector[]> {
    const connectors = await this.findByIds(ids);

    const bindings: IGrpcConnector[] = [];
    for (const connector of connectors) {
      const actions = (connector.actions || [])
        .filter((action) => action.isEnabled !== false)
        .map((action) => ({
          action_key: action.key,
          label: action.label || action.key,
          description: action.description || '',
          parameter_schema_json: JSON.stringify(action.parameterSchema || {}),
        }));
      if (actions.length === 0) continue;

      let authHeaders: Record<string, string> = {};
      let authEnv: Record<string, string> = {};

      // Resolve runtime auth for BOTH connected_app (per-user OAuth) and
      // credential (a saved per-connector credential — the default source).
      // The old guard only handled connected_app, so credential connectors
      // (e.g. code-interpreter, linkup) went out with empty auth_headers.
      // resolveRuntimeAuth branches on authSourceType; pass connectorId so its
      // credential branch can find the active saved credential.
      if (userId && connector.authSourceType && connector.authSourceType !== 'none') {
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

  async findAllActive(): Promise<IConnectorResponse[]> {
    const connectors = await this.connectorModel
      .find({ isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();

    const categoryNameById = await this.buildCategoryNameMap(connectors);

    return connectors.map((c) =>
      this.toResponse({
        ...c,
        categoryName: c.categoryId
          ? (categoryNameById.get(c.categoryId.toString()) ?? null)
          : null,
      }),
    );
  }

  /** Resolve category id -> name for the given connectors in a single query. */
  private async buildCategoryNameMap(
    connectors: Array<{ categoryId?: Types.ObjectId | null }>,
  ): Promise<Map<string, string>> {
    const categoryIds = Array.from(
      new Set(
        connectors
          .map((c) => c.categoryId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (!categoryIds.length) return new Map();

    const categories = await this.connectorCategoryModel
      .find({ _id: { $in: categoryIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id name')
      .lean()
      .exec();

    return new Map(
      categories.map((cat: any) => [cat._id.toString(), cat.name as string]),
    );
  }

  async update(id: string, dto: UpdateConnectorDto): Promise<IConnectorResponse> {
    const existing = await this.connectorModel.findById(id).lean().exec();
    if (!existing) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }

    if (dto.slug && dto.slug !== existing.slug) {
      const duplicate = await this.connectorModel
        .findOne({ _id: { $ne: new Types.ObjectId(id) }, slug: dto.slug, createdBy: existing.createdBy })
        .lean()
        .exec();
      if (duplicate) {
        throw new ConflictException(ErrorCode.CONNECTOR_ALREADY_EXISTS);
      }
    }

    const updateData: Record<string, unknown> = { ...dto };
    if (dto.actions) {
      (updateData as Record<string, unknown>).actions = this.normalizeConnectorActions(dto.actions);
    }
    if (dto.referencedSkillIds) {
      (updateData as Record<string, unknown>).referencedSkillIds = dto.referencedSkillIds.map(
        (id) => new Types.ObjectId(id),
      );
    }
    if (dto.mcpServerConfig) {
      (updateData as Record<string, unknown>).mcpServerConfig = this.sanitizeMcpServerConfig(dto.mcpServerConfig);
    }
    if (dto.dynamicHeaders) {
      (updateData as Record<string, unknown>).dynamicHeaders = this.normalizeDynamicHeaders(dto.dynamicHeaders);
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'categoryId')) {
      (updateData as Record<string, unknown>).categoryId = dto.categoryId ? new Types.ObjectId(dto.categoryId) : null;
    }

    const updated = await this.connectorModel
      .findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    const connector = await this.connectorModel.findByIdAndDelete(id).lean().exec();
    if (!connector) {
      throw new NotFoundException(ErrorCode.CONNECTOR_NOT_FOUND);
    }
  }

  async importFromMcp(createdBy: string, transportType: string, serverUrl: string, serverConfig?: Record<string, unknown>): Promise<IMcpInspectResult> {
    const inspectResult = await this.inspectMcp(transportType, serverUrl, serverConfig);
    if (inspectResult.error) {
      return inspectResult;
    }

    const actions = inspectResult.tools.map((tool) => ({
      key: tool.name,
      label: this.humanizeToolName(tool.name),
      description: tool.description ?? '',
      parameterSchema: tool.inputSchema ?? {},
      outputSchema: {},
      safety: 'read' as const,
      supportsBatch: false,
      supportsIteration: false,
      isEnabled: true,
    }));

    const creatorId = new Types.ObjectId(createdBy);
    const baseName = inspectResult.serverName || this.slugify(serverUrl.split('/').pop() ?? serverUrl) || 'connector';
    const baseSlug = this.slugify(baseName) || 'connector';
    const { name, slug } = await this.getUniqueImportedIdentity(baseName, baseSlug, creatorId);

    await this.connectorModel.create({
      slug,
      name,
      description: `MCP connector imported from ${serverUrl}`,
      authType: 'none',
      authConfigSchema: {},
      referencedSkillIds: [],
      isActive: true,
      createdBy: creatorId,
      mcpTransportType: transportType,
      mcpServerUrl: serverUrl,
      mcpServerConfig: this.sanitizeMcpServerConfig(serverConfig),
      actions,
    });

    return inspectResult;
  }

  private async getUniqueImportedIdentity(
    baseName: string,
    baseSlug: string,
    createdBy: Types.ObjectId,
  ): Promise<{ name: string; slug: string }> {
    const existingConnectors = await this.connectorModel
      .find({ createdBy, slug: { $regex: `^${escapeRegex(baseSlug)}(?:-[0-9]+)?$` } })
      .select({ slug: 1, name: 1 })
      .lean()
      .exec();

    if (!existingConnectors.some((connector) => connector.slug === baseSlug)) {
      return { name: baseName, slug: baseSlug };
    }

    const existingSlugs = new Set(existingConnectors.map((connector) => connector.slug));
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
  ): Promise<IMcpInspectResult> {
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
            error: (error as Error).message,
          });
          return {
            serverName: '',
            tools: [],
            error: `Failed to get authentication token: ${(error as Error).message}`,
          };
        }
      }

      const requestInit = this.buildMcpRequestInit(finalServerConfig);

      if (transportType === 'sse') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sseMod = await import('@modelcontextprotocol/sdk/client/sse.js').catch(() => null);
        if (!sseMod) {
          return { serverName: '', tools: [], error: 'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk' };
        }
        const SSEClientTransport = sseMod.SSEClientTransport;
        transport = new SSEClientTransport(new URL(serverUrl), { requestInit });
      } else if (transportType === 'streamable_http') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const httpMod = await import('@modelcontextprotocol/sdk/client/streamableHttp.js').catch(() => null);
        if (!httpMod) {
          return { serverName: '', tools: [], error: 'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk' };
        }
        const StreamableHTTPClientTransport = httpMod.StreamableHTTPClientTransport;
        transport = new StreamableHTTPClientTransport(new URL(serverUrl), { requestInit });
      } else {
        // stdio
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const stdioMod = await import('@modelcontextprotocol/sdk/client/stdio.js').catch(() => null);
        if (!stdioMod) {
          return { serverName: '', tools: [], error: 'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk' };
        }
        const StdioClientTransport = stdioMod.StdioClientTransport;
        const args = (serverConfig?.commandArgs as string[]) ?? ['--stdio'];
        const env = (serverConfig?.env as Record<string, string>) ?? {};
        transport = new StdioClientTransport({ command: serverUrl, args, env });
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      }));

      return {
        serverName: this.slugify(serverUrl.split('/').pop() ?? serverUrl),
        tools: mappedTools,
      };
    } catch (err) {
      this.logger.error('MCP inspection failed', { serverUrl, error: err });
      return {
        serverName: '',
        tools: [],
        error: err instanceof Error ? err.message : 'Failed to inspect MCP server',
      };
    }
  }

  private humanizeToolName(name: string): string {
    return name
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private slugify(text: string): string {
    return stripLeadingTrailingChar(
      text
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-'),
      '-',
    ).slice(0, 64);
  }

  private buildMcpRequestInit(serverConfig?: Record<string, unknown>): RequestInit | undefined {
    const headers = this.buildMcpHeaders(serverConfig);
    return Object.keys(headers).length > 0 ? { headers } : undefined;
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
    dynamicHeaders?: Array<{ headerName: string; source: string; enabled?: boolean }>,
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
      })) as ConnectorDynamicHeader[];
  }

  private normalizeConnectorActions(actions?: Array<{
    key: string;
    label: string;
    description?: string;
    parameterSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    safety?: string;
    supportsBatch?: boolean;
    supportsIteration?: boolean;
    isEnabled?: boolean;
  }>): ConnectorAction[] {
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
        supportsBatch: action.supportsBatch ?? false,
        supportsIteration: action.supportsIteration ?? false,
        isEnabled: action.isEnabled ?? true,
      };
    }) as ConnectorAction[];
  }

  private truncateValue(value: string, maxLength: number): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  toResponse(doc: any): IConnectorResponse {
    return {
      id: doc._id?.toString() ?? doc.id,
      slug: doc.slug,
      name: doc.name,
      description: doc.description,
      icon: doc.icon,
      color: doc.color,
      iconColor: doc.iconColor ?? 'light',
      categoryId: doc.categoryId ? doc.categoryId.toString() : null,
      categoryName: doc.categoryName ?? null,
      authType: doc.authType,
      authConfigSchema: doc.authConfigSchema ?? {},
      authSourceType: doc.authSourceType ?? 'credential',
      connectedAppKey: doc.connectedAppKey ?? '',
      runtimeAuthConfig: doc.runtimeAuthConfig ?? {},
      mcpTransportType: doc.mcpTransportType,
      mcpServerUrl: doc.mcpServerUrl,
      mcpServerConfig: doc.mcpServerConfig ?? {},
      dynamicHeaders: (doc.dynamicHeaders ?? []).map((h: any) => ({
        headerName: h.headerName,
        source: h.source,
        enabled: h.enabled ?? true,
      })),
      actions: (doc.actions ?? []).map((a: any) => ({
        key: a.key,
        label: a.label,
        description: a.description ?? '',
        parameterSchema: a.parameterSchema ?? {},
        outputSchema: a.outputSchema ?? {},
        safety: a.safety ?? 'read',
        supportsBatch: a.supportsBatch ?? false,
        supportsIteration: a.supportsIteration ?? false,
        isEnabled: a.isEnabled ?? true,
      })),
      referencedSkillIds: (doc.referencedSkillIds ?? []).map((id: any) => id.toString()),
      isActive: doc.isActive,
      createdBy: doc.createdBy?.toString() ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
