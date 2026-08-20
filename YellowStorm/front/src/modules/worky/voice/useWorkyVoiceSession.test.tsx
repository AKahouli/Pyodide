import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const realtimeApi = {
  state: 'idle',
  transcript: {},
  level: 0,
  muted: false,
  error: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
  toggleMute: vi.fn(),
  submitTurn: vi.fn(),
  cancelTurn: vi.fn(),
  beginTake: vi.fn(),
  interrupt: vi.fn(),
};
const legacyApi = { ...realtimeApi, start: vi.fn(), stop: vi.fn() };

vi.mock('./useRealtimeVoiceSession', () => ({ useRealtimeVoiceSession: () => realtimeApi }));
vi.mock('./useVoiceSession', () => ({ useVoiceSession: () => legacyApi }));
vi.mock('./voiceSettings', () => ({ useVoiceSettings: (sel: any) => sel({ realtimeVoice: true }) }));

import { useWorkyVoiceSession } from './useWorkyVoiceSession';

describe('useWorkyVoiceSession', () => {
  it('starts the realtime engine when active and reports usingRealtime', () => {
    const { result } = renderHook(() => useWorkyVoiceSession('s1', true));
    expect(result.current.usingRealtime).toBe(true);
    expect(realtimeApi.start).toHaveBeenCalled();
  });

  it('does not start when inactive', () => {
    legacyApi.start.mockClear();
    realtimeApi.start.mockClear();
    renderHook(() => useWorkyVoiceSession('s1', false));
    expect(realtimeApi.start).not.toHaveBeenCalled();
    expect(legacyApi.start).not.toHaveBeenCalled();
  });

  it('restarts the session when the stream changes while active', () => {
    realtimeApi.start.mockClear();
    realtimeApi.stop.mockClear();
    const { rerender } = renderHook(({ id }) => useWorkyVoiceSession(id, true), {
      initialProps: { id: 's1' },
    });
    expect(realtimeApi.start).toHaveBeenCalledTimes(1);

    rerender({ id: 's2' });

    // Switching streams must tear down the old Gemini session and start a fresh
    // one, otherwise the previous stream's conversation context leaks over.
    expect(realtimeApi.stop).toHaveBeenCalledTimes(1);
    expect(realtimeApi.start).toHaveBeenCalledTimes(2);
  });
});
