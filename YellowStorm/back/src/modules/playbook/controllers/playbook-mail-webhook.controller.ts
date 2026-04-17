import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { PlaybookMailWebhookService } from '../services/playbook-mail-webhook.service';

@ApiExcludeController()
@Controller('playbooks/mail')
export class PlaybookMailWebhookController {
  constructor(private readonly webhookService: PlaybookMailWebhookService) {}

  @Public()
  @Get('webhook')
  validateWebhook(@Query('validationToken') validationToken: string, @Res() res: Response) {
    res.type('text/plain');
    res.status(200).send(validationToken || '');
  }

  @Public()
  @Post('webhook')
  async receiveWebhook(@Body() body: { value?: Array<Record<string, any>> }) {
    return this.webhookService.handleNotifications(body);
  }
}
