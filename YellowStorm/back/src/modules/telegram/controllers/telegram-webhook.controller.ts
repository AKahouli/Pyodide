import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { TelegramUpdate } from '../interfaces/telegram-update.interface';
import { TelegramWebhookService } from '../services/telegram-webhook.service';

@ApiExcludeController()
@SkipResponseWrap()
@Controller('integrations/telegram')
export class TelegramWebhookController {
  constructor(private readonly telegramWebhookService: TelegramWebhookService) {}

  @Public()
  @Post('webhook/:integrationId')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 120, windowMs: 60000, keyPrefix: 'telegram:webhook' })
  async receiveWebhook(
    @Param('integrationId') integrationId: string,
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
    @Body() body: TelegramUpdate,
  ): Promise<{ ok: true }> {
    await this.telegramWebhookService.validateAndDispatch(integrationId, secretToken, body);
    return { ok: true };
  }
}
