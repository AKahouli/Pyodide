import { firstValueFrom, Subject, take, toArray, Observable } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ResponseInterceptor } from '../../response/interceptors/response.interceptor';
import { StreamGatewayService } from './stream-gateway.service';
import type { MessageEvent } from '@nestjs/common';
import type { StreamChunkEvent, StreamEvent } from '../interfaces/stream.interface';

type GatewayConfig = Record<string, unknown>;

function buildGateway(config: GatewayConfig = {}): StreamGatewayService {
  const configService = {
    get: (key: string, defaultValue: unknown) =>
      key in config ? config[key] : defaultValue,
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return new StreamGatewayService(configService as never, logger as never);
}

function chunk(sequence: number): StreamEvent {
  return {
    type: 'stream_chunk',
    data: {
      conversationId: 'conv-1',
      action: 'update',
      component: {
        id: `comp-${String(sequence)}`,
        type: 'text',
        data: { content: `chunk-${String(sequence)}` },
      },
    },
  } as unknown as StreamChunkEvent;
}

function contentOf(frame: MessageEvent): string {
  return (frame.data as { component: { data: { content: string } } }).component.data.content;
}

async function collect(
  observable: Observable<MessageEvent>,
  count: number,
): Promise<MessageEvent[]> {
  return firstValueFrom(observable.pipe(take(count), toArray()));
}

describe('StreamGatewayService', () => {
  let gateway: StreamGatewayService;
  const disconnect$ = new Subject<void>();

  afterEach(() => {
    gateway.onModuleDestroy();
    disconnect$.next();
    jest.useRealTimers();
  });

  it('replays events the user missed while disconnected, in order, ahead of live events', async () => {
    gateway = buildGateway();

    const live = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 1);
    gateway.sendToUser('user-1', chunk(1));
    const [first] = await live;
    const [bootId, generation, firstSeq] = (first.id as string).split(':');
    expect(firstSeq).toBe('1');

    gateway.removeConnection('user-1', 'conn-1');

    // Recorded with zero live connections — exactly the delayed-POST window.
    gateway.sendToUser('user-1', chunk(2));
    gateway.sendToUser('user-1', chunk(3));

    const reconnected = collect(
      gateway.registerConnection('user-1', 'conn-2', disconnect$, first.id)!,
      2,
    );
    gateway.sendToUser('user-1', chunk(4));
    const frames = await reconnected;

    expect(frames.map(contentOf)).toEqual(['chunk-2', 'chunk-3']);
    expect(frames.map((frame) => frame.id)).toEqual([
      `${bootId}:${generation}:2`,
      `${bootId}:${generation}:3`,
    ]);
  });

  it('preserves the replay cursor inside the SSE payload when the global response envelope wraps frames', async () => {
    gateway = buildGateway();

    const live = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 1);
    gateway.sendToUser('user-1', chunk(1));
    const [first] = await live;
    gateway.sendToUser('user-1', chunk(2));
    gateway.removeConnection('user-1', 'conn-1');

    const replay$ = gateway.registerConnection('user-1', 'conn-2', disconnect$, first.id)!;
    const interceptor = new ResponseInterceptor(new Reflector());
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ url: '/api/conversations/stream' }) }),
    } as unknown as ExecutionContext;

    // The ResponseInterceptor wraps every emitted frame; the value Nest's
    // SseStream then serializes into the `data:` line is `wrapped.data`. The
    // cursor must survive inside that payload — the wire `id:` line only
    // carries the envelope's auto-assigned counter, so clients resume from
    // the payload field, not from native lastEventId.
    const wrapped = await firstValueFrom(
      interceptor
        .intercept(context, { handle: () => replay$ } as unknown as CallHandler)
        .pipe(take(1)),
    );
    const payload = (wrapped as { data: { id?: string; type?: string } }).data;
    const [bootId, generation] = (first.id as string).split(':');
    expect(payload.id).toBe(`${bootId}:${generation}:2`);
    expect(payload.type).toBe('stream_chunk');
  });

  it('does not replay to a first connection that sends no cursor', async () => {
    gateway = buildGateway();
    gateway.sendToUser('user-1', chunk(1));

    const pending = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 1);
    gateway.sendToUser('user-1', chunk(2));
    const frames = await pending;

    expect(frames).toHaveLength(1);
    expect(contentOf(frames[0])).toBe('chunk-2');
  });

  it('emits stream_resync_required without replay when the cursor predates the window', async () => {
    gateway = buildGateway({ 'conversation.sseReplayMaxEvents': 2 });

    const live = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 4);
    for (let sequence = 1; sequence <= 4; sequence += 1) gateway.sendToUser('user-1', chunk(sequence));
    const frames1to4 = await live;
    const clientCursor = frames1to4[0].id as string; // seq 1
    const oldestRetainedCursor = frames1to4[2].id as string; // seq 3: seq 2 was evicted

    gateway.removeConnection('user-1', 'conn-1');

    // Replaying the retained window would skip seq 2 — resync, don't guess.
    const frames = await collect(
      gateway.registerConnection('user-1', 'conn-2', disconnect$, clientCursor)!,
      1,
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('stream_resync_required');
    expect((frames[0].data as { reason: string }).reason).toBe('cursor_gap');
    expect((frames[0].data as { oldestRetainedCursor?: string }).oldestRetainedCursor).toBe(
      oldestRetainedCursor,
    );
  });

  it('emits stream_resync_required for a cursor this instance never issued', async () => {
    gateway = buildGateway();
    gateway.sendToUser('user-1', chunk(1));

    const frames = await collect(
      gateway.registerConnection('user-1', 'conn-1', disconnect$, 'other-instance:3')!,
      1,
    );

    expect(frames[0].type).toBe('stream_resync_required');
    expect((frames[0].data as { reason: string }).reason).toBe('unknown_instance');
  });

  it('emits stream_resync_required once the idle replay window has expired', async () => {
    jest.useFakeTimers();
    gateway = buildGateway({ 'conversation.sseReplayTtlMs': 5000 });

    const live = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 1);
    gateway.sendToUser('user-1', chunk(1));
    const [cursor] = await live;

    gateway.removeConnection('user-1', 'conn-1');
    jest.advanceTimersByTime(20_000);

    const frames = await collect(
      gateway.registerConnection('user-1', 'conn-2', disconnect$, cursor.id as string)!,
      1,
    );

    expect(frames[0].type).toBe('stream_resync_required');
    expect((frames[0].data as { reason: string }).reason).toBe('cursor_gap');
  });

  it('emits stream_resync_required for a cursor from a swept buffer instead of replaying the recreated window', async () => {
    jest.useFakeTimers();
    gateway = buildGateway({ 'conversation.sseReplayTtlMs': 5000 });

    const live = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 1);
    gateway.sendToUser('user-1', chunk(1));
    const [stale] = await live;

    // Idle TTL: the sweep deletes the user's buffer, and a later event
    // recreates it with lastSeq restarting at 1.
    gateway.removeConnection('user-1', 'conn-1');
    jest.advanceTimersByTime(20_000);
    gateway.sendToUser('user-1', chunk(2));

    // Without a fresh generation the recreated buffer would treat the old
    // cursor as current and replay chunk-2 alone — silently omitting the new
    // window's stream_start. The generation mismatch must force a resync.
    const frames = await collect(
      gateway.registerConnection('user-1', 'conn-2', disconnect$, stale.id as string)!,
      1,
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('stream_resync_required');
    expect((frames[0].data as { reason: string }).reason).toBe('cursor_gap');
  });

  it('keeps a current cursor gap-free across a sweep while the user stayed connected', async () => {
    jest.useFakeTimers();
    gateway = buildGateway({ 'conversation.sseReplayTtlMs': 5000 });

    const live = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 1);
    gateway.sendToUser('user-1', chunk(1));
    const [cursor] = await live;

    jest.advanceTimersByTime(20_000);
    gateway.removeConnection('user-1', 'conn-1');
    gateway.sendToUser('user-1', chunk(2));

    const frames = await collect(
      gateway.registerConnection('user-1', 'conn-2', disconnect$, cursor.id as string)!,
      1,
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('stream_chunk');
    expect(contentOf(frames[0])).toBe('chunk-2');
  });

  it('reconnects without resync when a caught-up cursor survives an emptied window', async () => {
    jest.useFakeTimers();
    gateway = buildGateway({ 'conversation.sseReplayTtlMs': 5000 });

    const live = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 1);
    gateway.sendToUser('user-1', chunk(1));
    const [cursor] = await live;

    // Sweep empties the entries of the still-connected user's buffer.
    jest.advanceTimersByTime(20_000);
    gateway.removeConnection('user-1', 'conn-1');

    // Regression: empty entries + seq === lastSeq must not crash buildReplay$
    // nor request a needless resync — the client is provably current.
    const reconnected = collect(
      gateway.registerConnection('user-1', 'conn-2', disconnect$, cursor.id as string)!,
      1,
    );
    gateway.sendToUser('user-1', chunk(2));
    const frames = await reconnected;

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('stream_chunk');
    expect(contentOf(frames[0])).toBe('chunk-2');
  });

  it('emits stream_resync_required when the window emptied while the cursor lagged', async () => {
    jest.useFakeTimers();
    gateway = buildGateway({ 'conversation.sseReplayTtlMs': 5000 });

    const live = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 2);
    gateway.sendToUser('user-1', chunk(1));
    gateway.sendToUser('user-1', chunk(2));
    const frames1to2 = await live;
    const laggingCursor = frames1to2[0].id as string; // seq 1 of 2

    jest.advanceTimersByTime(20_000);
    gateway.removeConnection('user-1', 'conn-1');

    // seq 1 < lastSeq with no retained entries: unverifiable continuity.
    const frames = await collect(
      gateway.registerConnection('user-1', 'conn-2', disconnect$, laggingCursor)!,
      1,
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('stream_resync_required');
    expect((frames[0].data as { reason: string }).reason).toBe('cursor_gap');
  });

  it('keeps replay windows isolated per user', async () => {
    gateway = buildGateway();

    const liveA = collect(gateway.registerConnection('user-a', 'conn-a1', disconnect$)!, 1);
    const liveB = collect(gateway.registerConnection('user-b', 'conn-b1', disconnect$)!, 1);
    gateway.sendToUser('user-a', chunk(1));
    gateway.sendToUser('user-b', chunk(2));
    const [cursorA] = await liveA;
    const [cursorB] = await liveB;

    gateway.removeConnection('user-a', 'conn-a1');
    gateway.removeConnection('user-b', 'conn-b1');

    // Each user now records a missed event in its own window only.
    gateway.sendToUser('user-a', chunk(3));
    gateway.sendToUser('user-b', chunk(4));

    const framesB = await collect(
      gateway.registerConnection('user-b', 'conn-b2', disconnect$, cursorB.id as string)!,
      1,
    );

    // A shared window would surface user-a's chunk-3 here first.
    expect(framesB).toHaveLength(1);
    expect(contentOf(framesB[0])).toBe('chunk-4');
    expect(cursorB).not.toBe(cursorA);
  });

  it('does not record or replay when the replay window is disabled', async () => {
    gateway = buildGateway({ 'conversation.sseReplayEnabled': false });
    gateway.sendToUser('user-1', chunk(1));

    const pending = collect(
      gateway.registerConnection('user-1', 'conn-1', disconnect$, 'whatever:1')!,
      1,
    );
    gateway.sendToUser('user-1', chunk(2));
    const frames = await pending;

    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBeUndefined();
    expect(frames[0].type).toBe('stream_chunk');
  });

  it('delivers live events to every connection of the same user', async () => {
    gateway = buildGateway();

    const first = collect(gateway.registerConnection('user-1', 'conn-1', disconnect$)!, 1);
    const second = collect(gateway.registerConnection('user-1', 'conn-2', disconnect$)!, 1);
    gateway.sendToUser('user-1', chunk(1));

    const [framesFirst, framesSecond] = await Promise.all([first, second]);
    expect(framesFirst).toHaveLength(1);
    expect(framesSecond).toHaveLength(1);
    expect(framesFirst[0].id).toBe(framesSecond[0].id);
  });
});
