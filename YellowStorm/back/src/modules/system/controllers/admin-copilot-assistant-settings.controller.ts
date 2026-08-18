import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuditLogService, Permissions, PermissionsGuard, RequirePermissions } from '../../authorization';
import type { UserDocument } from '../../user/schemas/user.schema';
import { CopilotAssistantSettingsService } from '../copilot-assistant-settings.service';
import { UpdateCopilotAssistantSettingsDto } from '../dto/update-copilot-assistant-settings.dto';
import type {
  CopilotAssistantAgentOption,
  CopilotAssistantSettings,
} from '../interfaces/copilot-assistant-settings.interface';

@ApiTags('Copilot Assistant Settings')
@ApiBearerAuth()
@Controller('admin/copilot-assistant')
@UseGuards(PermissionsGuard)
export class AdminCopilotAssistantSettingsController {
  constructor(
    private readonly settings: CopilotAssistantSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.SYSTEM_ALL)
  @ApiOperation({ summary: 'Get the agent mapped to the Copilot assistant' })
  getSettings(): Promise<CopilotAssistantSettings> {
    return this.settings.getSettings();
  }

  @Get('agents')
  @RequirePermissions(Permissions.SYSTEM_ALL)
  @ApiOperation({ summary: 'List active default agents eligible for the Copilot assistant' })
  listAgents(): Promise<CopilotAssistantAgentOption[]> {
    return this.settings.listActiveAgentOptions();
  }

  @Put()
  @RequirePermissions(Permissions.SYSTEM_ALL)
  @ApiOperation({ summary: 'Map an agent to the Copilot assistant' })
  async updateSettings(
    @Body() body: UpdateCopilotAssistantSettingsDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<CopilotAssistantSettings> {
    const auditBase = {
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'copilot.assistant.agent.update',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    try {
      const result = await this.settings.updateSettings(body);
      this.audit.logSuccess({ ...auditBase, metadata: { agentId: result.agentId } });
      return result;
    } catch (error) {
      this.audit.logFailure({
        ...auditBase,
        failureReason: error instanceof Error ? error.message : 'Copilot assistant settings update failed',
      });
      throw error;
    }
  }
}
