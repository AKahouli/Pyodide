import { Controller, Get, Put, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { TeamAutoBuilderConfigService } from '../services/team-auto-builder-config.service';
import { AuditLogService } from '../../authorization/services/audit-log.service';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../authorization/guards/permissions.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions } from '../../authorization/constants/permissions';
import { UpsertAutoBuilderConfigDto } from '../dto';
import { ITeamAutoBuilderConfigResponse } from '../interfaces/team-auto-builder-config.interface';

@ApiTags('Admin Team Auto Builder')
@ApiBearerAuth()
@Controller('admin/teams/auto-builder-config')
@UseGuards(PermissionsGuard)
export class AdminTeamAutoBuilderController {
  constructor(
    private readonly configService: TeamAutoBuilderConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.TEAM_AUTO_BUILDER_READ)
  @ApiOperation({ summary: 'Get team auto-builder configuration' })
  async getConfig(): Promise<ITeamAutoBuilderConfigResponse | null> {
    return this.configService.getConfig();
  }

  @Put()
  @RequirePermissions(Permissions.TEAM_AUTO_BUILDER_UPDATE)
  @ApiOperation({ summary: 'Update team auto-builder configuration' })
  async upsertConfig(
    @Body() dto: UpsertAutoBuilderConfigDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<ITeamAutoBuilderConfigResponse> {
    const result = await this.configService.upsertConfig(dto);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'team_auto_builder.update_config',
      targetType: 'TeamAutoBuilderConfig',
      metadata: {
        modelId: dto.modelId,
        isEnabled: dto.isEnabled,
        temperature: dto.temperature,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }
}
