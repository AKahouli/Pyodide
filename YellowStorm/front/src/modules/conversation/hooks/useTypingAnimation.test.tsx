import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTypingAnimation } from './useTypingAnimation';

describe('useTypingAnimation', () => {
  it('reveals text over time when enabled', () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useTypingAnimation('hello', 10, true));
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('hello');

    vi.useRealTimers();
  });

  it('returns full text immediately when disabled', () => {
    const { result } = renderHook(() => useTypingAnimation('hello', 10, false));
    expect(result.current).toBe('hello');
  });
});
