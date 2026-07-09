import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageEvent } from '@nestjs/common';
import { Subject, Observable, merge, interval, map, takeUntil } from 'rxjs';
import { LoggerService } from '@modules/logger';
import type { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';
import type { WhatsAppIntegrationSseEvent } from '../interfaces/whatsapp-integration-sse-event.interface';

interface WhatsAppSseConnection {
  connectionId: string;
  userId: string;
  agentId: string;
  subject: Subject<WhatsAppIntegrationSseEvent>;
  disconnect$: Subject<void>;
}

/**
 * Per-(user, agent) SSE channel for WhatsApp integration status snapshots.
 */
@Injectable()
export class WhatsAppIntegrationSseService implements OnModuleDestroy {
  private readonly connections = new Map<string, WhatsAppSseConnection>();
  private readonly agentConnections = new Map<string, Set<string>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WhatsAppIntegrationSseService.name);
  }

  onModuleDestroy(): void {
    for (const conn of this.connections.values()) {
      conn.subject.complete();
      conn.disconnect$.next();
      conn.disconnect$.complete();
    }
    this.connections.clear();
    this.agentConnections.clear();
  }

  registerConnection(
    userId: string,
    agentId: string,
    connectionId: string,
    disconnect$: Subject<void>,
  ): Observable<MessageEvent> | null {
    const max = this.configService.get<number>('whatsapp.maxSseConnections', 3);
    const agentKey = `${userId}:${agentId}`;
    const existing = this.agentConnections.get(agentKey);
    if (existing && existing.size >= max) {
      this.logger.warn('WhatsApp integration SSE cap reached', { userId, agentId, max });
      return null;
    }

    const subject = new Subject<WhatsAppIntegrationSseEvent>();
    this.connections.set(connectionId, {
      connectionId,
      userId,
      agentId,
      subject,
      disconnect$,
    });
    if (!this.agentConnections.has(agentKey)) {
      this.agentConnections.set(agentKey, new Set());
    }
    this.agentConnections.get(agentKey)!.add(connectionId);

    const heartbeatMs = this.configService.get<number>('whatsapp.sseHeartbeatMs', 15000);
    const heartbeat$ = interval(heartbeatMs).pipe(
      map(
        () =>
          ({
            type: 'heartbeat',
            data: { timestamp: Date.now() },
          }) as MessageEvent,
      ),
    );
    const events$ = subject.pipe(
      map(
        (event) =>
          ({
            type: event.type,
            data: event,
          }) as MessageEvent,
      ),
    );
    return merge(events$, heartbeat$).pipe(takeUntil(disconnect$));
  }

  removeConnection(userId: string, agentId: string, connectionId: string): void {
    this.connections.delete(connectionId);
    const agentKey = `${userId}:${agentId}`;
    const set = this.agentConnections.get(agentKey);
    if (!set) return;
    set.delete(connectionId);
    if (set.size === 0) {
      this.agentConnections.delete(agentKey);
    }
  }

  publishStatus(
    userId: string,
    agentId: string,
    integration: WhatsAppIntegrationResponseDto,
  ): void {
    const agentKey = `${userId}:${agentId}`;
    const connectionIds = this.agentConnections.get(agentKey);
    if (!connectionIds?.size) return;

    const event: WhatsAppIntegrationSseEvent = {
      type: 'status',
      agentId,
      data: integration,
    };
    for (const connectionId of connectionIds) {
      const conn = this.connections.get(connectionId);
      if (!conn) continue;
      conn.subject.next(event);
    }
  }
}
