import { Injectable, OnModuleDestroy, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  Subject,
  Observable,
  concat,
  EMPTY,
  from,
  merge,
  of,
  interval,
  map,
  takeUntil,
} from 'rxjs';
import { StreamEvent, StreamResyncRequiredEvent } from '../interfaces/stream.interface';
import { LoggerService } from '../../logger';

/** Everything that travels through a connection's subject, cursor attached. */
interface OutboundEvent {
  event: StreamEvent;
  /** SSE `id:` value; absent for connection-local frames (heartbeat, connected). */
  cursorId?: string;
}

interface ReplayEntry {
  cursorId: string;
  seq: number;
  recordedAt: number;
  event: StreamEvent;
}

/**
 * Per-user replay window: the events this process broadcast to the user
 * recently, retained so a client that reconnects with a cursor can recover
 * what it missed while it had no connection. Bounded by item count and TTL.
 */
interface UserReplayBuffer {
  entries: ReplayEntry[];
  lastSeq: number;
}

@Injectable()
export class StreamGatewayService implements OnModuleDestroy {
  private connections = new Map<string, SSEConnection>();
  private userConnections = new Map<string, Set<string>>();

  /** Cursor namespace — cursors from another process can never be replayed. */
  private readonly bootId = randomUUID();
  private readonly replayEnabled: boolean;
  private readonly replayMaxEvents: number;
  private readonly replayTtlMs: number;
  private readonly replayBuffers = new Map<string, UserReplayBuffer>();
  private replaySweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('StreamGatewayService');
    this.replayEnabled = this.configService.get<boolean>(
      'conversation.sseReplayEnabled',
      true,
    );
    this.replayMaxEvents = this.configService.get<number>(
      'conversation.sseReplayMaxEvents',
      200,
    );
    this.replayTtlMs = this.configService.get<number>(
      'conversation.sseReplayTtlMs',
      120000,
    );
    if (this.replayEnabled) {
      const sweepIntervalMs = Math.min(
        Math.max(Math.round(this.replayTtlMs / 2), 15_000),
        300_000,
      );
      this.replaySweepTimer = setInterval(
        () => {
          this.sweepExpiredReplayBuffers();
        },
        sweepIntervalMs,
      );
      this.replaySweepTimer.unref();
    }
  }

  onModuleDestroy() {
    // Close all connections on shutdown
    for (const [, conn] of this.connections) {
      conn.subject.complete();
      conn.disconnect$.next();
      conn.disconnect$.complete();
    }
    this.connections.clear();
    this.userConnections.clear();
    if (this.replaySweepTimer) clearInterval(this.replaySweepTimer);
    this.replayBuffers.clear();
  }

  registerConnection(
    userId: string,
    connectionId: string,
    disconnect$: Subject<void>,
    lastSeenCursor?: string,
  ): Observable<MessageEvent> | null {
    const maxConnections = this.configService.get<number>(
      'conversation.maxSseConnections',
      5,
    );

    const userConns = this.userConnections.get(userId);
    if (userConns && userConns.size >= maxConnections) {
      this.logger.warn('SSE connection limit reached', { userId, max: maxConnections });
      return null;
    }

    const subject = new Subject<OutboundEvent>();

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
    this.userConnections.get(userId)?.add(connectionId);

    this.logger.log('Stream connection registered', { userId, connectionId });

    // Create the merged observable
    const heartbeatMs = this.configService.get<number>(
      'conversation.sseHeartbeatMs',
      15000,
    );

    const heartbeat$ = interval(heartbeatMs).pipe(
      map(() => this.toMessageEvent({
        event: { type: 'heartbeat', data: { timestamp: Date.now() } },
      })),
    );

    const events$ = subject.pipe(
      map((outbound) => this.toMessageEvent(outbound)),
    );

    // Replay (or resync notice) is snapshotted synchronously inside
    // registerConnection, before any live event can interleave: replayed
    // frames are strictly ordered ahead of the live stream with no gap.
    return concat(
      this.buildReplay$(userId, lastSeenCursor),
      merge(events$, heartbeat$).pipe(
        takeUntil(disconnect$),
      ),
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

    this.logger.log('Stream connection removed', { userId, connectionId });
  }

  sendToUser(userId: string, event: StreamEvent): boolean {
    // Record before the fan-out: a user with zero live connections keeps a
    // replay window so a soon-to-connect client can recover this event.
    const cursorId = this.recordReplay(userId, event);

    const userConns = this.userConnections.get(userId);
    if (!userConns || userConns.size === 0) {
      return false;
    }

    for (const connectionId of userConns) {
      const connection = this.connections.get(connectionId);
      if (connection) {
        try {
          connection.subject.next({ event, cursorId: cursorId ?? undefined });
          connection.lastActivity = new Date();
        } catch (error) {
          this.logger.warn('Failed to send event to connection', {
            connectionId,
            error: (error as Error).message,
          });
          this.removeConnection(userId, connectionId);
        }
      }
    }

    return true;
  }

  async broadcastToConversation(userIds: string[], event: StreamEvent): Promise<void> {
    await Promise.all(
      userIds.map((userId) => Promise.resolve(this.sendToUser(userId, event))),
    );
  }

  isUserConnected(userId: string): boolean {
    const conns = this.userConnections.get(userId);
    return !!conns && conns.size > 0;
  }

  getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size ?? 0;
  }

  private recordReplay(userId: string, event: StreamEvent): string | null {
    if (!this.replayEnabled) return null;

    let buffer = this.replayBuffers.get(userId);
    if (!buffer) {
      buffer = { entries: [], lastSeq: 0 };
      this.replayBuffers.set(userId, buffer);
    }
    buffer.lastSeq += 1;
    const entry: ReplayEntry = {
      cursorId: `${this.bootId}:${String(buffer.lastSeq)}`,
      seq: buffer.lastSeq,
      recordedAt: Date.now(),
      event,
    };
    buffer.entries.push(entry);
    if (buffer.entries.length > this.replayMaxEvents) {
      buffer.entries.splice(0, buffer.entries.length - this.replayMaxEvents);
    }
    return entry.cursorId;
  }

  /**
   * Frames delivered before the live stream for a client that resumes from a
   * cursor. Withholds replay and emits `stream_resync_required` when
   * continuity cannot be proven (unknown cursor namespace, pruned window, or
   * a cursor older than the retained window) — the client then reconciles
   * from canonical state instead of silently continuing with gaps.
   */
  private buildReplay$(userId: string, lastSeenCursor?: string): Observable<MessageEvent> {
    if (!this.replayEnabled || !lastSeenCursor) return EMPTY;

    const separatorIndex = lastSeenCursor.lastIndexOf(':');
    const bootId = separatorIndex > 0 ? lastSeenCursor.slice(0, separatorIndex) : '';
    const seq = separatorIndex > 0
      ? Number.parseInt(lastSeenCursor.slice(separatorIndex + 1), 10)
      : Number.NaN;

    if (bootId !== this.bootId || !Number.isInteger(seq)) {
      return of(
        this.toMessageEvent({
          event: this.buildResyncEvent('unknown_instance', lastSeenCursor, undefined),
        }),
      );
    }

    const buffer = this.replayBuffers.get(userId);
    if (!buffer || seq > buffer.lastSeq) {
      // No history here, or a cursor this buffer never issued (pruned window).
      return of(
        this.toMessageEvent({
          event: this.buildResyncEvent('cursor_gap', lastSeenCursor, undefined),
        }),
      );
    }

    if (buffer.entries.length === 0) {
      // Retention window fully elapsed. A caught-up client (seq === lastSeq)
      // has nothing to recover; anything older is unverifiable — resync.
      if (seq === buffer.lastSeq) return EMPTY;
      return of(
        this.toMessageEvent({
          event: this.buildResyncEvent('cursor_gap', lastSeenCursor, undefined),
        }),
      );
    }

    const oldestRetained = buffer.entries[0];
    if (seq + 1 < oldestRetained.seq) {
      return of(
        this.toMessageEvent({
          event: this.buildResyncEvent('cursor_gap', lastSeenCursor, oldestRetained.cursorId),
        }),
      );
    }

    return from(
      buffer.entries
        .filter((entry) => entry.seq > seq)
        .map((entry) => this.toMessageEvent({ event: entry.event, cursorId: entry.cursorId })),
    );
  }

  private buildResyncEvent(
    reason: StreamResyncRequiredEvent['data']['reason'],
    lastSeenCursor: string,
    oldestRetainedCursor: string | undefined,
  ): StreamResyncRequiredEvent {
    return {
      type: 'stream_resync_required',
      data: {
        reason,
        lastSeenCursor,
        ...(oldestRetainedCursor ? { oldestRetainedCursor } : {}),
      },
    };
  }

  /** Drop replay buffers whose retention window has fully elapsed. */
  private sweepExpiredReplayBuffers(): void {
    const cutoff = Date.now() - this.replayTtlMs;
    for (const [userId, buffer] of this.replayBuffers) {
      buffer.entries = buffer.entries.filter((entry) => entry.recordedAt >= cutoff);
      const hasConnections = (this.userConnections.get(userId)?.size ?? 0) > 0;
      // Buffers of connected users are kept even when empty: lastSeq is what
      // makes a reconnecting client's cursor provably current.
      if (!hasConnections && buffer.entries.length === 0) {
        this.replayBuffers.delete(userId);
      }
    }
  }

  private toMessageEvent(outbound: OutboundEvent): MessageEvent {
    const messageEvent: MessageEvent = {
      ...(outbound.cursorId ? { id: outbound.cursorId } : {}),
      type: outbound.event.type,
      data: outbound.event.data,
    };
    return messageEvent;
  }
}

interface SSEConnection {
  connectionId: string;
  userId: string;
  subject: Subject<OutboundEvent>;
  disconnect$: Subject<void>;
  createdAt: Date;
  lastActivity: Date;
}
