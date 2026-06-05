import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { interval, Subject, takeUntil } from 'rxjs';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { StreamAuth } from '@modules/conversation/decorators/stream-auth.decorator';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { ConversationV2EventStoreService } from './services/conversation-v2-event-store.service';
import { ConversationV2StreamGatewayService } from './services/conversation-v2-stream-gateway.service';
import { ConversationV2StreamService } from './services/conversation-v2-stream.service';
import { ConversationV2OwnerGuard } from './guards/conversation-v2-owner.guard';
import { SendMessageBodyDto } from './dto/send-message.dto';
import { eventToSseFrame } from './utils/event-mapper';

export interface SseAuthUser {
  id: string;
  [key: string]: unknown;
}

interface AuthUser {
  id: string;
}

export const CurrentSseUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SseAuthUser => {
    const req = ctx.switchToHttp().getRequest<{ sseUser?: SseAuthUser }>();
    return req.sseUser as SseAuthUser;
  },
);

@ApiTags('conversation-v2')
@ApiBearerAuth()
@Controller('conversation-v2')
export class ConversationV2StreamController {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: ConversationV2SessionService,
    private readonly eventStore: ConversationV2EventStoreService,
    private readonly gateway: ConversationV2StreamGatewayService,
    private readonly streamService: ConversationV2StreamService,
  ) {}

  /**
   * Persistent, per-user SSE pipe. Opened once for the whole authenticated
   * session (the client mounts it at the app shell), it carries events for ALL
   * of the user's conversations — every frame tagged with its `sessionId`. It
   * is NOT tied to any conversation or to message-sending, so navigating
   * between conversations never tears down a running stream. Background streams
   * push their events here via the gateway.
   */
  @Get('stream')
  @Public()
  @StreamAuth()
  async streamPipe(
    @CurrentSseUser() user: SseAuthUser,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
    (res.socket as { setNoDelay?: (b: boolean) => void } | null)?.setNoDelay?.(true);

    // SSE warmup padding — pushes Node/Express internal buffers past the flush
    // threshold so every subsequent small write reaches the client immediately.
    res.write(':' + ' '.repeat(2048) + '\n\n');

    const connectionId = `${user.id}:${Date.now()}:${randomUUID()}`;
    const registered = this.gateway.registerConnection(user.id, connectionId, res);
    if (!registered) {
      res.write(
        `event: error\ndata: ${JSON.stringify({
          code: 'CONVERSATION_SSE_LIMIT',
          message: 'Too many open connections',
        })}\n\n`,
      );
      res.end();
      return;
    }

    // Tell the client which connection it got — also primes its heartbeat timer.
    res.write(`event: connected\ndata: ${JSON.stringify({ connectionId })}\n\n`);

    const disconnect$ = new Subject<void>();
    const heartbeatMs = this.config.get<number>('conversationV2.sseHeartbeatMs') ?? 15000;
    const heartbeat = interval(heartbeatMs)
      .pipe(takeUntil(disconnect$))
      .subscribe(() => {
        try {
          res.write('event: heartbeat\ndata: {}\n\n');
          (res as Response & { flush?: () => void }).flush?.();
        } catch {
          /* connection dropped — close handler will tear down */
        }
      });

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        heartbeat.unsubscribe();
        disconnect$.next();
        disconnect$.complete();
        this.gateway.removeConnection(user.id, connectionId);
        if (!(res as Response & { writableEnded?: boolean }).writableEnded) res.end();
        resolve();
      };
      res.on('close', finish);
    });
  }

  /**
   * Send a message and kick off the AI response in the background. Returns as
   * soon as the user message is recorded and the stream is registered — the
   * resulting events are delivered over the persistent `/stream` pipe, not this
   * request. This is the v1 `POST .../messages` pattern.
   */
  @Post('sessions/:id/message')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ConversationV2OwnerGuard)
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') sessionId: string,
    @Body() body: SendMessageBodyDto,
  ): Promise<{ accepted: true }> {
    const isRepoBound = !!(body.connectorId && body.connectorRepoId);
    await this.streamService.startStream(user.id, sessionId, {
      message: body.message,
      model: body.model,
      clientEventId: body.clientEventId,
      connectorRepo: isRepoBound
        ? {
            connectorId: body.connectorId!,
            connectorName: body.connectorName!,
            repoId: body.connectorRepoId!,
            repoName: body.connectorRepoName!,
            repoUrl: body.connectorRepoUrl,
          }
        : undefined,
    });
    return { accepted: true };
  }

  /**
   * Poll-based catch-up tail for a single session. Kept as a reconnect/replay
   * fallback (e.g. after a hard reload while a background stream is still
   * running) — the live path is the persistent `/stream` pipe above.
   */
  @Get('sessions/:id/stream/live')
  @Public()
  @StreamAuth()
  async streamLive(
    @CurrentSseUser() user: SseAuthUser,
    @Param('id') sessionId: string,
    @Query('since') sinceRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const pointer = await this.sessions.getOne(user.id, sessionId);
    if (!pointer) throw new NotFoundException('Session not found');

    const since = Math.max(0, Number.parseInt(sinceRaw ?? '0', 10) || 0);
    const terminal: ReadonlyArray<string> = ['completed', 'stopped', 'error'];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
    (res.socket as { setNoDelay?: (b: boolean) => void } | null)?.setNoDelay?.(true);

    const sseWrite = (chunk: string): void => this.sseWrite(res, chunk);
    sseWrite(':' + ' '.repeat(2048) + '\n\n');

    const disconnect$ = new Subject<void>();
    const heartbeatMs = this.config.get<number>('conversationV2.sseHeartbeatMs') ?? 15000;
    const pollMs = this.config.get<number>('conversationV2.liveTailPollMs') ?? 1000;
    const heartbeat = interval(heartbeatMs)
      .pipe(takeUntil(disconnect$))
      .subscribe(() => sseWrite(': heartbeat\n\n'));

    let lastSeen = since;
    const poll = interval(pollMs)
      .pipe(takeUntil(disconnect$))
      .subscribe(async () => {
        try {
          const rows = await this.eventStore.listSince(sessionId, lastSeen, 500);
          for (const row of rows) {
            const wire = {
              type: row.type,
              payload: {
                event_id: row.eventId,
                timestamp: row.emittedAt,
                ...(row.payload as Record<string, unknown>),
              },
            } as never;
            sseWrite(eventToSseFrame(wire, row.sequence));
            lastSeen = row.sequence;
          }
          const latest = await this.sessions.getOne(user.id, sessionId);
          const sessionGone = latest === null;
          const sessionTerminal = !!latest && terminal.includes(latest.status as string);
          if (sessionGone || sessionTerminal) {
            (res as Response & { __teardown?: () => void }).__teardown?.();
          }
        } catch {
          /* swallow — next poll retries */
        }
      });

    return new Promise<void>((resolve) => {
      let settled = false;
      const teardown = () => {
        if (settled) return;
        settled = true;
        heartbeat.unsubscribe();
        poll.unsubscribe();
        disconnect$.next();
        disconnect$.complete();
        const r = res as Response & { writableEnded?: boolean };
        if (!r.writableEnded) res.end();
        resolve();
      };
      (res as Response & { __teardown?: () => void }).__teardown = teardown;
      res.on('close', teardown);
    });
  }

  /**
   * Write a chunk to an SSE response and force a flush. `res.flush` is added by
   * the `compression` middleware — a no-op when compression skips this response
   * (it filters out text/event-stream) but a safety belt against future
   * middleware that reintroduces buffering on this path.
   */
  private sseWrite(res: Response, chunk: string): void {
    res.write(chunk);
    (res as Response & { flush?: () => void }).flush?.();
  }
}
