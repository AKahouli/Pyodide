import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedSearch } from './useDebouncedSearch';

describe('useDebouncedSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('debounces callback and keeps latest value', () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    const { result } = renderHook(() => useDebouncedSearch(onSearch, 300));

    act(() => {
      result.current.onChange('alpha');
      result.current.onChange('alphabet');
    });

    expect(result.current.value).toBe('alphabet');
    expect(onSearch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('alphabet');
  });

  it('reset clears pending callback', () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    const { result } = renderHook(() => useDebouncedSearch(onSearch, 200));

    act(() => {
      result.current.onChange('query');
      result.current.reset();
      vi.runAllTimers();
    });

    expect(result.current.value).toBe('');
    expect(onSearch).not.toHaveBeenCalled();
  });
});
