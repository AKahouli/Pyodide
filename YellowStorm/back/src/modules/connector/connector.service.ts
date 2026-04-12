import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { escapeRegex } from '../../common/utils';
import { BadRequestException, ConflictException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { CreateConnectorDto, QueryConnectorDto, UpdateConnectorDto } from './dto';
import {
  Connector,
  ConnectorDocument,
  ConnectorAction,
} from './schemas/connector.schema';
import { IConnectorResponse, IMcpInspectResult } from './interfaces/connector.interface';

@Injectable()
export class ConnectorService {
  constructor(
    @InjectModel(Connector.name)
    private readonly connectorModel: Model<ConnectorDocument>,
    private readonly logger: LoggerService,
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

    const actions = (dto.actions ?? []).map((a) => ({
      key: a.key,
      label: a.label,
      description: a.description ?? '',
      parameterSchema: a.parameterSchema ?? {},
      outputSchema: a.outputSchema ?? {},
      safety: a.safety ?? 'read',
      supportsBatch: a.supportsBatch ?? false,
      supportsIteration: a.supportsIteration ?? false,
      isEnabled: a.isEnabled ?? true,
    }));

    const connector = await this.connectorModel.create({
      slug: dto.slug,
      name: dto.name,
      description: dto.description,
      icon: dto.icon ?? '',
      color: dto.color ?? '',
      authType: dto.authType ?? 'none',
      authConfigSchema: dto.authConfigSchema ?? {},
      authSourceType: dto.authSourceType ?? 'credential',
      connectedAppKey: dto.connectedAppKey ?? '',
      runtimeAuthConfig: dto.runtimeAuthConfig ?? {},
      mcpTransportType: dto.mcpTransportType ?? 'streamable_http',
      mcpServerUrl: dto.mcpServerUrl ?? '',
      mcpServerConfig: dto.mcpServerConfig ?? {},
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

  async findAllActive(): Promise<IConnectorResponse[]> {
    const connectors = await this.connectorModel
      .find({ isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();

    return connectors.map((c) => this.toResponse(c));
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
      (updateData as Record<string, unknown>).actions = dto.actions.map((a) => ({
        key: a.key,
        label: a.label,
        description: a.description ?? '',
        parameterSchema: a.parameterSchema ?? {},
        outputSchema: a.outputSchema ?? {},
        safety: a.safety ?? 'read',
        supportsBatch: a.supportsBatch ?? false,
        supportsIteration: a.supportsIteration ?? false,
        isEnabled: a.isEnabled ?? true,
      }));
    }
    if (dto.referencedSkillIds) {
      (updateData as Record<string, unknown>).referencedSkillIds = dto.referencedSkillIds.map(
        (id) => new Types.ObjectId(id),
      );
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

    await this.connectorModel.updateOne(
      { slug: this.slugify(inspectResult.serverName), createdBy: new Types.ObjectId(createdBy) },
      {
        $set: {
          name: inspectResult.serverName,
          description: `MCP connector imported from ${serverUrl}`,
          mcpTransportType: transportType,
          mcpServerUrl: serverUrl,
          mcpServerConfig: serverConfig ?? {},
          actions,
        },
        $setOnInsert: {
          slug: this.slugify(inspectResult.serverName),
          authType: 'none',
          authConfigSchema: {},
          referencedSkillIds: [],
          isActive: true,
          createdBy: new Types.ObjectId(createdBy),
        },
      },
      { upsert: true },
    ).exec();

    return inspectResult;
  }

  async inspectMcp(transportType: string, serverUrl: string, serverConfig?: Record<string, unknown>): Promise<IMcpInspectResult> {
    try {
      this.logger.log('Inspecting MCP server', { transportType, serverUrl });

      let client: any;
      let transport: any;

      if (transportType === 'sse') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sseMod = await import('@modelcontextprotocol/sdk/client/sse.js').catch(() => null);
        if (!sseMod) {
          return { serverName: '', tools: [], error: 'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk' };
        }
        const SSEClientTransport = sseMod.SSEClientTransport;
        transport = new SSEClientTransport(new URL(serverUrl));
      } else if (transportType === 'streamable_http') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const httpMod = await import('@modelcontextprotocol/sdk/client/streamableHttp.js').catch(() => null);
        if (!httpMod) {
          return { serverName: '', tools: [], error: 'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk' };
        }
        const StreamableHTTPClientTransport = httpMod.StreamableHTTPClientTransport;
        transport = new StreamableHTTPClientTransport(new URL(serverUrl));
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
      .replace(/_/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }

  toResponse(doc: any): IConnectorResponse {
    return {
      id: doc._id?.toString() ?? doc.id,
      slug: doc.slug,
      name: doc.name,
      description: doc.description,
      icon: doc.icon,
      color: doc.color,
      authType: doc.authType,
      authConfigSchema: doc.authConfigSchema ?? {},
      authSourceType: doc.authSourceType ?? 'credential',
      connectedAppKey: doc.connectedAppKey ?? '',
      runtimeAuthConfig: doc.runtimeAuthConfig ?? {},
      mcpTransportType: doc.mcpTransportType,
      mcpServerUrl: doc.mcpServerUrl,
      mcpServerConfig: doc.mcpServerConfig ?? {},
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
