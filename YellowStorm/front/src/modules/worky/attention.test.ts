import { describe, expect, it, vi } from 'vitest';
import { findNewAttention, playAttentionChime } from './attention';
import type { WorkyCurrentWorkItem } from './executive/executiveModel';

const item = (id: string, status: WorkyCurrentWorkItem['status']): WorkyCurrentWorkItem =>
  ({ task: { id }, status } as WorkyCurrentWorkItem);

describe('findNewAttention', () => {
  it('does not alert for attention tasks already present on initial load', () => {
    const result = findNewAttention(null, [item('a', 'failed')]);
    expect(result.taskId).toBeNull();
  });

  it('alerts once when a task enters attention and chooses the first priority item', () => {
    const baseline = findNewAttention(null, [item('a', 'pending'), item('b', 'running')]);
    const changed = findNewAttention(baseline.current, [item('a', 'blocked'), item('b', 'failed')]);
    expect(changed.taskId).toBe('a');
    expect(findNewAttention(changed.current, [item('a', 'blocked'), item('b', 'failed')]).taskId).toBeNull();
  });

  it('does not chime for passive external waits', () => {
    const baseline = findNewAttention(null, [item('a', 'pending')]);
    expect(findNewAttention(baseline.current, [item('a', 'waiting_external')]).taskId).toBeNull();
  });

  it('does not replay the chime when an already urgent task changes status', () => {
    const baseline = findNewAttention(null, [item('a', 'blocked')]);
    expect(findNewAttention(baseline.current, [item('a', 'failed')]).taskId).toBeNull();
  });

  it('plays a two-tone ding-dong', async () => {
    const frequencies: number[] = [];
    const close = vi.fn();
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = () => Promise.resolve();
      close = close;
      createOscillator = () => {
        const frequency = { value: 0 };
        return { frequency, type: 'sine', connect: () => {}, start: () => frequencies.push(frequency.value), stop: () => {} };
      };
      createGain = () => ({ gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} });
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.useFakeTimers();
    try {
      playAttentionChime();
      await Promise.resolve();
      expect(frequencies).toEqual([784, 587]);
      vi.runAllTimers();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
