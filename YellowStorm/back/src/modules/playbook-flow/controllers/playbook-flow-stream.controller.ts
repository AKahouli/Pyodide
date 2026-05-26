import { Controller, Sse, Req, MessageEvent } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Observable, of } from 'rxjs';
import { Request } from 'express';
import { Subject } from 'rxjs';
import { Public } from '../../auth/decorators/public.decorator';
import { PlaybookFlowStreamAuthGuard, RequestWithSseUser } from '../guards/playbook-flow-stream-auth.guard';
import { PlaybookFlowStreamGatewayService } from '../services/playbook-flow-stream-gateway.service';
import { PlaybookFlowStreamEventsService } from '../services/playbook-flow-stream-events.service';
import { UseGuards } from '@nestjs/common';

@ApiTags('Playbook Stream')
@Controller('playbooks/stream')
export class PlaybookFlowStreamController {
  constructor(
    private readonly streamGateway: PlaybookFlowStreamGatewayService,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
  ) {}

  @Sse()
  @Public()
  @UseGuards(PlaybookFlowStreamAuthGuard)
  stream(@Req() req: RequestWithSseUser): Observable<MessageEvent> {
    const user = req.sseUser!;
    const userId = user.sub;
    const sessionId = user.sessionId || 'unknown';
    const connectionId = `${userId}:${sessionId}:${Date.now()}`;

    const disconnect$ = new Subject<void>();

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
      return of({
        type: 'error',
        data: {
          code: 'ERR_1405',
          message: 'Maximum SSE connections reached',
        },
      } as MessageEvent);
    }

    this.streamEvents.emitConnected(userId);

    return stream$;
  }
}
