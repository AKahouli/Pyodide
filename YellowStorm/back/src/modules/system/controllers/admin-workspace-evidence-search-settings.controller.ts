import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions, Permissions, PermissionsGuard, AuditLogService } from '../../authorization';
import type { AuthUser } from '@common/auth/auth-user';
import { UpdateWorkspaceEvidenceSearchSettingsDto } from '../dto/update-workspace-evidence-search-settings.dto';
import { WorkspaceEvidenceSearchSettingsService } from '../workspace-evidence-search-settings.service';
import type { WorkspaceEvidenceSearchConnectorOption, WorkspaceEvidenceSearchSettings } from '../interfaces/workspace-evidence-search-settings.interface';

@ApiTags('Workspace Evidence Search Settings')
@ApiBearerAuth()
@Controller('admin/workspace-settings/evidence-search')
@UseGuards(PermissionsGuard)
export class AdminWorkspaceEvidenceSearchSettingsController {
  constructor(private readonly settings: WorkspaceEvidenceSearchSettingsService, private readonly audit: AuditLogService) {}
  @Get() @RequirePermissions(Permissions.WORKSPACES_ALL)
  @ApiOperation({ summary: 'Get global workspace evidence search connector' })
  getSettings(): Promise<WorkspaceEvidenceSearchSettings> { return this.settings.getSettings(); }
  @Get('connectors') @RequirePermissions(Permissions.WORKSPACES_ALL)
  @ApiOperation({ summary: 'List active connectors available for workspace evidence search' })
  listActiveConnectors(): Promise<WorkspaceEvidenceSearchConnectorOption[]> { return this.settings.listActiveConnectorOptions(); }
  @Put() @RequirePermissions(Permissions.WORKSPACES_ALL)
  @ApiOperation({ summary: 'Set global workspace evidence search connector' })
  async updateSettings(@Body() body: UpdateWorkspaceEvidenceSearchSettingsDto, @CurrentUser() user: AuthUser, @Req() req: Request): Promise<WorkspaceEvidenceSearchSettings> {
    const result = await this.settings.updateSettings(body.connectorId ?? null);
    this.audit.logSuccess({ actorId: user._id.toString(), actorEmail: user.email, action: 'workspace.evidence_search_connector.update', metadata: { connectorId: result.connectorId }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return result;
  }
}
