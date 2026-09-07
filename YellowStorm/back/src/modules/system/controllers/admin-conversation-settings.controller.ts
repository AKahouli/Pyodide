import { Body, Controller, Get, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuditLogService, Permissions, PermissionsGuard, RequirePermissions } from '../../authorization';
import type { UserDocument } from '../../user/schemas/user.schema';
import { ConversationSettingsService } from '../conversation-settings.service';
import { UpdateConversationSettingsDto, UpdateSensitiveTextRedactionDto } from '../dto/update-conversation-settings.dto';
import type { ConversationSettings, ConversationSettingsAgentOption } from '../interfaces/conversation-settings.interface';

@ApiTags('Conversation Settings')
@ApiBearerAuth()
@Controller('admin/conversation-settings')
@UseGuards(PermissionsGuard)
export class AdminConversationSettingsController {
  constructor(
    private readonly settings: ConversationSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.CONVERSATIONS_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Get global conversation settings' })
  getSettings(): Promise<ConversationSettings> {
    return this.settings.getSettings();
  }

  @Get('agents')
  @RequirePermissions(Permissions.CONVERSATIONS_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'List active default agents available for conversation features' })
  listAgents(): Promise<ConversationSettingsAgentOption[]> {
    return this.settings.listActiveAgentOptions();
  }

  @Put()
  @RequirePermissions(Permissions.CONVERSATIONS_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update global conversation settings' })
  async updateSettings(
    @Body() body: UpdateConversationSettingsDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<ConversationSettings> {
    const auditBase = {
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'conversations.settings.update',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    try {
      const result = await this.settings.updateSettings(body);
      this.audit.logSuccess({
        ...auditBase,
        metadata: {
          composerSuggestions: result.composerSuggestions,
          latencyInstrumentationEnabled: result.latencyInstrumentationEnabled,
        },
      });
      return result;
    } catch (error) {
      this.audit.logFailure({
        ...auditBase,
        failureReason: error instanceof Error ? error.message : 'Conversation settings update failed',
      });
      throw error;
    }
  }

  @Patch('sensitive-text-redaction')
  @RequirePermissions(Permissions.CONVERSATIONS_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update sensitive text redaction for authenticated conversations' })
  async updateSensitiveTextRedaction(
    @Body() body: UpdateSensitiveTextRedactionDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<ConversationSettings> {
    const auditBase = {
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'conversations.sensitive_text_redaction.update',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    try {
      const result = await this.settings.updateSensitiveTextRedaction(body.redactSensitiveText);
      this.audit.logSuccess({ ...auditBase, metadata: { redactSensitiveText: result.redactSensitiveText } });
      return result;
    } catch (error) {
      this.audit.logFailure({
        ...auditBase,
        failureReason: error instanceof Error ? error.message : 'Sensitive text redaction update failed',
      });
      throw error;
    }
  }
}
