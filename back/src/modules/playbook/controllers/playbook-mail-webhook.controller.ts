import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { SkipResponseWrap } from '../../response/decorators/skip-response-wrap.decorator';
import { PlaybookMailWebhookService } from '../services/playbook-mail-webhook.service';

@ApiExcludeController()
@SkipResponseWrap()
@Controller('playbooks/mail')
export class PlaybookMailWebhookController {
  constructor(private readonly webhookService: PlaybookMailWebhookService) {}

  @Public()
  @Get('webhook')
  validateWebhook(@Query('validationToken') validationToken: string, @Res() res: Response) {
    const token = validationToken || '';
    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(token, 'utf8').toString());
    res.end(token);
  }

  @Public()
  @Post('webhook')
  async receiveWebhook(
    @Query('validationToken') validationToken: string | undefined,
    @Body() body: { value?: Array<Record<string, any>> },
    @Res() res: Response,
  ) {
    if (validationToken) {
      res.status(200);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(validationToken, 'utf8').toString());
      res.end(validationToken);
      return;
    }

    await this.webhookService.handleNotifications(body);
    res.status(202).end();
  }
}
