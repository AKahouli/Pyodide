import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchComposerSuggestions } from '../api';
import { useComposerSuggestions } from './useComposerSuggestions';

vi.mock('../api', () => ({ fetchComposerSuggestions: vi.fn() }));

describe('useComposerSuggestions', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not request suggestions when globally disabled', async () => {
    vi.useFakeTimers();
    renderHook(() => useComposerSuggestions({ draftText: 'Draft text', enabled: false, debounceMs: 250, minLength: 3 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(fetchComposerSuggestions).not.toHaveBeenCalled();
  });

  it('uses the configured minimum length and debounce', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchComposerSuggestions).mockResolvedValue({ content: 'A useful continuation' });
    const { rerender } = renderHook(
      ({ draftText }) => useComposerSuggestions({ draftText, enabled: true, debounceMs: 500, minLength: 10 }),
      { initialProps: { draftText: 'short' } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(fetchComposerSuggestions).not.toHaveBeenCalled();

    rerender({ draftText: 'long enough draft' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(fetchComposerSuggestions).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchComposerSuggestions).toHaveBeenCalledWith('long enough draft', expect.any(AbortSignal));
  });
});
