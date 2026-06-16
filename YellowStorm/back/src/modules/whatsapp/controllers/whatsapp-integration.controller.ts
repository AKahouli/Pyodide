import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { WhatsAppConnectResponseDto } from '../dto/whatsapp-connect-response.dto';
import { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';
import { WhatsAppPairingResponseDto } from '../dto/whatsapp-pairing-response.dto';
import { WhatsAppConnectionService } from '../services/whatsapp-connection.service';
import { WhatsAppIntegrationService } from '../services/whatsapp-integration.service';

@ApiTags('Agent WhatsApp Integration')
@ApiBearerAuth()
@Controller('agents/:agentId/whatsapp-integration')
export class WhatsAppIntegrationController {
  constructor(
    private readonly integrationService: WhatsAppIntegrationService,
    private readonly connectionService: WhatsAppConnectionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get WhatsApp integration status for an agent' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async getIntegration(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
  ): Promise<WhatsAppIntegrationResponseDto | null> {
    return this.integrationService.getByAgentForUser(user._id.toString(), agentId);
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start WhatsApp pairing for this agent' })
  @ApiResponse({ status: 200, type: WhatsAppConnectResponseDto })
  async connect(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
  ): Promise<WhatsAppConnectResponseDto> {
    return this.connectionService.connect(user._id.toString(), agentId);
  }

  @Get(':sessionId/pairing')
  @ApiOperation({ summary: 'Get latest QR / pairing code for a session' })
  @ApiResponse({ status: 200, type: WhatsAppPairingResponseDto })
  async getPairing(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<WhatsAppPairingResponseDto> {
    return this.connectionService.getPairing(user._id.toString(), agentId, sessionId);
  }

  @Post(':sessionId/reconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconnect WhatsApp using stored auth' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async reconnect(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<WhatsAppIntegrationResponseDto> {
    return this.connectionService.reconnect(user._id.toString(), agentId, sessionId);
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect WhatsApp session' })
  async disconnectSession(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.connectionService.disconnectSession(user._id.toString(), agentId, sessionId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove WhatsApp integration for this agent' })
  async deleteIntegration(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
  ): Promise<void> {
    await this.connectionService.deleteIntegration(user._id.toString(), agentId);
  }
}
