import {
  BadRequestException,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { interval, Subject, Subscription, takeUntil } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { StreamAuth } from '@modules/conversation/decorators/stream-auth.decorator';
import { ConversationV2GrpcClientService } from './services/conversation-v2.grpc-client.service';
import { ConversationV2PointerWriterService } from './services/conversation-v2-pointer-writer.service';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { SendMessageQueryDto } from './dto/send-message.dto';
import { eventToSseFrame } from './utils/event-mapper';

export interface SseAuthUser {
  id: string;
  [key: string]: unknown;
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
    private readonly grpcClient: ConversationV2GrpcClientService,
    private readonly config: ConfigService,
    private readonly pointerWriter: ConversationV2PointerWriterService,
    private readonly sessions: ConversationV2SessionService,
  ) {}

  @Get('sessions/:id/stream')
  @Public()
  @StreamAuth()
  async stream(
    @CurrentSseUser() user: SseAuthUser,
    @Param('id') sessionId: string,
    @Query() query: SendMessageQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const max = this.config.get<number>('conversationV2.maxMessageLength') ?? 16384;

    if (!query.message || query.message.length === 0 || query.message.length > max) {
      throw new BadRequestException(`message must be 1..${max} chars`);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();

    const disconnect$ = new Subject<void>();
    const heartbeatMs = this.config.get<number>('conversationV2.sseHeartbeatMs') ?? 15000;
    const heartbeat = interval(heartbeatMs)
      .pipe(takeUntil(disconnect$))
      .subscribe(() => res.write(': heartbeat\n\n'));

    let chatSub: Subscription | null = null;

    // Ensure pointer doc exists (best-effort, non-blocking)
    this.sessions.createForUser(user.id, sessionId).catch(() => undefined);

    return new Promise<void>((resolve) => {
      const finish = () => {
        heartbeat.unsubscribe();
        chatSub?.unsubscribe();
        disconnect$.next();
        disconnect$.complete();
        const r = res as Response & { writableEnded?: boolean };
        if (!r.writableEnded) res.end();
        resolve();
      };

      res.on('close', finish);

      chatSub = this.grpcClient
        .chat(user.id, sessionId, query.message)
        .pipe(
          tap((event) => {
            this.pointerWriter.apply(sessionId, event).catch(() => undefined);
          }),
        )
        .subscribe({
          next: (event) => {
            res.write(eventToSseFrame(event));
          },
          error: (err: Error) => {
            res.write(
              eventToSseFrame({
                type: 'error',
                payload: {
                  event_id: '',
                  timestamp: Math.floor(Date.now() / 1000),
                  error: err.message,
                },
              }),
            );
            finish();
          },
          complete: () => finish(),
        });
    });
  }
}
