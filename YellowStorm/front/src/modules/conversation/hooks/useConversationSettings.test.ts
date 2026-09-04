import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCachedConversationSettings, useConversationSettings } from './useConversationSettings';

const fetchSettings = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({ fetchConversationSettings: fetchSettings }));

const composerSuggestions = {
  enabled: true,
  agentId: null,
  debounceMs: 400,
  minimumDraftLength: 3,
  requestsPerMinute: 60,
  maxOutputTokens: 256,
};

describe('useConversationSettings', () => {
  beforeEach(() => {
    fetchSettings.mockReset();
    fetchSettings.mockResolvedValue({ composerSuggestions, redactSensitiveText: true });
  });

  afterEach(() => vi.useRealTimers());

  it('updates mounted consumers when redaction is re-enabled', () => {
    setCachedConversationSettings({ composerSuggestions, redactSensitiveText: false });
    const { result } = renderHook(() => useConversationSettings());
    expect(result.current?.redactSensitiveText).toBe(false);

    act(() => setCachedConversationSettings({ composerSuggestions, redactSensitiveText: true }));

    expect(result.current?.redactSensitiveText).toBe(true);
  });

  it('keeps the same settings reference when a refresh is unchanged', () => {
    const value = { composerSuggestions, redactSensitiveText: true };
    setCachedConversationSettings(value);
    const { result } = renderHook(() => useConversationSettings());
    const initial = result.current;

    act(() => setCachedConversationSettings({ composerSuggestions: { ...composerSuggestions }, redactSensitiveText: true }));

    expect(result.current).toBe(initial);
  });

  it('keeps the last confirmed setting while refreshing an expired cache', async () => {
    vi.useFakeTimers();
    let resolveRefresh: (value: { composerSuggestions: typeof composerSuggestions; redactSensitiveText: boolean }) => void = () => undefined;
    fetchSettings.mockReturnValue(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    setCachedConversationSettings({ composerSuggestions, redactSensitiveText: false });
    const { result } = renderHook(() => useConversationSettings());

    await act(async () => vi.advanceTimersByTimeAsync(5_001));

    expect(result.current?.redactSensitiveText).toBe(false);
    await act(async () => resolveRefresh({ composerSuggestions, redactSensitiveText: true }));
    expect(result.current?.redactSensitiveText).toBe(true);
  });

  it('fails closed when an expired cached setting cannot be refreshed', async () => {
    vi.useFakeTimers();
    fetchSettings.mockRejectedValue(new Error('settings unavailable'));
    setCachedConversationSettings({ composerSuggestions, redactSensitiveText: false });
    const { result } = renderHook(() => useConversationSettings());

    await act(async () => vi.advanceTimersByTimeAsync(5_001));

    expect(result.current).toBeNull();
  });
});
