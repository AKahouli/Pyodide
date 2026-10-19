import { Inject, Injectable, OnModuleDestroy, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
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
 *
 * `generation` comes from a process-wide counter, not the buffer itself: when
 * the sweep deletes an idle user's buffer and a later event recreates it,
 * `lastSeq` restarts at 1 — without a fresh generation the new event would
 * reissue a cursor an old event already used, and a client resuming from that
 * old cursor would silently miss the new window's `stream_start`.
 */
interface UserReplayBuffer {
  entries: ReplayEntry[];
  lastSeq: number;
  generation: number;
}

@Injectable()
export class StreamGatewayService implements OnModuleDestroy {
  private connections = new Map<string, SSEConnection>();
  private userConnections = new Map<string, Set<string>>();

  /** Cursor namespace — cursors from another process can never be replayed. */
  private readonly bootId = randomUUID();
  /** Monotonic buffer-generation source; never reused within this process. */
  private nextReplayGeneration = 0;
  private readonly replayEnabled: boolean;
  private readonly replayMaxEvents: number;
  private readonly replayTtlMs: number;
  private readonly replayBuffers = new Map<string, UserReplayBuffer>();
  private replaySweepTimer: ReturnType<typeof setInterval> | null = null;

  private pending: { userId: string; conversationId: string | null; event: StreamEvent; bytes: number }[] = [];
  private pendingBytes = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private destroyed = false;
  private readonly globalResyncRecipient = '000000000000000000000000';
  private readonly maxPendingEvents = 1000;
  private readonly maxPendingBytes = 8 * 1024 * 1024;

  async onModuleInit(): Promise<void> {
    if (!this.db) throw new Error('Conversation SSE requires PostgreSQL');
    await this.db.execute(sql`SELECT 1 FROM conversation.sse_events LIMIT 0`);
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    @Inject(DRIZZLE_DB) private readonly db?: NodePgDatabase<typeof schema>,
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
    this.destroyed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
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

    if (this.db) {
      return merge(this.distributedEvents$(connection, lastSeenCursor), heartbeat$).pipe(takeUntil(disconnect$));
    }

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
    if (this.db) {
      this.enqueue(userId, event);
      return this.isUserConnected(userId);
    }
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

  /** No database round trip on the per-token producer path. */
  private enqueue(userId: string, event: StreamEvent): void {
    if (this.destroyed) return;
    const conversationId = 'conversationId' in event.data && typeof event.data.conversationId === 'string'
      ? event.data.conversationId : null;
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
    if (bytes > 1024 * 1024 || this.pending.length >= this.maxPendingEvents || this.pendingBytes + bytes > this.maxPendingBytes) {
      // Replacing this recipient's queued deltas with a small durable marker
      // makes overload explicit on every replica, including later reconnects.
      const kept = this.pending.filter(entry => entry.userId !== userId);
      this.pending = kept;
      this.pendingBytes = kept.reduce((total, entry) => total + entry.bytes, 0);
      const resync = this.buildResyncEvent('cursor_gap', '', undefined);
      if (this.pending.length >= this.maxPendingEvents || this.pendingBytes + 128 > this.maxPendingBytes) {
        // Bound recipient cardinality as well. Disconnecting forces the next
        // connection to reconcile canonical state before the retained window.
        this.closeForResync();
        this.pending = [];
        this.pendingBytes = 0;
        userId = this.globalResyncRecipient;
      }
      this.pending.push({ userId, conversationId: null, event: resync, bytes: 128 });
      this.pendingBytes += 128;
    } else {
      this.pending.push({ userId, conversationId, event, bytes });
      this.pendingBytes += bytes;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(delayMs = 25): void {
    if (this.flushTimer || this.flushing || this.destroyed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending();
    }, delayMs);
    this.flushTimer.unref();
  }

  private async flushPending(): Promise<void> {
    if (!this.db || this.flushing || !this.pending.length || this.destroyed) return;
    this.flushing = true;
    let failed = false;
    const batch = this.pending.splice(0, 100);
    this.pendingBytes -= batch.reduce((sum, entry) => sum + entry.bytes, 0);
    try {
      await this.db.transaction(async tx => {
        // Identity allocation after a transaction lock ensures visibility in
        // committed sequence order. Never allocate cursors before this lock.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(73125, 1)`);
        const values = batch.map(entry => sql`(${entry.userId}, ${entry.conversationId}, ${JSON.stringify(entry.event)}::jsonb)`);
        await tx.execute(sql`INSERT INTO conversation.sse_events (user_id, conversation_id, event) VALUES ${sql.join(values, sql`, `)}`);
        const users = [...new Set(batch.map(entry => entry.userId))];
        await tx.execute(sql`DELETE FROM conversation.sse_events WHERE id IN (
          SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY id DESC) AS rank
            FROM conversation.sse_events WHERE event->>'type' = 'stream_resync_required'
            AND user_id IN (${sql.join(users.map(user => sql`${user}`), sql`, `)})) markers WHERE rank > 1
        )`);
        await tx.execute(sql`DELETE FROM conversation.sse_events WHERE id IN (
          SELECT id FROM (SELECT id, created_at, row_number() OVER (PARTITION BY user_id ORDER BY (event->>'type' = 'stream_resync_required') DESC, id DESC) AS rank
          FROM conversation.sse_events WHERE user_id IN (${sql.join(users.map(user => sql`${user}`), sql`, `)})) retained
          WHERE rank > ${this.replayMaxEvents} OR created_at < now() - ${this.replayTtlMs} * interval '1 millisecond'
        )`);
        await tx.execute(sql`DELETE FROM conversation.sse_events WHERE id IN (
          SELECT id FROM conversation.sse_events WHERE created_at < now() - ${this.replayTtlMs} * interval '1 millisecond' LIMIT 2000
        )`);
      });
    } catch {
      failed = true;
      // Keep bounded, durable recovery markers instead of claiming live
      // success after a failed write. No content or driver diagnostics logged.
      for (const userId of new Set(batch.map(entry => entry.userId))) {
        this.enqueue(userId, this.buildResyncEvent('cursor_gap', '', undefined));
      }
      this.logger.warn('Conversation SSE persistence unavailable');
      this.closeForResync();
    } finally {
      this.flushing = false;
      if (this.pending.length) this.scheduleFlush(failed ? 1000 : 25);
    }
  }

  private closeForResync(): void {
    for (const connection of [...this.connections.values()]) {
      if (connection.resync) connection.resync();
      else connection.subject.next({ event: this.buildResyncEvent('cursor_gap', '', undefined) });
      this.removeConnection(connection.userId, connection.connectionId);
    }
  }

  /** Every connection reads committed recipient rows and rechecks current access. */
  private distributedEvents$(connection: SSEConnection, cursor?: string): Observable<MessageEvent> {
    return new Observable(subscriber => {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let lastId: string | null = /^pg:1:[0-9]{1,15}$/.test(cursor ?? '') ? cursor!.split(':')[2] : null;
      let lastReconciledAt = Date.now();
      const resync = () => {
        lastReconciledAt = Date.now();
        subscriber.next(this.toMessageEvent({ event: this.buildResyncEvent('cursor_gap', cursor ?? '', undefined) }));
      };
      connection.resync = resync;
      // New connections reconcile snapshots as well: a producer can crash
      // before an asynchronous batch commits, so absence cannot prove continuity.
      if (!lastId) resync();
      const poll = async () => {
        try {
          // An asynchronous producer can die before committing its final
          // batch while this remote pipe remains healthy. Bound that blind
          // spot with canonical reconciliation, independently of reconnect.
          if (Date.now() - lastReconciledAt >= 30000) resync();
          const result = await this.db!.execute(sql`SELECT anchor.anchor_valid, event_rows.* FROM (
            SELECT (${lastId}::bigint IS NULL OR EXISTS (SELECT 1 FROM conversation.sse_events
              WHERE (user_id = ${connection.userId} OR user_id = ${this.globalResyncRecipient})
              AND id = ${lastId}::bigint AND created_at >= now() - ${this.replayTtlMs} * interval '1 millisecond'
              AND id >= COALESCE((SELECT min(retained.id) FROM conversation.sse_events retained
                WHERE (retained.user_id = ${connection.userId} OR retained.user_id = ${this.globalResyncRecipient})
                AND retained.event->>'type' <> 'stream_resync_required'
                AND retained.created_at >= now() - ${this.replayTtlMs} * interval '1 millisecond'), id))) AS anchor_valid
            ) anchor LEFT JOIN LATERAL (SELECT e.id::text AS id, e.event,
            (e.conversation_id IS NULL OR EXISTS (SELECT 1 FROM conversation.conversations c
              WHERE c.id = e.conversation_id AND (c.created_by = ${connection.userId} OR
                (c.is_group AND EXISTS (SELECT 1 FROM conversation.conversation_group_members m
                WHERE m.conversation_id = c.id AND m.user_id = ${connection.userId}))))) AS allowed
            FROM conversation.sse_events e WHERE (e.user_id = ${connection.userId} OR e.user_id = ${this.globalResyncRecipient})
            AND e.id > ${lastId ?? '0'}::bigint
            AND e.created_at >= now() - ${this.replayTtlMs} * interval '1 millisecond'
            ORDER BY e.id LIMIT ${this.replayMaxEvents}) event_rows ON true`);
          if (stopped) return;
          if (result.rows[0]?.anchor_valid === false) { resync(); lastId = null; return; }
          for (const row of result.rows) {
            if (row.id == null) continue;
            lastId = String(row.id);
            if (row.allowed) subscriber.next(this.toMessageEvent({ event: row.event as StreamEvent, cursorId: `pg:1:${lastId}` }));
          }
        } catch {
          if (!stopped) {
            resync();
            subscriber.complete();
            this.removeConnection(connection.userId, connection.connectionId);
          }
        } finally {
          if (!stopped && !subscriber.closed) {
            timer = setTimeout(() => void poll(), 200);
            timer.unref();
          }
        }
      };
      void poll();
      return () => { stopped = true; connection.resync = undefined; if (timer) clearTimeout(timer); };
    });
  }

  private recordReplay(userId: string, event: StreamEvent): string | null {
    if (!this.replayEnabled) return null;

    let buffer = this.replayBuffers.get(userId);
    if (!buffer) {
      buffer = { entries: [], lastSeq: 0, generation: ++this.nextReplayGeneration };
      this.replayBuffers.set(userId, buffer);
    }
    buffer.lastSeq += 1;
    const entry: ReplayEntry = {
      cursorId: `${this.bootId}:${buffer.generation}:${buffer.lastSeq}`,
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
   * cursor (`<bootId>:<generation>:<seq>`). Withholds replay and emits
   * `stream_resync_required` when continuity cannot be proven (unknown cursor
   * namespace, a generation from a swept-and-recreated buffer window, or a
   * cursor older than the retained window) — the client then reconciles from
   * canonical state instead of silently continuing with gaps.
   */
  private buildReplay$(userId: string, lastSeenCursor?: string): Observable<MessageEvent> {
    if (!this.replayEnabled || !lastSeenCursor) return EMPTY;

    const parts = lastSeenCursor.split(':');
    const bootId = parts.length === 3 ? parts[0] : '';
    const generation = parts.length === 3 ? Number.parseInt(parts[1], 10) : Number.NaN;
    const seq = parts.length === 3 ? Number.parseInt(parts[2], 10) : Number.NaN;

    if (bootId !== this.bootId || !Number.isInteger(seq)) {
      return of(
        this.toMessageEvent({
          event: this.buildResyncEvent('unknown_instance', lastSeenCursor, undefined),
        }),
      );
    }

    const buffer = this.replayBuffers.get(userId);
    if (!buffer || buffer.generation !== generation || seq > buffer.lastSeq) {
      // No history here, a cursor from a swept-and-recreated buffer window, or
      // a cursor this buffer never issued (pruned window).
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
  resync?: () => void;
}
