import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAfterDelay } from './use-after-delay';

describe('useAfterDelay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns true only after the activity has lasted the delay, and false when it ends', () => {
    const { result, rerender } = renderHook(({ active }) => useAfterDelay(active, 1000), { initialProps: { active: false } });
    expect(result.current).toBe(false);

    rerender({ active: true });
    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  it('starts counting again for the next activity', () => {
    const { result, rerender } = renderHook(({ active }) => useAfterDelay(active, 1000), { initialProps: { active: true } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(true);
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).toBe(false);
  });
});
