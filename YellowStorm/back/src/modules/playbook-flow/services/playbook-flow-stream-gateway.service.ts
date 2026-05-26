import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subject, Observable, merge, interval, map, takeUntil } from 'rxjs';
import { LoggerService } from '@modules/logger';

export interface PlaybookStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

interface SSEConnection {
  connectionId: string;
  userId: string;
  subject: Subject<PlaybookStreamEvent>;
  disconnect$: Subject<void>;
  createdAt: Date;
  lastActivity: Date;
}

@Injectable()
export class PlaybookFlowStreamGatewayService implements OnModuleDestroy {
  private connections = new Map<string, SSEConnection>();
  private userConnections = new Map<string, Set<string>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookFlowStreamGateway');
  }

  onModuleDestroy() {
    for (const [, conn] of this.connections) {
      conn.subject.complete();
      conn.disconnect$.next();
      conn.disconnect$.complete();
    }
    this.connections.clear();
    this.userConnections.clear();
  }

  registerConnection(
    userId: string,
    connectionId: string,
    disconnect$: Subject<void>,
  ): Observable<MessageEvent> | null {
    const maxConnections = this.configService.get<number>(
      'playbook-flow.maxSseConnections',
      5,
    );

    const userConns = this.userConnections.get(userId);
    if (userConns && userConns.size >= maxConnections) {
      this.logger.warn('Playbook SSE connection limit reached', { userId, max: maxConnections });
      return null;
    }

    const subject = new Subject<PlaybookStreamEvent>();

    const connection: SSEConnection = {
      connectionId,
      userId,
      subject,
      disconnect$,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.connections.set(connectionId, connection);

    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    this.logger.log('Playbook stream connection registered', { userId, connectionId });

    const heartbeatMs = this.configService.get<number>(
      'playbook-flow.sseHeartbeatMs',
      15000,
    );

    const heartbeat$ = interval(heartbeatMs).pipe(
      map(() => this.toMessageEvent({
        type: 'playbook_heartbeat',
        data: { timestamp: Date.now() },
      })),
    );

    const events$ = subject.pipe(
      map((event) => this.toMessageEvent(event)),
    );

    return merge(events$, heartbeat$).pipe(
      takeUntil(disconnect$),
    );
  }

  removeConnection(userId: string, connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.subject.complete();
      connection.disconnect$.next();
      connection.disconnect$.complete();
      this.connections.delete(connectionId);
    }

    const userConns = this.userConnections.get(userId);
    if (userConns) {
      userConns.delete(connectionId);
      if (userConns.size === 0) {
        this.userConnections.delete(userId);
      }
    }

    this.logger.log('Playbook stream connection removed', { userId, connectionId });
  }

  sendToUser(userId: string, event: PlaybookStreamEvent): boolean {
    const userConns = this.userConnections.get(userId);
    if (!userConns || userConns.size === 0) {
      return false;
    }

    for (const connectionId of userConns) {
      const connection = this.connections.get(connectionId);
      if (connection) {
        try {
          connection.subject.next(event);
          connection.lastActivity = new Date();
        } catch (error) {
          this.logger.warn('Failed to send playbook stream event', {
            connectionId,
            error: (error as Error).message,
          });
          this.removeConnection(userId, connectionId);
        }
      }
    }

    return true;
  }

  isUserConnected(userId: string): boolean {
    const conns = this.userConnections.get(userId);
    return !!conns && conns.size > 0;
  }

  private toMessageEvent(event: PlaybookStreamEvent): MessageEvent {
    return {
      type: event.type,
      data: event.data,
    } as MessageEvent;
  }
}
