import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from '../useAudioRecorder';
import { transcribeAudio, synthesizeSpeech } from '../api';
import { useSendMessage } from '../query/hooks';
import { useWorkyMessages } from '../store';
import type { WorkyMessage } from '../types';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface VoiceSessionApi {
  state: VoiceState;
  transcript: { you?: string; manager?: string };
  start: () => void;
  stop: () => void;
  mute: () => void;
}

const lastManager = (messages: WorkyMessage[]): WorkyMessage | undefined =>
  [...messages].reverse().find((m) => m.role === 'manager');

/**
 * Turn-based ("walkie-talkie") voice loop over the EXISTING STT + TTS APIs:
 * listen (hands-free auto-stop) → transcribe → send → await the manager's
 * reply (via the live message store) → speak it → re-arm the mic.
 *
 * FLAG: this is half-duplex and latency-bound by whole-clip STT + whole-blob
 * TTS round-trips — not the streaming duplex session in the design. `mute`
 * ends the session (no partial-mute in this MVP).
 */
export function useVoiceSession(streamId: string): VoiceSessionApi {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState<{ you?: string; manager?: string }>({});
  const send = useSendMessage(streamId);
  const messages = useWorkyMessages();

  const activeRef = useRef(false);
  const awaitingRef = useRef(false);
  const lastMgrIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const rearm = useCallback((rec: { start: () => void }) => {
    if (!activeRef.current) return;
    setState('listening');
    rec.start();
  }, []);

  const recorder = useAudioRecorder({
    onAutoStop: async ({ blob, hadSpeech }) => {
      if (!activeRef.current) return;
      if (!hadSpeech || !blob) {
        rearm(recorder);
        return;
      }
      setState('thinking');
      try {
        const { text } = await transcribeAudio(blob);
        if (!text.trim()) {
          rearm(recorder);
          return;
        }
        setTranscript((prev) => ({ ...prev, you: text }));
        awaitingRef.current = true;
        await send.mutateAsync({ content: text });
      } catch {
        rearm(recorder);
      }
    },
  });

  const start = useCallback(() => {
    activeRef.current = true;
    awaitingRef.current = false;
    lastMgrIdRef.current = lastManager(messages)?.id ?? null;
    setTranscript({});
    setState('listening');
    recorder.start();
  }, [messages, recorder]);

  const stop = useCallback(() => {
    activeRef.current = false;
    awaitingRef.current = false;
    recorder.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    setState('idle');
  }, [recorder]);

  // Speak the manager's reply when a new one arrives mid-turn.
  useEffect(() => {
    if (!activeRef.current || !awaitingRef.current) return;
    const mgr = lastManager(messages);
    if (!mgr || mgr.id === lastMgrIdRef.current) return;
    lastMgrIdRef.current = mgr.id;
    awaitingRef.current = false;
    setTranscript((prev) => ({ ...prev, manager: mgr.content }));
    setState('speaking');
    void (async () => {
      try {
        const audioBlob = await synthesizeSpeech(mgr.content);
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => rearm(recorder);
        await audio.play();
      } catch {
        rearm(recorder);
      }
    })();
  }, [messages, recorder, rearm]);

  return { state, transcript, start, stop, mute: stop };
}
