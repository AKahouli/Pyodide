import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from '../useAudioRecorder';
import { transcribeAudio, synthesizeSpeech } from '../api';
import { useSendMessage } from '../query/hooks';
import { useWorkyMessages } from '../store';
import { useVoiceSettings } from './voiceSettings';
import type { WorkyMessage } from '../types';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface VoiceSessionApi {
  state: VoiceState;
  transcript: { you?: string; manager?: string };
  /** Live input RMS (0–1) for the meter. */
  level: number;
  /** Mic paused but the session is still open. */
  muted: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggleMute: () => void;
  /** End the current take now and send it (auto mode's "Done", manual's submit). */
  submitTurn: () => void;
  /** Throw away the current take and re-arm without sending. */
  cancelTurn: () => void;
  /** Manual mode: open the mic for a new take. */
  beginTake: () => void;
  /** Stop the agent mid-reply and start listening. */
  interrupt: () => void;
}

const lastManager = (messages: WorkyMessage[]): WorkyMessage | undefined =>
  [...messages].reverse().find((m) => m.role === 'manager');

/**
 * Split a reply into speakable chunks so the first can start playing while the
 * rest are still being synthesized. Keeps sentences whole and merges very short
 * fragments ("Sure.", "Ok.") into the next one so playback isn't choppy.
 */
export function splitForSpeech(text: string, minChars = 60): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let buffer = '';
  for (const sentence of sentences) {
    buffer += sentence;
    if (buffer.trim().length >= minChars) {
      chunks.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.filter(Boolean);
}

/**
 * Turn-based ("walkie-talkie") voice loop over the existing STT + TTS APIs:
 * listen → transcribe → send → await the manager's reply (via the live message
 * store) → speak it → re-arm the mic.
 *
 * It is half-duplex by nature — there is no realtime model behind it — but it
 * borrows what it can from one: the reply is spoken in sentence-sized chunks so
 * the first words land while the rest is still synthesizing, and (when echo
 * cancellation is on) the mic keeps monitoring during playback so speaking over
 * the agent interrupts it.
 *
 * Every async step re-checks `activeRef` after awaiting, so closing the session
 * can never let a late network result start playback or re-open the mic.
 */
export function useVoiceSession(streamId: string): VoiceSessionApi {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState<{ you?: string; manager?: string }>({});
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useSendMessage(streamId);
  const messages = useWorkyMessages();
  const settings = useVoiceSettings();

  const activeRef = useRef(false);
  const awaitingRef = useRef(false);
  const mutedRef = useRef(false);
  const lastMgrIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playTokenRef = useRef(0);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReplyTimer = useCallback(() => {
    if (replyTimerRef.current) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
  }, []);

  /** Stop any in-flight playback and invalidate late chunks from that reply. */
  const killPlayback = useCallback(() => {
    playTokenRef.current += 1;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.pause();
    }
  }, []);

  const recorder = useAudioRecorder({
    silenceTimeoutMs: settings.silenceTimeoutMs,
    minSpeechMs: settings.minSpeechMs,
    maxDurationMs: settings.maxDurationMs,
    speechThreshold: settings.speechThreshold,
    adaptiveThreshold: settings.adaptiveThreshold,
    turnMode: settings.turnMode,
    deviceId: settings.inputDeviceId,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    onAutoStop: (result) => {
      void handleTake(result.blob, result.hadSpeech);
    },
  });

  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const rearm = useCallback(() => {
    if (!activeRef.current || mutedRef.current) return;
    // Manual mode waits for the user to start the next take.
    if (useVoiceSettings.getState().turnMode === 'manual' || !useVoiceSettings.getState().autoRearm) {
      setState('idle');
      return;
    }
    setState('listening');
    void recorderRef.current.start();
  }, []);

  /** Transcribe a finished take and send it as an owner message. */
  const handleTake = useCallback(
    async (blob: Blob | null, hadSpeech: boolean) => {
      if (!activeRef.current) return;
      if (!hadSpeech || !blob) {
        rearm();
        return;
      }
      setState('thinking');
      try {
        const { text } = await transcribeAudio(blob);
        if (!activeRef.current) return; // closed while transcribing
        if (!text.trim()) {
          rearm();
          return;
        }
        setTranscript((prev) => ({ ...prev, you: text }));
        awaitingRef.current = true;
        // Don't hang in `thinking` forever if the turn errors or SSE drops.
        clearReplyTimer();
        replyTimerRef.current = setTimeout(() => {
          if (!activeRef.current || !awaitingRef.current) return;
          awaitingRef.current = false;
          setError('replyTimeout');
          rearm();
        }, useVoiceSettings.getState().replyTimeoutMs);
        await send.mutateAsync({ content: text, turnId: crypto.randomUUID() });
      } catch {
        if (!activeRef.current) return;
        awaitingRef.current = false;
        clearReplyTimer();
        setError('sendFailed');
        rearm();
      }
    },
    [rearm, send, clearReplyTimer],
  );

  const start = useCallback(() => {
    activeRef.current = true;
    awaitingRef.current = false;
    mutedRef.current = false;
    setMuted(false);
    setError(null);
    lastMgrIdRef.current = lastManager(messages)?.id ?? null;
    setTranscript({});
    if (useVoiceSettings.getState().turnMode === 'manual') {
      setState('idle'); // wait for push-to-talk
      return;
    }
    setState('listening');
    void recorderRef.current.start();
  }, [messages]);

  const stop = useCallback(() => {
    activeRef.current = false;
    awaitingRef.current = false;
    mutedRef.current = false;
    clearReplyTimer();
    killPlayback();
    recorderRef.current.cancel();
    recorderRef.current.stopMonitor();
    setMuted(false);
    setState('idle');
  }, [clearReplyTimer, killPlayback]);

  const submitTurn = useCallback(() => {
    if (!activeRef.current || !recorderRef.current.isRecording) return;
    void recorderRef.current.stop().then(({ blob, hadSpeech }) => {
      // "Done" is an explicit send: trust the user over the speech gate, since
      // a quiet take they chose to submit is still a take they meant to send.
      void handleTake(blob, hadSpeech || Boolean(blob));
    });
  }, [handleTake]);

  const cancelTurn = useCallback(() => {
    if (!activeRef.current) return;
    recorderRef.current.cancel();
    setTranscript((prev) => ({ ...prev, you: undefined }));
    rearm();
  }, [rearm]);

  const beginTake = useCallback(() => {
    if (!activeRef.current || mutedRef.current || recorderRef.current.isRecording) return;
    killPlayback();
    setError(null);
    setState('listening');
    void recorderRef.current.start();
  }, [killPlayback]);

  const interrupt = useCallback(() => {
    if (!activeRef.current) return;
    killPlayback();
    recorderRef.current.stopMonitor();
    setState('listening');
    void recorderRef.current.start();
  }, [killPlayback]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      // Release the mic but keep the session and any playback alive.
      recorderRef.current.cancel();
      recorderRef.current.stopMonitor();
      setState('idle');
    } else {
      rearm();
    }
  }, [rearm]);

  /** Speak one reply, chunk by chunk, aborting if the session moves on. */
  const speak = useCallback(
    async (text: string) => {
      const token = ++playTokenRef.current;
      const { ttsVoice, ttsSpeed, volume, bargeIn, echoCancellation } =
        useVoiceSettings.getState();
      const chunks = splitForSpeech(text);
      setState('speaking');

      // Barge-in needs echo cancellation, otherwise the agent's own voice comes
      // back through the mic and interrupts itself.
      const canBargeIn = bargeIn && echoCancellation;
      if (canBargeIn) {
        void recorderRef.current.monitor(() => {
          if (playTokenRef.current !== token || !activeRef.current) return;
          interrupt();
        });
      }

      try {
        for (const chunk of chunks) {
          const blob = await synthesizeSpeech(chunk, ttsVoice, ttsSpeed);
          // Re-check after every await: the session may have been closed,
          // muted, or interrupted while this chunk was synthesizing.
          if (playTokenRef.current !== token || !activeRef.current) return;
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.volume = volume;
          audioRef.current = audio;
          await new Promise<void>((resolve) => {
            audio.onended = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            void audio.play().catch(() => resolve()); // autoplay may need a gesture
          });
          if (playTokenRef.current !== token || !activeRef.current) return;
        }
      } catch {
        /* TTS failure is non-fatal — the text answer is already in the thread. */
      } finally {
        if (canBargeIn) recorderRef.current.stopMonitor();
      }
      if (playTokenRef.current === token && activeRef.current) rearm();
    },
    [interrupt, rearm],
  );

  // Speak the manager's reply when a new one arrives mid-turn.
  useEffect(() => {
    if (!activeRef.current || !awaitingRef.current) return;
    const mgr = lastManager(messages);
    if (!mgr || mgr.id === lastMgrIdRef.current) return;
    lastMgrIdRef.current = mgr.id;
    awaitingRef.current = false;
    clearReplyTimer();
    setTranscript((prev) => ({ ...prev, manager: mgr.content }));
    void speak(mgr.content);
  }, [messages, speak, clearReplyTimer]);

  // Never leave the mic open or audio playing behind a closed session.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearReplyTimer();
      killPlayback();
    };
  }, [clearReplyTimer, killPlayback]);

  return {
    state,
    transcript,
    level: recorder.level,
    muted,
    error,
    start,
    stop,
    toggleMute,
    submitTurn,
    cancelTurn,
    beginTake,
    interrupt,
  };
}
