import { Controller, Sse, Req, MessageEvent } from '@nestjs/common';
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

@ApiTags('Conversation Stream')
@Controller('conversations/stream')
export class StreamController {
  constructor(private readonly streamGateway: StreamGatewayService) {}

  @Sse()
  @Public()
  @StreamAuth()
  stream(@Req() req: RequestWithSseUser): Observable<MessageEvent> {
    const user = req.sseUser!;
    const userId = user.sub;
    const sessionId = user.sessionId || 'unknown';
    const connectionId = `${userId}:${sessionId}:${Date.now()}`;

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
