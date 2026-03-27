import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTypewriter } from './useTypewriter';

describe('useTypewriter', () => {
  it('types text progressively and fires onComplete', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();

    const { result } = renderHook(() => useTypewriter('abc', 10, onComplete));

    expect(result.current).toBe('');
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(result.current).toBe('abc');
    expect(onComplete).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
