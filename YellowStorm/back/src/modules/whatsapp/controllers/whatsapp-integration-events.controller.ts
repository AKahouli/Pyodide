import { Controller, MessageEvent, Param, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { finalize, of, Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { WhatsAppConnectionService } from '../services/whatsapp-connection.service';
import { WhatsAppIntegrationSseService } from '../services/whatsapp-integration-sse.service';
import { WhatsAppIntegrationService } from '../services/whatsapp-integration.service';

@ApiTags('Agent WhatsApp Integration')
@ApiBearerAuth()
@Controller('agents/:agentId/whatsapp-integration')
export class WhatsAppIntegrationEventsController {
  constructor(
    private readonly integrationService: WhatsAppIntegrationService,
    private readonly connectionService: WhatsAppConnectionService,
    private readonly sseService: WhatsAppIntegrationSseService,
  ) {}

  /**
   * Live WhatsApp integration status for one agent (server → client).
   * Auto-recovery is triggered only by POST /auto-recover when the frontend sees FAILED.
   */
  @Sse('events')
  @ApiOperation({ summary: 'SSE — live WhatsApp integration status for an agent' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  stream(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
  ): Observable<MessageEvent> {
    this.connectionService.assertEnabled();
    const userId = user._id.toString();
    const connectionId = `${userId}:${agentId}:${Date.now()}`;
    const disconnect$ = new Subject<void>();

    const stream$ = this.sseService.registerConnection(userId, agentId, connectionId, disconnect$);
    if (!stream$) {
      return of({
        type: 'error',
        data: {
          code: 'WHATSAPP_SSE_LIMIT',
          message: 'Too many open WhatsApp SSE connections for this agent.',
        },
      } as MessageEvent);
    }

    void this.emitSnapshot(userId, agentId).catch(() => undefined);

    return stream$.pipe(
      finalize(() => {
        disconnect$.next();
        disconnect$.complete();
        this.sseService.removeConnection(userId, agentId, connectionId);
      }),
    );
  }

  private async emitSnapshot(userId: string, agentId: string): Promise<void> {
    const snapshot = await this.integrationService.getByAgentForUser(userId, agentId);
    if (!snapshot) return;
    this.sseService.publishStatus(userId, agentId, snapshot);
  }
}
