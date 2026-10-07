import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedCallback } from './useDebouncedCallback';

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes only the last scheduled callback after the delay', () => {
    const { result } = renderHook(() => useDebouncedCallback());
    const first = vi.fn();
    const second = vi.fn();

    act(() => {
      result.current.schedule(first, 200);
      result.current.schedule(second, 200);
    });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents a pending callback from firing', () => {
    const { result } = renderHook(() => useDebouncedCallback());
    const callback = vi.fn();

    act(() => {
      result.current.schedule(callback, 200);
      result.current.cancel();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('cancels a pending callback on unmount', () => {
    const { result, unmount } = renderHook(() => useDebouncedCallback());
    const callback = vi.fn();

    act(() => {
      result.current.schedule(callback, 200);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(callback).not.toHaveBeenCalled();
  });
});
