import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Body,
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
import { WorkyWhatsAppSystemBotConnectionService } from '@modules/whatsapp/services/worky-whatsapp-system-bot-connection.service';
import { WhatsAppConnectResponseDto } from '@modules/whatsapp/dto/whatsapp-connect-response.dto';
import { WhatsAppIntegrationResponseDto } from '@modules/whatsapp/dto/whatsapp-integration-response.dto';
import { WhatsAppPairingResponseDto } from '@modules/whatsapp/dto/whatsapp-pairing-response.dto';
import { RequirePermissions } from '../../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../../authorization/constants/permissions';
import { UpdateWorkyWhatsAppSystemBotPhoneDto } from '../../dto/update-worky-whatsapp-system-bot-phone.dto';

@ApiTags('Worky Admin')
@ApiBearerAuth()
@Controller('admin/worky/whatsapp-system-bot')
export class WorkyWhatsAppSystemBotAdminController {
  constructor(
    private readonly connectionService: WorkyWhatsAppSystemBotConnectionService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.WORKY_ADMIN_GOVERNANCE)
  @ApiOperation({ summary: 'Get Worky WhatsApp system bot status' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async getStatus(): Promise<WhatsAppIntegrationResponseDto> {
    return this.connectionService.getStatus();
  }

  @Patch('expected-phone')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_ADMIN_GOVERNANCE)
  @ApiOperation({ summary: 'Save the expected system bot phone number for pairing' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async updateExpectedPhone(
    @Body() dto: UpdateWorkyWhatsAppSystemBotPhoneDto,
  ): Promise<WhatsAppIntegrationResponseDto> {
    return this.connectionService.updateExpectedPhone(dto.phoneNumber);
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_ADMIN_GOVERNANCE)
  @ApiOperation({ summary: 'Start pairing the Worky WhatsApp system bot' })
  @ApiResponse({ status: 200, type: WhatsAppConnectResponseDto })
  async connect(
    @CurrentUser() user: UserDocument,
  ): Promise<WhatsAppConnectResponseDto> {
    return this.connectionService.connect(user._id.toString());
  }

  @Get(':sessionId/pairing')
  @RequirePermissions(Permissions.WORKY_ADMIN_GOVERNANCE)
  @ApiOperation({ summary: 'Get QR / pairing code for system bot session' })
  @ApiParam({ name: 'sessionId', description: 'Pairing session id' })
  @ApiResponse({ status: 200, type: WhatsAppPairingResponseDto })
  async getPairing(@Param('sessionId') sessionId: string): Promise<WhatsAppPairingResponseDto> {
    return this.connectionService.getPairing(sessionId);
  }

  @Post(':sessionId/reconnect')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_ADMIN_GOVERNANCE)
  @ApiOperation({ summary: 'Reconnect Worky WhatsApp system bot' })
  @ApiResponse({ status: 200, type: WhatsAppIntegrationResponseDto })
  async reconnect(
    @Param('sessionId') sessionId: string,
  ): Promise<WhatsAppIntegrationResponseDto> {
    return this.connectionService.reconnect(sessionId);
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.WORKY_ADMIN_GOVERNANCE)
  @ApiOperation({ summary: 'Disconnect Worky WhatsApp system bot session' })
  async disconnectSession(@Param('sessionId') sessionId: string): Promise<void> {
    await this.connectionService.disconnectSession(sessionId);
  }
}
