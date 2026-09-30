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
  Put,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import type { AuthUser } from '@common/auth/auth-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../authorization/constants/permissions';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { ConversationV2TemplateService } from './services/conversation-v2-template.service';
import { MulterFile } from './interfaces/multer-file.interface';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { ITemplateResponse } from './interfaces/template-catalog.interface';
import { TEMPLATE_MAX_ZIP_BYTES } from './constants/template-catalog.constants';

interface TemplateFiles {
  zip?: MulterFile[];
  cover?: MulterFile[];
}

const multipartLimits = {
  limits: { fileSize: TEMPLATE_MAX_ZIP_BYTES, files: 2, fields: 10 },
};

@ApiTags('Admin Conversation V2 Templates')
@ApiBearerAuth()
@Controller('admin/conversation-v2/templates')
@UseGuards(PermissionsGuard)
export class AdminTemplateController {
  constructor(
    private readonly templates: ConversationV2TemplateService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all templates (any status)' })
  async findAll(): Promise<ITemplateResponse[]> {
    return this.templates.listAll();
  }

  @Post('staging/publish')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'zip', maxCount: 1 }], multipartLimits))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { zip: { type: 'string', format: 'binary' } },
      required: ['zip'],
    },
  })
  @ApiOperation({ summary: 'Publish a ZIP to Ceph for ephemeral NodePod validation' })
  async publishStaging(
    @UploadedFiles() files: TemplateFiles | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<{ stagingTemplateId: string }> {
    const result = await this.templates.publishStagingZip(files?.zip?.[0]);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_templates.staging_publish',
      targetId: result.stagingTemplateId,
      targetType: 'ConversationV2TemplateStaging',
      metadata: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Delete('staging/:stagingTemplateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remove a staging template manifest after validation' })
  @ApiParam({ name: 'stagingTemplateId', description: 'Ephemeral staging template id' })
  async discardStaging(
    @Param('stagingTemplateId') stagingTemplateId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.templates.discardStagingZip(stagingTemplateId);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_templates.staging_discard',
      targetId: stagingTemplateId,
      targetType: 'ConversationV2TemplateStaging',
      metadata: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get(':id')
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get a template by ID' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async findById(@Param('id') id: string): Promise<ITemplateResponse> {
    return this.templates.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'zip', maxCount: 1 },
        { name: 'cover', maxCount: 1 },
      ],
      multipartLimits,
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        categoryId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        zip: { type: 'string', format: 'binary' },
        cover: { type: 'string', format: 'binary' },
      },
      required: ['categoryId', 'title', 'zip', 'cover'],
    },
  })
  @ApiOperation({ summary: 'Create a template from a source ZIP and a cover image' })
  async create(
    @Body() dto: CreateTemplateDto,
    @UploadedFiles() files: TemplateFiles | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ITemplateResponse> {
    const template = await this.templates.create(dto, files?.zip?.[0], files?.cover?.[0]);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_templates.create',
      targetId: template.id,
      targetType: 'ConversationV2Template',
      metadata: { title: template.title, revisionId: template.revisionId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return template;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update template metadata' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ITemplateResponse> {
    const template = await this.templates.update(id, dto);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_templates.update',
      targetId: id,
      targetType: 'ConversationV2Template',
      metadata: { changes: Object.keys(dto) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return template;
  }

  @Put(':id/cover')
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'cover', maxCount: 1 }], multipartLimits))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { cover: { type: 'string', format: 'binary' } },
      required: ['cover'],
    },
  })
  @ApiOperation({ summary: 'Replace a template cover image' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async replaceCover(
    @Param('id') id: string,
    @UploadedFiles() files: TemplateFiles | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ITemplateResponse> {
    const template = await this.templates.replaceCover(id, files?.cover?.[0]);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_templates.replace_cover',
      targetId: id,
      targetType: 'ConversationV2Template',
      metadata: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return template;
  }

  @Put(':id/source')
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'zip', maxCount: 1 }], multipartLimits))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { zip: { type: 'string', format: 'binary' } },
      required: ['zip'],
    },
  })
  @ApiOperation({ summary: 'Replace a template source ZIP and re-publish it' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async replaceSource(
    @Param('id') id: string,
    @UploadedFiles() files: TemplateFiles | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ITemplateResponse> {
    const template = await this.templates.replaceSource(id, files?.zip?.[0]);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_templates.replace_source',
      targetId: id,
      targetType: 'ConversationV2Template',
      metadata: { revisionId: template.revisionId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return template;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Delete a template; Ceph cover/manifest cleanup continues in the background',
  })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.templates.delete(id);
    this.auditLogService.logSuccess({
      actorId: user._id,
      actorEmail: user.email,
      action: 'conversation_v2_templates.delete',
      targetId: id,
      targetType: 'ConversationV2Template',
      metadata: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
