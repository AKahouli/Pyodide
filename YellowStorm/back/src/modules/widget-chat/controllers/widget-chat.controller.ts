import { Controller, Post, Get, Body, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipMaintenance } from '@modules/system/decorators/skip-maintenance.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { LoggerService } from '@modules/logger';
import { WidgetTokenGuard } from '../guards/widget-token.guard';
import { WidgetChatService } from '../services/widget-chat.service';
import { WidgetSendMessageDto, WidgetCreateSessionDto, WidgetCitationUrlDto } from '../dto/widget-chat.dto';
import { WidgetDeploymentMode } from '../decorators/widget-deployment-mode.decorator';

interface WidgetRequest extends Request {
  widgetTokenHash?: string;
  widgetAgentId?: string;
  widgetAgent?: any;
}

@ApiTags('Widget Chat')
@Controller('widget')
export class WidgetChatController {
  constructor(
    private readonly widgetChatService: WidgetChatService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WidgetChatController.name);
  }

  @Post('session')
  @Public()
  @SkipMaintenance()
  @WidgetDeploymentMode('embed')
  @UseGuards(WidgetTokenGuard)
  @RateLimit({ limit: 30, windowMs: 60000, keyPrefix: 'widget-session' })
  async createSession(@Body() dto: WidgetCreateSessionDto, @Req() req: WidgetRequest) {
    const session = await this.widgetChatService.createOrGetSession(
      req.widgetTokenHash!,
      req.widgetAgentId!,
      dto.visitorId,
      { ip: req.ip, userAgent: req.headers['user-agent'], origin: req.headers.origin, clientContext: dto.clientContext },
      req.widgetAgent,
    );
    this.logger.log('Widget POST /session', {
      sessionId: session.id,
      agentId: req.widgetAgentId,
      origin: req.headers.origin,
    });
    return { sessionId: session.id };
  }

  @Post('session/reset')
  @Public()
  @SkipMaintenance()
  @WidgetDeploymentMode('embed')
  @UseGuards(WidgetTokenGuard)
  @RateLimit({ limit: 15, windowMs: 60000, keyPrefix: 'widget-session-reset' })
  async resetSession(@Body() dto: WidgetCreateSessionDto, @Req() req: WidgetRequest) {
    const result = await this.widgetChatService.resetVisitorSession(
      req.widgetTokenHash!,
      req.widgetAgentId!,
      dto.visitorId,
      { ip: req.ip, userAgent: req.headers['user-agent'], origin: req.headers.origin, clientContext: dto.clientContext },
      req.widgetAgent,
    );
    this.logger.log('Widget POST /session/reset', {
      sessionId: result.sessionId,
      agentId: req.widgetAgentId,
      visitorId: dto.visitorId,
    });
    return result;
  }

  @Post('chat')
  @Public()
  @SkipMaintenance()
  @WidgetDeploymentMode('embed')
  @UseGuards(WidgetTokenGuard)
  @RateLimit({ limit: 20, windowMs: 60000, keyPrefix: 'widget-chat' })
  async chat(@Body() dto: WidgetSendMessageDto, @Req() req: WidgetRequest) {
    this.logger.log('Widget POST /chat', {
      agentId: req.widgetAgentId,
      visitorId: dto.visitorId || 'anonymous',
      messageLength: dto.message?.length ?? 0,
      origin: req.headers.origin,
    });

    const session = await this.widgetChatService.createOrGetSession(
      req.widgetTokenHash!,
      req.widgetAgentId!,
      dto.visitorId || 'anonymous',
      { ip: req.ip, userAgent: req.headers['user-agent'], origin: req.headers.origin, clientContext: dto.clientContext },
      req.widgetAgent,
    );
    const result = await this.widgetChatService.handleMessage({
      tokenHash: req.widgetTokenHash!,
      agentId: req.widgetAgentId!,
      sessionId: session.id,
      message: dto.message,
      agent: req.widgetAgent,
      metadata: { ip: req.ip, userAgent: req.headers['user-agent'], origin: req.headers.origin, clientContext: dto.clientContext },
      interaction: dto.interaction ? { ...dto.interaction } : undefined,
    });

    this.logger.log('Widget POST /chat completed', {
      sessionId: result.sessionId,
      messageId: result.messageId,
    });
    return result;
  }

  @Post('citation-url')
  @Public()
  @SkipMaintenance()
  @WidgetDeploymentMode('embed')
  @UseGuards(WidgetTokenGuard)
  @RateLimit({ limit: 60, windowMs: 60000, keyPrefix: 'widget-citation-url' })
  async citationUrl(@Body() dto: WidgetCitationUrlDto, @Req() req: WidgetRequest) {
    this.logger.log('Widget POST /citation-url', {
      agentId: req.widgetAgentId,
      source: dto.source,
      origin: req.headers.origin,
    });

    return this.widgetChatService.generateCitationUrl({
      source: dto.source,
      fileName: dto.fileName,
      workspaceId: dto.workspaceId,
      agentKnowledgeBaseIds: (req.widgetAgent?.knowledgeBases || []).map(String),
    });
  }

  @Get('stream')
  @Public()
  @SkipMaintenance()
  @WidgetDeploymentMode('embed')
  @UseGuards(WidgetTokenGuard)
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'widget-stream' })
  async stream(@Query('sessionId') sessionId: string, @Req() req: WidgetRequest, @Res() res: Response): Promise<void> {
    this.logger.log('Widget GET /stream', {
      sessionId: sessionId || '(empty)',
      origin: req.headers.origin,
    });

    const observable = await this.widgetChatService.getAuthorizedStream({
      sessionId,
      tokenHash: req.widgetTokenHash!,
      agentId: req.widgetAgentId!,
    });

    if (!observable) {
      this.logger.warn('Widget GET /stream rejected: invalid sessionId', { sessionId });
      res.status(404).json({ success: false, error: { code: 'ERR_3405', message: 'Session stream not found' } });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const warmup = ' '.repeat(2048);
    res.write(warmup);
    res.write('\n\n');

    req.socket.setNoDelay?.(true);

    const subscription = observable.subscribe({
      next: (event) => {
        try {
          if (event.type !== 'heartbeat') {
            this.logger.debug('Widget SSE event', { sessionId, eventType: event.type });
          }
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
          res.flush?.();
        } catch {
          subscription.unsubscribe();
        }
      },
      error: (err) => {
        this.logger.error('Widget SSE subscription error', {
          sessionId,
          error: (err as Error).message,
        });
        subscription.unsubscribe();
      },
      complete: () => {
        this.logger.log('Widget SSE subscription complete', { sessionId });
        subscription.unsubscribe();
      },
    });

    req.on('close', () => {
      this.logger.debug('Widget SSE client disconnected', { sessionId });
      subscription.unsubscribe();
    });
  }

  @Get('config')
  @Public()
  @SkipMaintenance()
  @WidgetDeploymentMode('embed')
  @UseGuards(WidgetTokenGuard)
  @RateLimit({ limit: 60, windowMs: 60000, keyPrefix: 'widget-config' })
  config(@Req() req: WidgetRequest) {
    return this.widgetChatService.getPublicConfig(req.widgetAgent, req.widgetAgentId!);
  }
}
