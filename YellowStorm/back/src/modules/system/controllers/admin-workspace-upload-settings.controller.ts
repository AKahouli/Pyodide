import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { RequirePermissions, Permissions, PermissionsGuard, AuditLogService } from '../../authorization';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { UpdateWorkspaceUploadSettingsDto } from '../dto/update-workspace-upload-settings.dto';
import { WorkspaceUploadSettingsService } from '../workspace-upload-settings.service';
import type { WorkspaceUploadSettings } from '../interfaces/workspace-upload-settings.interface';

@ApiTags('Workspace Upload Settings')
@ApiBearerAuth()
@Controller('admin/workspace-settings/uploads')
@UseGuards(PermissionsGuard)
export class AdminWorkspaceUploadSettingsController {
  constructor(
    private readonly settingsService: WorkspaceUploadSettingsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get allowed workspace upload extensions',
    description: 'Returns the global list of file extensions authorized for upload.',
  })
  @ApiResponse({ status: 200, description: 'Upload settings retrieved' })
  @RequirePermissions(Permissions.WORKSPACES_ALL)
  async getSettings(): Promise<WorkspaceUploadSettings> {
    return this.settingsService.getSettings();
  }

  @Put()
  @ApiOperation({
    summary: 'Update allowed workspace upload extensions',
    description:
      'Replaces the global list of file extensions authorized for upload. ' +
      'Backend rejects entries it does not know how to validate.',
  })
  @ApiResponse({ status: 200, description: 'Upload settings updated' })
  @RequirePermissions(Permissions.WORKSPACES_ALL)
  async updateSettings(
    @Body() body: UpdateWorkspaceUploadSettingsDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<WorkspaceUploadSettings> {
    const result = await this.settingsService.updateSettings(
      body.allowedExtensions,
      user._id.toString(),
    );

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'workspace.upload_settings.update',
      metadata: { count: result.allowedExtensions.length },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }
}
