import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyChunksToComponents, StreamingBuffer } from './stream-buffer';

describe('StreamingBuffer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('merges replayed agent activity adds by identity across flushes', () => {
    const activity = { id: 'activity-1', type: 'agentActivity' as const, data: { summary: 'Inspect the report', status: 'completed' } };
    const first = applyChunksToComponents([], [{ action: 'add', component: activity }]);
    const replay = applyChunksToComponents(first, [
      { action: 'add', component: { ...activity, data: { detail: 'Full reasoning' } } },
      { action: 'add', component: { ...activity, id: 'activity-2' } },
    ]);
    expect(replay).toHaveLength(2);
    expect(replay[0].data).toEqual({ ...activity.data, detail: 'Full reasoning' });
    expect(first[0].data).not.toHaveProperty('detail');
  });

  it('coalesces chunks per frame without mixing concurrent conversation sessions', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    let first = applyChunksToComponents([], []);
    let second = applyChunksToComponents([], []);
    const firstBuffer = new StreamingBuffer();
    const secondBuffer = new StreamingBuffer();
    firstBuffer.setFlushCallback((chunks) => { first = applyChunksToComponents(first, chunks); });
    secondBuffer.setFlushCallback((chunks) => { second = applyChunksToComponents(second, chunks); });

    firstBuffer.addChunk('add', { id: 'text-1', type: 'text', data: { content: 'Hello ' } });
    firstBuffer.addChunk('update', { id: 'text-1', type: 'text', data: { content: 'world' } });
    secondBuffer.addChunk('add', { id: 'activity-1', type: 'agentActivity', data: { summary: 'Working' } });

    expect(frames).toHaveLength(2);
    frames.forEach((frame) => frame(16));
    expect(first[0]?.data.content).toBe('Hello world');
    expect(first).toHaveLength(1);
    expect(second).toEqual([{ id: 'activity-1', type: 'agentActivity', data: { summary: 'Working' } }]);
  });

  it('cancels pending work on clear and discards snapshot-covered revisions', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let components = applyChunksToComponents([], []);
    const buffer = new StreamingBuffer();
    buffer.setFlushCallback((chunks) => { components = applyChunksToComponents(components, chunks); });

    buffer.addChunk('add', { id: 'stale', type: 'text', data: { content: 'stale' } }, 1);
    buffer.addChunk('add', { id: 'fresh', type: 'text', data: { content: 'fresh' } }, 2);
    buffer.discardThrough(1);
    buffer.flush();
    expect(components.map((component) => component.id)).toEqual(['fresh']);

    buffer.addChunk('add', { id: 'cancelled', type: 'text', data: { content: 'cancelled' } }, 3);
    buffer.clear();
    frames.forEach((frame) => frame(16));
    expect(components.map((component) => component.id)).toEqual(['fresh']);
  });

  it('drops an overflowing queue and requests canonical recovery', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const overflow = vi.fn();
    const buffer = new StreamingBuffer();
    buffer.setFlushCallback(vi.fn());
    buffer.setOverflowCallback(overflow);

    for (let index = 0; index <= 500; index += 1) {
      buffer.addChunk('add', { id: `text-${index}`, type: 'text', data: { content: String(index) } }, index);
    }

    expect(overflow).toHaveBeenCalledOnce();
  });
});

describe('applyChunksToComponents agentActivity deltas', () => {
  const base = [{ id: 'activity-1', type: 'agentActivity' as const, data: { summary: 'The', detail: 'The', status: 'completed' } }];
  const update = (data: Record<string, unknown>) => ({ action: 'update' as const, component: { id: 'activity-1', type: 'agentActivity' as const, data } });

  it('appends detailDelta to the current detail without leaking wire-only fields', () => {
    const result = applyChunksToComponents(base, [
      update({ summary: 'The user', detailDelta: ' user', detailOffset: 3 }),
      update({ detailDelta: ' wants', detailOffset: 8 }),
    ]);

    expect(result[0].data).toEqual({ summary: 'The user', detail: 'The user wants', status: 'completed' });
  });

  it('still accepts full-replacement updates', () => {
    const result = applyChunksToComponents(base, [update({ summary: 'Rewritten', detail: 'Rewritten', status: 'completed' })]);

    expect(result[0].data).toEqual({ summary: 'Rewritten', detail: 'Rewritten', status: 'completed' });
  });

  it('applies a replayed delta idempotently', () => {
    const delta = update({ detailDelta: ' user', detailOffset: 3 });
    const result = applyChunksToComponents(base, [delta, delta]);

    expect(result[0].data.detail).toBe('The user');
  });

  it('does not fabricate text across a missed delta', () => {
    const result = applyChunksToComponents(base, [update({ detailDelta: ' wants', detailOffset: 8 })]);

    expect(result[0].data).toEqual({ summary: 'The', detail: 'The', status: 'completed' });
  });

  it('reproduces a full snapshot plus newer deltas', () => {
    const snapshot = [{ id: 'activity-1', type: 'agentActivity' as const, data: { summary: 'The user', detail: 'The user', status: 'completed' } }];
    const result = applyChunksToComponents(snapshot, [update({ detailDelta: ' wants', detailOffset: 8 })]);

    expect(result[0].data.detail).toBe('The user wants');
  });
});
