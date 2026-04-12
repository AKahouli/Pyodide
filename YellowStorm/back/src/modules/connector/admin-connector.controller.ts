import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../authorization/constants/permissions';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuditLogService } from '../authorization/services/audit-log.service';
import {
  CreateConnectorDto,
  QueryConnectorDto,
  UpdateConnectorDto,
} from './dto';
import { IConnectorResponse, IMcpInspectResult } from './interfaces/connector.interface';
import { ConnectorService } from './connector.service';

@ApiTags('Admin Connectors')
@ApiBearerAuth()
@Controller('admin/connectors')
@UseGuards(PermissionsGuard)
export class AdminConnectorController {
  constructor(
    private readonly connectorService: ConnectorService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.CONNECTORS_READ)
  @ApiOperation({ summary: 'List connectors (paginated)' })
  async findAll(@Query() query: QueryConnectorDto): Promise<PaginatedResponseDto<IConnectorResponse>> {
    return this.connectorService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(Permissions.CONNECTORS_READ)
  @ApiOperation({ summary: 'Get a connector by ID' })
  @ApiParam({ name: 'id', description: 'Connector ID' })
  async findById(@Param('id') id: string): Promise<IConnectorResponse> {
    return this.connectorService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.CONNECTORS_CREATE)
  @ApiOperation({ summary: 'Create a connector' })
  async create(
    @Body() dto: CreateConnectorDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<IConnectorResponse> {
    const connector = await this.connectorService.create(user._id.toString(), dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'connectors.create',
      targetId: connector.id,
      targetType: 'Connector',
      metadata: { connectorSlug: connector.slug, connectorName: connector.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return connector;
  }

  @Post('inspect')
  @RequirePermissions(Permissions.CONNECTORS_READ)
  @ApiOperation({ summary: 'Inspect an MCP server to discover available tools' })
  async inspectMcp(
    @Body() body: { transportType: string; serverUrl: string; serverConfig?: Record<string, unknown> },
  ): Promise<IMcpInspectResult> {
    return this.connectorService.inspectMcp(body.transportType, body.serverUrl, body.serverConfig);
  }

  @Post('import-mcp')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.CONNECTORS_CREATE)
  @ApiOperation({ summary: 'Inspect an MCP server and import its tools as a new connector' })
  async importFromMcp(
    @Body() body: { transportType: string; serverUrl: string; serverConfig?: Record<string, unknown> },
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<IMcpInspectResult> {
    const result = await this.connectorService.importFromMcp(
      user._id.toString(),
      body.transportType,
      body.serverUrl,
      body.serverConfig,
    );
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'connectors.import_mcp',
      targetId: '',
      targetType: 'Connector',
      metadata: { serverUrl: body.serverUrl, toolCount: result.tools.length },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.CONNECTORS_UPDATE)
  @ApiOperation({ summary: 'Update a connector' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConnectorDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<IConnectorResponse> {
    const connector = await this.connectorService.update(id, dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'connectors.update',
      targetId: id,
      targetType: 'Connector',
      metadata: { changes: Object.keys(dto) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return connector;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.CONNECTORS_DELETE)
  @ApiOperation({ summary: 'Delete a connector' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<void> {
    const connector = await this.connectorService.findById(id);
    await this.connectorService.delete(id);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'connectors.delete',
      targetId: id,
      targetType: 'Connector',
      metadata: { connectorSlug: connector.slug },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
