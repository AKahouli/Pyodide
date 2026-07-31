import { Controller, Sse, Req, MessageEvent } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Observable, of, startWith } from 'rxjs';
import { Request } from 'express';
import { Subject } from 'rxjs';
import { Public } from '../../auth/decorators/public.decorator';
import { PlaybookStreamAuth } from '../decorators/playbook-stream-auth.decorator';
import { PlaybookStreamGatewayService } from '../services/playbook-stream-gateway.service';
import { PlaybookExecutionService } from '../services/playbook-execution.service';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

interface RequestWithSseUser extends Request {
  sseUser?: JwtPayload;
}

@ApiTags('Playbook Stream')
@Controller('playbooks/stream')
export class PlaybookStreamController {
  constructor(
    private readonly streamGateway: PlaybookStreamGatewayService,
    private readonly executionService: PlaybookExecutionService,
  ) {}

  @Sse()
  @Public()
  @PlaybookStreamAuth()
  async stream(@Req() req: RequestWithSseUser): Promise<Observable<MessageEvent>> {
    const user = req.sseUser!;
    const userId = user.sub;
    const sessionId = user.sessionId || 'unknown';
    const connectionId = `playbook:${userId}:${sessionId}:${Date.now()}`;

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
          message: 'Maximum playbook SSE connections reached',
        },
      } as MessageEvent);
    }

    // Fetch active executions so the client can hydrate immediately on connect.
    // Using startWith guarantees the connected event is delivered before any
    // other stream events — no race condition with Subject subscribers.
    const activeExecutions = await this.executionService.findActiveExecutionsByUser(userId);

    const connectedEvent: MessageEvent = {
      type: 'playbook_connected',
      data: { connectionId, activeExecutions },
    } as MessageEvent;

    return stream$.pipe(startWith(connectedEvent));
  }
}
