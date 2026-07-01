import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkyWhatsAppSystemBotConnectionService } from '@modules/whatsapp/services/worky-whatsapp-system-bot-connection.service';

@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/whatsapp-system-bot')
export class WorkyWhatsAppSystemBotStatusController {
  constructor(
    private readonly connectionService: WorkyWhatsAppSystemBotConnectionService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the Worky WhatsApp system bot is connected' })
  async getStatus(): Promise<{ connected: boolean }> {
    const connected = await this.connectionService.isConnected();
    return { connected };
  }
}
