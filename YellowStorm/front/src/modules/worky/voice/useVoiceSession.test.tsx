import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const rec = vi.hoisted(() => ({
  onAutoStop: { current: undefined as undefined | ((r: { blob: Blob | null; hadSpeech: boolean }) => void) },
  start: vi.fn(),
  cancel: vi.fn(),
}));
const api = vi.hoisted(() => ({ transcribe: vi.fn(), synth: vi.fn() }));
const send = vi.hoisted(() => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'sent' }) }));
const store = vi.hoisted(() => ({ messages: { current: [] as Array<{ id: string; role: string; content: string }> } }));
const audio = vi.hoisted(() => ({ instances: [] as Array<{ onended: (() => void) | null }> }));

vi.mock('../useAudioRecorder', () => ({
  useAudioRecorder: (opts: { onAutoStop?: (r: { blob: Blob | null; hadSpeech: boolean }) => void }) => {
    rec.onAutoStop.current = opts?.onAutoStop;
    return { isRecording: false, isSupported: true, error: null, start: rec.start, stop: vi.fn(), cancel: rec.cancel };
  },
}));
vi.mock('../api', () => ({ transcribeAudio: api.transcribe, synthesizeSpeech: api.synth }));
vi.mock('../query/hooks', () => ({ useSendMessage: () => ({ mutateAsync: send.mutateAsync }) }));
vi.mock('../store', () => ({ useWorkyMessages: () => store.messages.current }));

import { useVoiceSession } from './useVoiceSession';

beforeEach(() => {
  vi.clearAllMocks();
  store.messages.current = [];
  audio.instances = [];
  api.transcribe.mockResolvedValue({ text: 'hello' });
  api.synth.mockResolvedValue(new Blob());
  global.URL.createObjectURL = vi.fn(() => 'blob:x');
  class FakeAudio {
    onended: (() => void) | null = null;
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    constructor() {
      audio.instances.push(this as unknown as { onended: (() => void) | null });
    }
  }
  // @ts-expect-error jsdom test doubles
  global.Audio = FakeAudio;
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

    store.messages.current = [{ id: 'm1', role: 'manager', content: 'the reply' }];
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    expect(api.synth).toHaveBeenCalledWith('the reply');
    expect(result.current.state).toBe('speaking');

    await act(async () => {
      audio.instances.at(-1)?.onended?.();
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
});
