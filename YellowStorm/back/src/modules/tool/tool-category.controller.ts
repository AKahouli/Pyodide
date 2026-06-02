import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../authorization/constants/permissions';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { ToolCategoryService } from './tool-category.service';
import { CreateToolCategoryDto } from './dto/create-tool-category.dto';
import { UpdateToolCategoryDto } from './dto/update-tool-category.dto';
import { IToolCategoryResponse } from './interfaces/tool.interface';

@ApiTags('Admin Tool Categories')
@ApiBearerAuth()
@Controller('admin/tool-categories')
@UseGuards(PermissionsGuard)
export class ToolCategoryController {
  constructor(
    private readonly categoryService: ToolCategoryService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.TOOLS_READ)
  @ApiOperation({ summary: 'List all tool categories' })
  async findAll(): Promise<IToolCategoryResponse[]> {
    return this.categoryService.findAll();
  }

  @Get(':id')
  @RequirePermissions(Permissions.TOOLS_READ)
  @ApiOperation({ summary: 'Get a tool category by ID' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async findById(@Param('id') id: string): Promise<IToolCategoryResponse> {
    return this.categoryService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.TOOLS_CREATE)
  @ApiOperation({ summary: 'Create a tool category' })
  async create(
    @Body() dto: CreateToolCategoryDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<IToolCategoryResponse> {
    const category = await this.categoryService.create(dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'tool_categories.create',
      targetId: category.id,
      targetType: 'ToolCategory',
      metadata: { name: category.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return category;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.TOOLS_UPDATE)
  @ApiOperation({ summary: 'Update a tool category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateToolCategoryDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<IToolCategoryResponse> {
    const category = await this.categoryService.update(id, dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'tool_categories.update',
      targetId: id,
      targetType: 'ToolCategory',
      metadata: { changes: Object.keys(dto) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return category;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.TOOLS_DELETE)
  @ApiOperation({ summary: 'Delete a tool category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<void> {
    await this.categoryService.delete(id);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'tool_categories.delete',
      targetId: id,
      targetType: 'ToolCategory',
      metadata: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
