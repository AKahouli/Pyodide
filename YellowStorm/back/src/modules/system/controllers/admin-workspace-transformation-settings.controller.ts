import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuditLogService, Permissions, PermissionsGuard, RequirePermissions } from '../../authorization';
import type { AuthUser } from '@common/auth/auth-user';
import { UpdateWorkspaceTransformationSettingsDto } from '../dto/update-workspace-transformation-settings.dto';
import type { WorkspaceTransformationAgentOption, WorkspaceTransformationSettings } from '../interfaces/workspace-transformation-settings.interface';
import { WorkspaceTransformationSettingsService } from '../workspace-transformation-settings.service';

@ApiTags('Workspace Transformation Settings')
@ApiBearerAuth()
@Controller('admin/workspace-settings/transformations')
@UseGuards(PermissionsGuard)
export class AdminWorkspaceTransformationSettingsController {
  constructor(private readonly settings: WorkspaceTransformationSettingsService, private readonly audit: AuditLogService) {}
  @Get() @RequirePermissions(Permissions.WORKSPACES_ALL)
  @ApiOperation({ summary: 'Get global Workspace transformation settings' })
  getSettings(): Promise<WorkspaceTransformationSettings> { return this.settings.getSettings(); }
  @Get('agents') @RequirePermissions(Permissions.WORKSPACES_ALL)
  @ApiOperation({ summary: 'List active default agents available for Workspace transformations' })
  listAgents(): Promise<WorkspaceTransformationAgentOption[]> { return this.settings.listActiveAgentOptions(); }
  @Put() @RequirePermissions(Permissions.WORKSPACES_ALL)
  @ApiOperation({ summary: 'Set the global decision-flow generation agent' })
  async updateSettings(@Body() body: UpdateWorkspaceTransformationSettingsDto, @CurrentUser() user: AuthUser, @Req() req: Request): Promise<WorkspaceTransformationSettings> {
    const result = await this.settings.updateSettings(body.decisionFlowAgentId ?? null);
    this.audit.logSuccess({ actorId: user._id.toString(), actorEmail: user.email, action: 'workspace.decision_flow_agent.update', metadata: { decisionFlowAgentId: result.decisionFlowAgentId }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return result;
  }
}
