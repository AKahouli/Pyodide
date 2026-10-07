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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import type { AuthUser } from '@common/auth/auth-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../authorization/constants/permissions';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { AppBuilderTemplateCategoryService } from './services/app-builder-template-category.service';
import { CreateTemplateCategoryDto } from './dto/create-template-category.dto';
import { UpdateTemplateCategoryDto } from './dto/update-template-category.dto';
import { ITemplateCategoryResponse } from './interfaces/template-catalog.interface';

@ApiTags('Admin Conversation V2 Template Categories')
@ApiBearerAuth()
// `/app-builder` is canonical; `/conversation-v2` is a deprecated alias kept so existing clients,
// bookmarked URLs and integrations keep working. Remove once legacy traffic has stopped.
@Controller(['admin/app-builder/template-categories', 'admin/conversation-v2/template-categories'])

@UseGuards(PermissionsGuard)
export class AdminTemplateCategoryController {
  constructor(
    private readonly categories: AppBuilderTemplateCategoryService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all template categories' })
  async findAll(): Promise<ITemplateCategoryResponse[]> {
    return this.categories.findAll();
  }

  @Get(':id')
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get a template category by ID' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async findById(@Param('id') id: string): Promise<ITemplateCategoryResponse> {
    return this.categories.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a template category' })
  async create(
    @Body() dto: CreateTemplateCategoryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ITemplateCategoryResponse> {
    const category = await this.categories.create(dto);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      // Audit identifiers are persisted: `action`/`targetType` values are frozen
      // (same policy as `ERR_380x` codes and the `conversation_v2` DB schema).
      action: 'conversation_v2_template_categories.create',
      targetId: category.id,
      targetType: 'ConversationV2TemplateCategory',
      metadata: { name: category.name, slug: category.slug },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return category;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a template category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateCategoryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ITemplateCategoryResponse> {
    const category = await this.categories.update(id, dto);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_template_categories.update',
      targetId: id,
      targetType: 'ConversationV2TemplateCategory',
      metadata: { changes: Object.keys(dto) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return category;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Delete a template category and its templates; Ceph cover/manifest cleanup continues in the background',
  })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.categories.delete(id);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_template_categories.delete',
      targetId: id,
      targetType: 'ConversationV2TemplateCategory',
      metadata: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
