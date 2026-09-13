import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { InternalWhatsAppSendDto } from '../dto/internal-whatsapp-send.dto';
import { InternalWhatsAppStatusDto } from '../dto/internal-whatsapp-status.dto';
import {
  WhatsAppInternalSendService,
} from '../services/whatsapp-internal-send.service';

/**
 * Service-to-service send surface for the standalone WhatsApp Send MCP
 * façade. Never publicly routable: internal network + X-Internal-Token
 * (INTERNAL_SERVICE_SECRET) only. agentId is trusted here because the MCP
 * extracted it from its signed per-run Bearer JWT; ownership is re-validated
 * against agent_whatsapp_integrations before any socket is touched.
 *
 * Responses skip the global `{ success, data, meta }` wrapper: the MCP reads
 * `messageId` / `status` off the raw body.
 */
@Public()
@SkipResponseWrap()
@ApiTags('WhatsApp (Internal)')
@Controller('internal/whatsapp')
@UseGuards(InternalServiceGuard)
export class WhatsAppInternalController {
  constructor(private readonly internalSend: WhatsAppInternalSendService) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a proactive WhatsApp message on an agent’s paired session (internal)' })
  @ApiHeader({ name: 'X-Internal-Token', required: true })
  send(@Body() dto: InternalWhatsAppSendDto) {
    return this.internalSend.send({ agentId: dto.agentId, to: dto.to, text: dto.text });
  }

  @Post('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read an agent’s WhatsApp integration status (internal)' })
  @ApiHeader({ name: 'X-Internal-Token', required: true })
  status(@Body() dto: InternalWhatsAppStatusDto) {
    return this.internalSend.getStatus(dto.agentId);
  }
}
