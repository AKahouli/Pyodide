import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../authorization/constants/permissions';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { ConnectorCategoryService } from './connector-category.service';
import { CreateConnectorCategoryDto } from './dto/create-connector-category.dto';
import { UpdateConnectorCategoryDto } from './dto/update-connector-category.dto';
import { IConnectorCategoryResponse } from './interfaces/connector.interface';

@ApiTags('Admin Connector Categories')
@ApiBearerAuth()
@Controller('admin/connector-categories')
@UseGuards(PermissionsGuard)
export class AdminConnectorCategoryController {
  constructor(
    private readonly categoryService: ConnectorCategoryService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.CONNECTORS_READ)
  @ApiOperation({ summary: 'List all connector categories' })
  async findAll(): Promise<IConnectorCategoryResponse[]> {
    return this.categoryService.findAll();
  }

  @Get(':id')
  @RequirePermissions(Permissions.CONNECTORS_READ)
  @ApiOperation({ summary: 'Get a connector category by ID' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async findById(@Param('id') id: string): Promise<IConnectorCategoryResponse> {
    return this.categoryService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.CONNECTORS_CREATE)
  @ApiOperation({ summary: 'Create a connector category' })
  async create(
    @Body() dto: CreateConnectorCategoryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<IConnectorCategoryResponse> {
    const category = await this.categoryService.create(user._id.toString(), dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'connector_categories.create',
      targetId: category.id,
      targetType: 'ConnectorCategory',
      metadata: { name: category.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return category;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.CONNECTORS_UPDATE)
  @ApiOperation({ summary: 'Update a connector category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConnectorCategoryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<IConnectorCategoryResponse> {
    const category = await this.categoryService.update(id, dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'connector_categories.update',
      targetId: id,
      targetType: 'ConnectorCategory',
      metadata: { changes: Object.keys(dto) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return category;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.CONNECTORS_DELETE)
  @ApiOperation({ summary: 'Delete a connector category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.categoryService.delete(id);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'connector_categories.delete',
      targetId: id,
      targetType: 'ConnectorCategory',
      metadata: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
