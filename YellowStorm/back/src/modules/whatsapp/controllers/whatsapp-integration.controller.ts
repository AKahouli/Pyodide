import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { WhatsAppConnectResponseDto } from '../dto/whatsapp-connect-response.dto';
import { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';
import { WhatsAppPairingResponseDto } from '../dto/whatsapp-pairing-response.dto';
import { UpdateWhatsAppEnabledDto } from '../dto/update-whatsapp-enabled.dto';
import { WhatsAppConnectionService } from '../services/whatsapp-connection.service';
import { WhatsAppIntegrationService } from '../services/whatsapp-integration.service';
import { AgentPermissionGuard } from '@modules/agent/guards/agent-permission.guard';
import { RequireAgentPermission } from '@modules/agent/decorators/require-agent-permission.decorator';

@ApiTags('Agent WhatsApp Integration')
@ApiBearerAuth()
@Controller('agents/:agentId/whatsapp-integration')
export class WhatsAppIntegrationController {
  constructor(
    private readonly integrationService: WhatsAppIntegrationService,
    private readonly connectionService: WhatsAppConnectionService,
  ) {}

  @Get()
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('read')
  @ApiOperation({ summary: 'Get WhatsApp integration status for an agent' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async getIntegration(
    @CurrentUser() user: AuthUser,
    @Param('agentId') agentId: string,
  ): Promise<WhatsAppIntegrationResponseDto | null> {
    return this.integrationService.getByAgentForUser(user._id.toString(), agentId);
  }

  @Post('auto-recover')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Notify backend to auto-reconnect after FAILED status' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async autoRecover(
    @CurrentUser() user: AuthUser,
    @Param('agentId') agentId: string,
  ): Promise<WhatsAppIntegrationResponseDto> {
    return this.connectionService.autoRecover(user._id.toString(), agentId);
  }

  @Post('connect')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start WhatsApp pairing for this agent' })
  @ApiResponse({ status: 200, type: WhatsAppConnectResponseDto })
  async connect(
    @CurrentUser() user: AuthUser,
    @Param('agentId') agentId: string,
  ): Promise<WhatsAppConnectResponseDto> {
    return this.connectionService.connect(user._id.toString(), agentId);
  }

  @Patch('enabled')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @ApiOperation({ summary: 'Enable or disable WhatsApp for this agent deployment' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async updateEnabled(
    @CurrentUser() user: AuthUser,
    @Param('agentId') agentId: string,
    @Body() body: UpdateWhatsAppEnabledDto,
  ): Promise<WhatsAppIntegrationResponseDto> {
    return this.integrationService.updateEnabled(user._id.toString(), agentId, body.enabled);
  }

  @Get(':sessionId/pairing')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @ApiOperation({ summary: 'Get latest QR / pairing code for a session' })
  @ApiResponse({ status: 200, type: WhatsAppPairingResponseDto })
  async getPairing(
    @CurrentUser() user: AuthUser,
    @Param('agentId') agentId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<WhatsAppPairingResponseDto> {
    return this.connectionService.getPairing(user._id.toString(), agentId, sessionId);
  }

  @Post(':sessionId/reconnect')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconnect WhatsApp using stored auth' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async reconnect(
    @CurrentUser() user: AuthUser,
    @Param('agentId') agentId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<WhatsAppIntegrationResponseDto> {
    return this.connectionService.reconnect(user._id.toString(), agentId, sessionId);
  }

  @Delete(':sessionId')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect WhatsApp session' })
  async disconnectSession(
    @CurrentUser() user: AuthUser,
    @Param('agentId') agentId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.connectionService.disconnectSession(user._id.toString(), agentId, sessionId);
  }

  @Delete()
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove WhatsApp integration for this agent' })
  async deleteIntegration(
    @CurrentUser() user: AuthUser,
    @Param('agentId') agentId: string,
  ): Promise<void> {
    await this.connectionService.deleteIntegration(user._id.toString(), agentId);
  }
}
