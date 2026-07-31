import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const rec = vi.hoisted(() => ({
  onAutoStop: {
    current: undefined as undefined | ((r: { blob: Blob | null; hadSpeech: boolean }) => void),
  },
  isRecording: { current: false },
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  monitor: vi.fn(),
  stopMonitor: vi.fn(),
}));
const api = vi.hoisted(() => ({ transcribe: vi.fn(), synth: vi.fn() }));
const send = vi.hoisted(() => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'sent' }) }));
const store = vi.hoisted(() => ({
  messages: { current: [] as Array<{ id: string; role: string; content: string }> },
}));
const audio = vi.hoisted(() => ({
  instances: [] as Array<{ onended: (() => void) | null; pause: () => void; volume: number }>,
}));

vi.mock('../useAudioRecorder', () => ({
  useAudioRecorder: (opts: { onAutoStop?: (r: { blob: Blob | null; hadSpeech: boolean }) => void }) => {
    rec.onAutoStop.current = opts?.onAutoStop;
    return {
      isRecording: rec.isRecording.current,
      isSupported: true,
      error: null,
      level: 0,
      start: rec.start,
      stop: rec.stop,
      cancel: rec.cancel,
      monitor: rec.monitor,
      stopMonitor: rec.stopMonitor,
    };
  },
}));
vi.mock('../api', () => ({ transcribeAudio: api.transcribe, synthesizeSpeech: api.synth }));
vi.mock('../query/hooks', () => ({ useSendMessage: () => ({ mutateAsync: send.mutateAsync }) }));
vi.mock('../store', () => ({ useWorkyMessages: () => store.messages.current }));

import { useVoiceSession, splitForSpeech } from './useVoiceSession';
import { useVoiceSettings, VOICE_DEFAULTS } from './voiceSettings';

const flushReply = async (
  rerender: () => void,
  content = 'the reply',
  id = 'm1',
): Promise<void> => {
  store.messages.current = [{ id, role: 'manager', content }];
  await act(async () => {
    rerender();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  useVoiceSettings.setState({ ...VOICE_DEFAULTS });
  store.messages.current = [];
  audio.instances = [];
  rec.isRecording.current = false;
  api.transcribe.mockResolvedValue({ text: 'hello' });
  api.synth.mockResolvedValue(new Blob());
  rec.stop.mockResolvedValue({ blob: new Blob(['x']), hadSpeech: true });
  global.URL.createObjectURL = vi.fn(() => 'blob:x');
  global.URL.revokeObjectURL = vi.fn();
  class FakeAudio {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    volume = 1;
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    constructor() {
      audio.instances.push(this as unknown as (typeof audio.instances)[number]);
    }
  }
  // @ts-expect-error jsdom test doubles
  global.Audio = FakeAudio;
});

describe('splitForSpeech', () => {
  it('keeps sentences whole and merges short fragments', () => {
    const chunks = splitForSpeech('Sure. I will draft the report and send it over to the team today.');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join(' ')).toContain('Sure.');
    // No chunk is a bare two-word fragment.
    expect(chunks[0].length).toBeGreaterThan(10);
  });

  it('returns a single chunk for short replies', () => {
    expect(splitForSpeech('Done.')).toEqual(['Done.']);
  });
});

describe('useVoiceSession', () => {
  it('runs a full turn: listen → transcribe+send → speak reply → re-arm', async () => {
    const { result, rerender } = renderHook(() => useVoiceSession('s1'));

    act(() => result.current.start());
    expect(result.current.state).toBe('listening');
    expect(rec.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      await rec.onAutoStop.current?.({ blob: new Blob(['x']), hadSpeech: true });
    });
    expect(api.transcribe).toHaveBeenCalled();
    expect(send.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello' }));
    expect(result.current.transcript.you).toBe('hello');

    await flushReply(rerender);
    // Voice + speed now come from settings rather than the server default.
    expect(api.synth).toHaveBeenCalledWith('the reply', VOICE_DEFAULTS.ttsVoice, VOICE_DEFAULTS.ttsSpeed);
    expect(result.current.state).toBe('speaking');

    await act(async () => {
      audio.instances.at(-1)?.onended?.();
      await Promise.resolve();
    });
    expect(result.current.state).toBe('listening');
  });

  it('stop() ends the session and cancels the recorder', () => {
    const { result } = renderHook(() => useVoiceSession('s1'));
    act(() => result.current.start());
    act(() => result.current.stop());
    expect(result.current.state).toBe('idle');
    expect(rec.cancel).toHaveBeenCalled();
  });

  it('does not start playback when the session closed mid-synthesis', async () => {
    // The bug this guards: synthesizeSpeech resolves after stop(), and the old
    // code went straight on to construct and play an Audio.
    let release!: (b: Blob) => void;
    api.synth.mockReturnValue(new Promise<Blob>((res) => {
      release = res;
    }));

    const { result, rerender } = renderHook(() => useVoiceSession('s1'));
    act(() => result.current.start());
    await act(async () => {
      await rec.onAutoStop.current?.({ blob: new Blob(['x']), hadSpeech: true });
    });
    await flushReply(rerender);
    expect(result.current.state).toBe('speaking');

    act(() => result.current.stop());
    await act(async () => {
      release(new Blob());
      await Promise.resolve();
    });

    expect(audio.instances).toHaveLength(0);
    expect(result.current.state).toBe('idle');
  });

  it('mute releases the mic but keeps the session, and unmute re-arms', () => {
    const { result } = renderHook(() => useVoiceSession('s1'));
    act(() => result.current.start());

    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);
    expect(rec.cancel).toHaveBeenCalled();
    expect(result.current.state).toBe('idle');

    rec.start.mockClear();
    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(false);
    expect(rec.start).toHaveBeenCalled();
  });

  it('submitTurn sends the take immediately', async () => {
    rec.isRecording.current = true;
    const { result } = renderHook(() => useVoiceSession('s1'));
    act(() => result.current.start());

    await act(async () => {
      result.current.submitTurn();
      await Promise.resolve();
    });

    expect(rec.stop).toHaveBeenCalled();
    expect(api.transcribe).toHaveBeenCalled();
  });

  it('cancelTurn discards the take without transcribing', () => {
    rec.isRecording.current = true;
    const { result } = renderHook(() => useVoiceSession('s1'));
    act(() => result.current.start());

    act(() => result.current.cancelTurn());

    expect(rec.cancel).toHaveBeenCalled();
    expect(api.transcribe).not.toHaveBeenCalled();
  });

  it('manual mode waits for the user instead of opening the mic', () => {
    useVoiceSettings.setState({ turnMode: 'manual' });
    const { result } = renderHook(() => useVoiceSession('s1'));

    act(() => result.current.start());
    expect(result.current.state).toBe('idle');
    expect(rec.start).not.toHaveBeenCalled();

    act(() => result.current.beginTake());
    expect(result.current.state).toBe('listening');
    expect(rec.start).toHaveBeenCalled();
  });

  it('recovers when the manager never replies', async () => {
    vi.useFakeTimers();
    useVoiceSettings.setState({ replyTimeoutMs: 1000 });
    try {
      const { result } = renderHook(() => useVoiceSession('s1'));
      act(() => result.current.start());
      await act(async () => {
        await rec.onAutoStop.current?.({ blob: new Blob(['x']), hadSpeech: true });
      });
      expect(result.current.state).toBe('thinking');

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });

      expect(result.current.error).toBe('replyTimeout');
      expect(result.current.state).toBe('listening');
    } finally {
      vi.useRealTimers();
    }
  });

  it('monitors for barge-in while speaking when echo cancellation is on', async () => {
    const { result, rerender } = renderHook(() => useVoiceSession('s1'));
    act(() => result.current.start());
    await act(async () => {
      await rec.onAutoStop.current?.({ blob: new Blob(['x']), hadSpeech: true });
    });
    await flushReply(rerender);

    expect(rec.monitor).toHaveBeenCalled();
  });

  it('does not monitor for barge-in when echo cancellation is off', async () => {
    useVoiceSettings.setState({ echoCancellation: false });
    const { result, rerender } = renderHook(() => useVoiceSession('s1'));
    act(() => result.current.start());
    await act(async () => {
      await rec.onAutoStop.current?.({ blob: new Blob(['x']), hadSpeech: true });
    });
    await flushReply(rerender);

    expect(rec.monitor).not.toHaveBeenCalled();
  });
});
