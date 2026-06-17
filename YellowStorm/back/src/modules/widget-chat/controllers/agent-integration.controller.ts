import { Controller, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipMaintenance } from '@modules/system/decorators/skip-maintenance.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WidgetTokenGuard } from '../guards/widget-token.guard';
import { WidgetChatService } from '../services/widget-chat.service';
import { WidgetSendMessageDto } from '../dto/widget-chat.dto';

interface IntegrationRequest extends Request {
  widgetTokenHash?: string;
  widgetAgentId?: string;
  widgetAgent?: any;
}

/**
 * Public REST API for external backends (JSON in / JSON out).
 * Not the embed widget routes under /widget/*.
 */
@ApiTags('Agent Integration (REST)')
@Controller('integrations/agents')
export class AgentIntegrationController {
  constructor(private readonly widgetChatService: WidgetChatService) {}

  @Post(':agentId/messages')
  @Public()
  @SkipMaintenance()
  @UseGuards(WidgetTokenGuard)
  @RateLimit({ limit: 15, windowMs: 60000, keyPrefix: 'agent-integration-message' })
  async sendMessage(
    @Param('agentId') agentId: string,
    @Body() dto: WidgetSendMessageDto,
    @Req() req: IntegrationRequest,
  ) {
    if (req.widgetAgentId !== agentId) {
      throw new ForbiddenException(
        ErrorCode.WIDGET_AGENT_NOT_FOUND,
        'Token does not match the requested agent',
      );
    }

    return this.widgetChatService.sendIntegrationMessage({
      tokenHash: req.widgetTokenHash!,
      agentId,
      message: dto.message,
      visitorId: dto.visitorId || 'anonymous',
      agent: req.widgetAgent,
      metadata: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        origin: req.headers.origin,
      },
    });
  }
}
