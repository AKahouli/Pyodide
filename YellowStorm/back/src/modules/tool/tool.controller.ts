import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ToolService } from './tool.service';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions } from '../authorization/constants/permissions';
import { CreateToolDto, UpdateToolDto, QueryToolDto } from './dto';
import { IToolResponse } from './interfaces/tool.interface';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';

@ApiTags('Admin Tools')
@ApiBearerAuth()
@Controller('admin/tools')
@UseGuards(PermissionsGuard)
export class ToolController {
  constructor(
    private readonly toolService: ToolService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.TOOLS_READ)
  @ApiOperation({ summary: 'List tools (paginated, filterable)' })
  @ApiResponse({ status: 200, description: 'Tools retrieved' })
  async findAll(@Query() query: QueryToolDto): Promise<PaginatedResponseDto<IToolResponse>> {
    return this.toolService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(Permissions.TOOLS_READ)
  @ApiOperation({ summary: 'Get tool by ID' })
  @ApiParam({ name: 'id', description: 'Tool ID' })
  @ApiResponse({ status: 200, description: 'Tool retrieved' })
  @ApiResponse({ status: 404, description: 'Tool not found' })
  async findById(@Param('id') id: string): Promise<IToolResponse> {
    return this.toolService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.TOOLS_CREATE)
  @ApiOperation({ summary: 'Create a new tool' })
  @ApiResponse({ status: 201, description: 'Tool created' })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  @ApiResponse({ status: 409, description: 'Tool name already exists' })
  async create(
    @Body() dto: CreateToolDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<IToolResponse> {
    const tool = await this.toolService.create(dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'tools.create',
      targetId: tool.id,
      targetType: 'Tool',
      metadata: { toolName: tool.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return tool;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.TOOLS_UPDATE)
  @ApiOperation({ summary: 'Update a tool' })
  @ApiParam({ name: 'id', description: 'Tool ID' })
  @ApiResponse({ status: 200, description: 'Tool updated' })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  @ApiResponse({ status: 404, description: 'Tool not found' })
  @ApiResponse({ status: 409, description: 'Tool name already exists' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateToolDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<IToolResponse> {
    const tool = await this.toolService.update(id, dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'tools.update',
      targetId: tool.id,
      targetType: 'Tool',
      metadata: { toolName: tool.name, changes: dto },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return tool;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.TOOLS_DELETE)
  @ApiOperation({ summary: 'Delete a tool' })
  @ApiParam({ name: 'id', description: 'Tool ID' })
  @ApiResponse({ status: 204, description: 'Tool deleted' })
  @ApiResponse({ status: 404, description: 'Tool not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    // Get tool name before deletion for audit log
    const tool = await this.toolService.findById(id);

    await this.toolService.delete(id);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'tools.delete',
      targetId: id,
      targetType: 'Tool',
      metadata: { toolName: tool.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
