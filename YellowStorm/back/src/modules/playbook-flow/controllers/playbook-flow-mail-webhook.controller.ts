import { Controller, Get, Post, Query, Req, Res, HttpCode } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { Request, Response } from 'express';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailWebhookService } from '../services/playbook-flow-mail-webhook.service';

@ApiExcludeController()
@SkipResponseWrap()
@Controller('playbooks/mail')
export class PlaybookFlowMailWebhookController {
  constructor(
    private readonly webhookService: PlaybookFlowMailWebhookService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowMailWebhook'); }

  @Get('webhook')
  @Public()
  validateWebhook(
    @Query('validationToken') validationToken: string,
    @Res() res: Response,
  ) {
    if (validationToken) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(validationToken);
    }
    return res.status(400).send('Missing validationToken');
  }

  @Post('webhook')
  @Public()
  @HttpCode(202)
  async receiveWebhook(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const body = req.body as { value?: Array<Record<string, any>> };
      const result = await this.webhookService.handleNotifications(body);
      return res.status(202).json(result);
    } catch (err) {
      this.logger.error('Mail webhook processing error', { error: (err as Error).message });
      return res.status(202).send();
    }
  }
}
