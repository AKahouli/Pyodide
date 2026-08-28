import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('updates mounted consumers when redaction is re-enabled', () => {
    setCachedConversationSettings({ composerSuggestions, redactSensitiveText: false });
    const { result } = renderHook(() => useConversationSettings());
    expect(result.current?.redactSensitiveText).toBe(false);

    act(() => setCachedConversationSettings({ composerSuggestions, redactSensitiveText: true }));

    expect(result.current?.redactSensitiveText).toBe(true);
  });
});
