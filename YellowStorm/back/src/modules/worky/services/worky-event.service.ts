import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Subject, Observable, merge, interval, map, takeUntil, filter } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { WorkyEvent, WorkyEventType } from '../interfaces/worky-event.interface';

interface WorkySseConnection {
  connectionId: string;
  userId: string;
  streamId: string;
  subject: Subject<WorkyEvent>;
  disconnect$: Subject<void>;
  createdAt: number;
}

/**
 * Per-(user, stream) SSE gateway. Mirrors the conversation-v2 pattern but
 * key the connection set by `userId + streamId` so opening two streams
 * doesn't cross-deliver events.
 *
 * TODO(Part 3): durable event replay — the canonical plan calls for
 *   persisting events in a `worky_events` collection and replaying missed
 *   events on connect. In Part 1 the channel is fire-and-forget; if the
 *   client misses a frame it will fetch via REST on reconnect.
 */
type ManagerMessageHook = (streamId: string, text: string) => void;

@Injectable()
export class WorkyEventService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkyEventService.name);
  private readonly connections = new Map<string, WorkySseConnection>();
  private readonly streamConnections = new Map<string, Set<string>>();
  private readonly managerMessageHooks: ManagerMessageHook[] = [];

  constructor(private readonly config: ConfigService) {}

  onModuleDestroy(): void {
    for (const conn of this.connections.values()) {
      conn.subject.complete();
      conn.disconnect$.next();
      conn.disconnect$.complete();
    }
    this.connections.clear();
    this.streamConnections.clear();
  }

  /**
   * Returns a per-connection `Observable<MessageEvent>` for one user+stream.
   * Emits the live event stream mixed with periodic heartbeats. `null` is
   * returned when the per-user SSE cap is reached; the controller turns
   * that into a 429 frame.
   */
  registerConnection(
    userId: string,
    streamId: string,
    connectionId: string,
    disconnect$: Subject<void>,
  ): Observable<MessageEvent> | null {
    const max = this.config.get<number>('worky.maxSseConnections') ?? 5;
    const userKey = `${userId}:${streamId}`;
    const existing = this.streamConnections.get(userKey);
    if (existing && existing.size >= max) {
      this.logger.warn('Worky SSE connection cap reached', { userId, streamId, max });
      return null;
    }

    const subject = new Subject<WorkyEvent>();
    const connection: WorkySseConnection = {
      connectionId,
      userId,
      streamId,
      subject,
      disconnect$,
      createdAt: Date.now(),
    };
    this.connections.set(connectionId, connection);
    if (!this.streamConnections.has(userKey)) {
      this.streamConnections.set(userKey, new Set());
    }
    this.streamConnections.get(userKey)!.add(connectionId);
    this.logger.log('[worky-sse] connection registered', {
      userId,
      streamId,
      connectionId,
      total: this.streamConnections.get(userKey)!.size,
    });

    const heartbeatMs = this.config.get<number>('worky.sseHeartbeatMs') ?? 15000;
    const heartbeat$ = interval(heartbeatMs).pipe(
      map(
        () =>
          ({
            type: 'heartbeat' as WorkyEventType,
            data: { streamId, timestamp: Date.now() },
          }) as MessageEvent,
      ),
    );
    const events$ = subject.pipe(
      filter((event) => event.streamId === streamId),
      map((event) => ({ type: event.type, data: event }) as MessageEvent),
    );
    return merge(events$, heartbeat$).pipe(takeUntil(disconnect$));
  }

  removeConnection(userId: string, streamId: string, connectionId: string): void {
    this.connections.delete(connectionId);
    const userKey = `${userId}:${streamId}`;
    const conns = this.streamConnections.get(userKey);
    if (conns) {
      conns.delete(connectionId);
      if (conns.size === 0) this.streamConnections.delete(userKey);
    }
  }

  /** Registers a hook called whenever a manager (AI) message is persisted. */
  registerManagerMessageHook(hook: ManagerMessageHook): void {
    this.managerMessageHooks.push(hook);
  }

  /** Called by WorkyPlanningService after a manager message is persisted. */
  notifyManagerMessage(streamId: string, text: string): void {
    for (const hook of this.managerMessageHooks) {
      try {
        hook(streamId, text);
      } catch (err) {
        this.logger.warn('Manager message hook threw', {
          streamId,
          error: (err as Error).message,
        });
      }
    }
  }

  /**
   * Publish an event to every open pipe for one (userId, streamId) pair.
   * No-op when the user has no live connection — the REST endpoints remain
   * the source of truth on reconnect.
   */
  emit(userId: string, streamId: string, event: Omit<WorkyEvent, 'streamId'>): void {
    const userKey = `${userId}:${streamId}`;
    const conns = this.streamConnections.get(userKey);
    this.logger.log('[worky-sse] emit', {
      userId,
      streamId,
      type: event.type,
      connectionCount: conns?.size ?? 0,
    });
    if (!conns || conns.size === 0) return;
    const enriched: WorkyEvent = { ...event, streamId };
    for (const connectionId of [...conns]) {
      const conn = this.connections.get(connectionId);
      if (!conn) continue;
      try {
        conn.subject.next(enriched);
      } catch (err) {
        this.logger.warn('Failed to push Worky SSE event', {
          connectionId,
          error: (err as Error).message,
        });
        this.removeConnection(userId, streamId, connectionId);
      }
    }
  }
}
