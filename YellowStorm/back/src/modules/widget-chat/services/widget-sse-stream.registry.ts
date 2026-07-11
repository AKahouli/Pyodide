import { Subject, Observable, merge, interval } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { MessageComponent } from '@modules/conversation/interfaces/message.interface';

export type WidgetStreamEvent = { type: string; data: Record<string, unknown> };

interface ActiveStream {
  subject: Subject<WidgetStreamEvent>;
  disconnect$: Subject<void>;
  buffer: Map<string, MessageComponent>;
  usage: { inputTokens: number; outputTokens: number; model: string };
  sseSubscribed: boolean;
}

/** In-memory SSE streams with buffering until the browser subscribes. */
export class WidgetSseStreamRegistry {
  private readonly activeStreams = new Map<string, ActiveStream>();
  private readonly pendingEvents = new Map<string, WidgetStreamEvent[]>();

  ensureSession(sessionId: string): void {
    if (!this.activeStreams.has(sessionId)) {
      this.activeStreams.set(sessionId, {
        subject: new Subject<WidgetStreamEvent>(),
        disconnect$: new Subject<void>(),
        buffer: new Map(),
        usage: { inputTokens: 0, outputTokens: 0, model: '' },
        sseSubscribed: false,
      });
    }
  }

  getActiveStream(sessionId: string): ActiveStream | undefined {
    return this.activeStreams.get(sessionId);
  }

  /** Clears accumulated components before a new gRPC run on the same session. */
  resetStreamBuffer(sessionId: string): void {
    const stream = this.activeStreams.get(sessionId);
    if (stream) {
      stream.buffer.clear();
    }
  }

  emit(sessionId: string, event: WidgetStreamEvent): void {
    this.ensureSession(sessionId);
    const stream = this.activeStreams.get(sessionId)!;
    if (!stream.sseSubscribed) {
      const queue = this.pendingEvents.get(sessionId) ?? [];
      queue.push(event);
      this.pendingEvents.set(sessionId, queue);
      return;
    }
    try {
      stream.subject.next(event);
    } catch {
      this.cleanup(sessionId);
    }
  }

  observe(sessionId: string, heartbeatMs: number): Observable<WidgetStreamEvent> {
    this.ensureSession(sessionId);
    const stream = this.activeStreams.get(sessionId)!;
    const events$ = stream.subject.asObservable();
    const heartbeat$ = interval(heartbeatMs).pipe(
      map(() => ({ type: 'heartbeat', data: { timestamp: Date.now() } })),
    );
    return new Observable<WidgetStreamEvent>((subscriber) => {
      stream.sseSubscribed = true;
      this.flushPending(sessionId);
      const sub = merge(events$, heartbeat$)
        .pipe(takeUntil(stream.disconnect$))
        .subscribe(subscriber);
      return () => {
        sub.unsubscribe();
        // Allow emit() to buffer again while the browser reconnects between turns.
        if (this.activeStreams.get(sessionId) === stream) {
          stream.sseSubscribed = false;
        }
      };
    });
  }

  cleanup(sessionId: string): void {
    const stream = this.activeStreams.get(sessionId);
    if (stream) {
      stream.subject.complete();
      stream.disconnect$.next();
      stream.disconnect$.complete();
      this.activeStreams.delete(sessionId);
    }
    this.pendingEvents.delete(sessionId);
  }

  private flushPending(sessionId: string): void {
    const pending = this.pendingEvents.get(sessionId);
    if (!pending?.length) return;
    const stream = this.activeStreams.get(sessionId);
    if (!stream) return;
    for (const event of pending) {
      stream.subject.next(event);
    }
    this.pendingEvents.delete(sessionId);
  }
}
