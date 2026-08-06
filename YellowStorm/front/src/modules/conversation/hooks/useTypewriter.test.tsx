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

  it('shows the completed text immediately when reduced motion is requested', () => {
    const onComplete = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useTypewriter('complete', 30, onComplete));

    expect(result.current).toBe('complete');
    expect(onComplete).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
