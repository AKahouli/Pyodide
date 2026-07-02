import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { UserDocument } from '@modules/user/schemas/user.schema';
import { WorkyWhatsAppConnectionService } from '@modules/whatsapp/services/worky-whatsapp-connection.service';
import { WhatsAppConnectResponseDto } from '@modules/whatsapp/dto/whatsapp-connect-response.dto';
import { WhatsAppIntegrationResponseDto } from '@modules/whatsapp/dto/whatsapp-integration-response.dto';
import { WhatsAppPairingResponseDto } from '@modules/whatsapp/dto/whatsapp-pairing-response.dto';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { WorkyStreamAccessGuard } from '../guards/worky-stream-access.guard';
import { WorkyWhatsAppIntegrationService } from '../services/worky-whatsapp-integration.service';

@ApiTags('Worky')
@ApiBearerAuth()
@UseGuards(WorkyStreamAccessGuard)
@Controller('worky/streams')
export class WorkyWhatsAppIntegrationController {
  constructor(
    private readonly integrationService: WorkyWhatsAppIntegrationService,
    private readonly connectionService: WorkyWhatsAppConnectionService,
  ) {}

  @Get(':id/whatsapp-integration')
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'Get WhatsApp integration status for a Worky stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async getIntegration(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
  ): Promise<WhatsAppIntegrationResponseDto | null> {
    return this.integrationService.getByStreamForUser(user._id.toString(), streamId);
  }

  @Post(':id/whatsapp-integration/connect')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Start WhatsApp pairing for this Worky stream' })
  @ApiResponse({ status: 200, type: WhatsAppConnectResponseDto })
  async connect(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
  ): Promise<WhatsAppConnectResponseDto> {
    return this.connectionService.connect(user._id.toString(), streamId);
  }

  @Get(':id/whatsapp-integration/:sessionId/pairing')
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'Get latest QR / pairing code for a Worky stream session' })
  @ApiResponse({ status: 200, type: WhatsAppPairingResponseDto })
  async getPairing(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<WhatsAppPairingResponseDto> {
    return this.connectionService.getPairing(user._id.toString(), streamId, sessionId);
  }

  @Post(':id/whatsapp-integration/:sessionId/reconnect')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Reconnect WhatsApp for a Worky stream using stored auth' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async reconnect(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<WhatsAppIntegrationResponseDto> {
    return this.connectionService.reconnect(user._id.toString(), streamId, sessionId);
  }

  @Delete(':id/whatsapp-integration/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Disconnect WhatsApp session for a Worky stream' })
  async disconnectSession(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.connectionService.disconnectSession(user._id.toString(), streamId, sessionId);
  }

  @Delete(':id/whatsapp-integration')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Remove WhatsApp integration for this Worky stream' })
  async deleteIntegration(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
  ): Promise<void> {
    await this.connectionService.deleteIntegration(user._id.toString(), streamId);
  }
}
