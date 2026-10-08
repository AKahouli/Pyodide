import { Controller, Get, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { Request, Response } from 'express';
import { LoggerService } from '@modules/logger';
import { WorkyMailWebhookService } from '../services/worky-mail-webhook.service';

// Shared ceiling with the playbook mail webhook: Graph posts from a small set
// of shared egress IPs, so stay far above normal traffic while bounding abuse.
const MAIL_WEBHOOK_RATE = { limit: 600, windowMs: 60_000, keyPrefix: 'worky:mail:webhook' };

@ApiExcludeController()
@SkipResponseWrap()
@Controller('worky/mail')
export class WorkyMailWebhookController {
  constructor(
    private readonly webhookService: WorkyMailWebhookService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkyMailWebhook');
  }

  /** Graph validates over POST in practice; this exists for manual probing. */
  @Get('webhook')
  @Public()
  validateWebhook(@Query('validationToken') validationToken: string, @Res() res: Response) {
    if (!validationToken) return res.status(400).send('Missing validationToken');
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(validationToken);
  }

  @Post('webhook')
  @Public()
  @RateLimit(MAIL_WEBHOOK_RATE)
  async receiveWebhook(
    @Query('validationToken') validationToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Subscription handshake: Graph POSTs ?validationToken=... and wants it back
    // verbatim as text/plain within 10 seconds, or the subscription is refused.
    if (validationToken) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(HttpStatus.OK).send(validationToken);
    }

    // Always ack. A 5xx makes Graph retry and, after enough failures, drop the
    // subscription entirely — losing every future reply for that mailbox. A
    // notification we failed to process is worth far less than the subscription.
    try {
      const body = req.body as { value?: Record<string, any>[] };
      const result = await this.webhookService.handleNotifications(body);
      return res.status(HttpStatus.ACCEPTED).json(result);
    } catch (err) {
      this.logger.error('Worky mail webhook error', { error: (err as Error).message });
      return res.status(HttpStatus.ACCEPTED).send();
    }
  }
}
