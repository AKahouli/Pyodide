import { Controller, Sse, Req, Header, MessageEvent, Query, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { concat, Observable, of } from 'rxjs';
import { Request } from 'express';
import { Subject } from 'rxjs';
import { Public } from '../../auth/decorators/public.decorator';
import { StreamAuth } from '../decorators/stream-auth.decorator';
import { StreamGatewayService } from '../services/stream-gateway.service';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

interface RequestWithSseUser extends Request {
  sseUser?: JwtPayload;
}

/**
 * The reconnect cursor is an opaque replay pointer (`<boot>:<seq>`); it is
 * never a database id, so a strict shape check at this trust boundary is
 * sufficient. Anything malformed is treated as a first connection.
 */
function parseReplayCursor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return /^[A-Za-z0-9_-]{1,100}:[0-9]{1,15}$/.test(raw) ? raw : undefined;
}

@ApiTags('Conversation Stream')
@Controller('conversations/stream')
export class StreamController {
  constructor(private readonly streamGateway: StreamGatewayService) {}

  @Sse()
  @Header('X-Accel-Buffering', 'no')
  @Public()
  @StreamAuth()
  stream(
    @Req() req: RequestWithSseUser,
    @Query('cursor') cursor?: string,
  ): Observable<MessageEvent> {
    // StreamAuth resolves the token before the handler runs; this guard keeps
    // the type system honest if the decorator contract is ever bypassed.
    const user = req.sseUser;
    if (!user) throw new UnauthorizedException('Missing stream authentication');
    const userId = user.sub;
    const sessionId = user.sessionId || 'unknown';
    const connectionId = `${userId}:${sessionId}:${String(Date.now())}`;

    // Nest owns @Sse response headers; mutating them here is already too late.
    req.socket.setNoDelay(true);

    const disconnect$ = new Subject<void>();

    // Handle client disconnect
    req.on('close', () => {
      this.streamGateway.removeConnection(userId, connectionId);
      disconnect$.next();
      disconnect$.complete();
    });

    const stream$ = this.streamGateway.registerConnection(
      userId,
      connectionId,
      disconnect$,
      parseReplayCursor(cursor),
    );

    if (!stream$) {
      // Connection limit reached
      return of({
        type: 'error',
        data: {
          code: 'ERR_1405',
          message: 'Maximum SSE connections reached',
        },
      } as MessageEvent);
    }

    // Emit after Nest subscribes so the initial connection frame cannot be lost.
    const connected$ = of({
      type: 'connected',
      data: { connectionId },
    } as MessageEvent);

    return concat(connected$, stream$);
  }
}
