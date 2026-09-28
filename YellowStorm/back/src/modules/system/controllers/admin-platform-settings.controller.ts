import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RequirePermissions, Permissions, PermissionsGuard, AuditLogService } from '../../authorization';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { UpdatePlatformSettingsDto } from '../dto/update-platform-settings.dto';
import { PlatformSettingsService } from '../platform-settings.service';
import { DEFAULT_PLATFORM_SETTINGS } from '../constants/platform-settings.constants';
import type { PlatformSettings } from '../platform-settings.service';

@ApiTags('Platform Settings')
@ApiBearerAuth()
@Controller('admin/platform-settings')
@UseGuards(PermissionsGuard)
export class AdminPlatformSettingsController {
  constructor(
    private readonly settingsService: PlatformSettingsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get platform settings',
    description: 'Returns runtime-tunable platform settings (rate limiting, session limits, upload limits).',
  })
  @ApiResponse({ status: 200, description: 'Platform settings retrieved' })
  @RequirePermissions(Permissions.SYSTEM_ALL)
  async getSettings(): Promise<PlatformSettings> {
    return this.settingsService.getSettings();
  }

  @Get('defaults')
  @ApiOperation({
    summary: 'Get platform setting defaults',
    description: 'Returns the built-in defaults used when a setting has not been overridden.',
  })
  @ApiResponse({ status: 200, description: 'Defaults retrieved' })
  @RequirePermissions(Permissions.SYSTEM_ALL)
  getDefaults(): typeof DEFAULT_PLATFORM_SETTINGS {
    return DEFAULT_PLATFORM_SETTINGS;
  }

  @Put()
  @ApiOperation({
    summary: 'Update platform settings',
    description: 'Partially updates runtime-tunable platform settings. Omitted fields keep their current value.',
  })
  @ApiResponse({ status: 200, description: 'Platform settings updated' })
  @RequirePermissions(Permissions.SYSTEM_ALL)
  async updateSettings(
    @Body() body: UpdatePlatformSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<PlatformSettings> {
    const result = await this.settingsService.updateSettings(body, user._id.toString());

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.platform_settings.update',
      metadata: { sections: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }
}
