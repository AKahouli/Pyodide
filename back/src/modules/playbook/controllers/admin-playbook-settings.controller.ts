import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { AuditLogService, Permissions, PermissionsGuard, RequirePermissions } from '../../authorization';
import { UpdateAdminPlaybookSettingsDto } from '../dto/playbook-settings.dto';
import { PlaybookSettingsService } from '../services/playbook-settings.service';

@ApiTags('Admin Playbook Settings')
@ApiBearerAuth()
@Controller('admin/playbook-settings')
@UseGuards(PermissionsGuard)
export class AdminPlaybookSettingsController {
  constructor(
    private readonly playbookSettingsService: PlaybookSettingsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @ApiOperation({ summary: 'Get admin playbook inference settings' })
  @ApiResponse({ status: 200, description: 'Admin playbook settings retrieved' })
  async getSettings() {
    return this.playbookSettingsService.getAdminSettings();
  }

  @Post()
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @ApiOperation({ summary: 'Update admin playbook inference settings' })
  @ApiResponse({ status: 200, description: 'Admin playbook settings updated' })
  async updateSettings(
    @Body() dto: UpdateAdminPlaybookSettingsDto,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ) {
    const settings = await this.playbookSettingsService.updateAdminSettings(dto);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'playbook.settings.update',
      targetType: 'PlaybookSettings',
      metadata: settings as unknown as Record<string, unknown>,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return settings;
  }
}
