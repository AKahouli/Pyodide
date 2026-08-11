import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSessionApi, VoiceState } from './useVoiceSession';
import { useVoiceSettings } from './voiceSettings';
import { createVoiceSession } from '../api';
import { openGeminiLive, type GeminiLiveConnection } from './geminiLiveClient';
import { handleToolCall } from './toolCallRelay';
import { attachMilestoneInjector } from './milestoneInjector';
import { PCM_CAPTURE_WORKLET } from './pcm-capture-worklet';
import { downsampleFloat, floatTo16BitPCM } from './pcmAudio';
import { shouldReconnect } from './reconnectPolicy';

const MAX_RECONNECTS = 5;
const GEMINI_OUTPUT_RATE = 24000;

/**
 * Realtime voice session backed by Gemini Live. Returns the exact
 * `VoiceSessionApi` shape so it is a drop-in for the shared voice UI. Turn-mode
 * methods are no-ops here — Gemini's native VAD drives turn-taking. Passing an
 * empty `streamId` keeps the hook fully idle (used when the feature is off).
 */
export function useRealtimeVoiceSession(streamId: string): VoiceSessionApi {
  const settings = useVoiceSettings();
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ you?: string; manager?: string }>({});

  const connRef = useRef<GeminiLiveConnection | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handleRef = useRef<string | undefined>(undefined);
  const attemptRef = useRef(0);
  const mutedRef = useRef(false);
  const detachMilestonesRef = useRef<null | (() => void)>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playHeadRef = useRef(0);

  const teardown = useCallback(() => {
    connRef.current?.close();
    connRef.current = null;
    detachMilestonesRef.current?.();
    detachMilestonesRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
  }, []);

  const playPcm = useCallback((pcm: Int16Array) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (import.meta.env?.DEV && playHeadRef.current === 0) {
      console.log('[voice] first audio chunk received from Gemini');
    }
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
    const buffer = ctx.createBuffer(1, f32.length, GEMINI_OUTPUT_RATE);
    buffer.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const at = Math.max(now, playHeadRef.current);
    src.start(at);
    playHeadRef.current = at + buffer.duration;
    setState('speaking');
    src.onended = () => {
      if (playHeadRef.current <= ctx.currentTime + 0.02) setState('listening');
    };
  }, []);

  const connect = useCallback(async () => {
    if (!streamId) return;
    const envelope = await createVoiceSession(streamId, handleRef.current);

    // Only stream mic audio after the server acknowledges setup, so we never
    // push audio into a session Gemini hasn't configured yet. A short fallback
    // flips it on anyway in case a setupComplete frame is missed.
    let ready = false;
    const markReady = (reason: string) => {
      if (ready) return;
      ready = true;
      if (import.meta.env?.DEV) console.log(`[voice] streaming audio (${reason})`);
      setState('listening');
    };

    // Open the WebSocket first so the short-lived token is used promptly,
    // regardless of how long the mic-permission prompt takes.
    const conn = openGeminiLive(envelope, {
      onSetupComplete: () => markReady('setupComplete'),
      onAudio: playPcm,
      onToolCall: async (calls) => {
        if (import.meta.env?.DEV) console.log('[voice] toolCall', calls.map((c) => c.name), calls);
        for (const call of calls) {
          const res = await handleToolCall(streamId, call);
          if (import.meta.env?.DEV) console.log('[voice] toolResponse', res);
          connRef.current?.sendToolResponse([res]);
        }
      },
      // Transcripts drive only the ephemeral on-screen overlay. The concierge is
      // a relay/narration voice and must NOT write to chat history — the task
      // request is persisted by the dispatch_task flow (owner) and the real
      // answers by the worky manager (via the orchestrator). Persisting the
      // concierge's speech here would impersonate the manager in the transcript.
      onInputTranscript: (t) => {
        setTranscript((p) => ({ ...p, you: t }));
      },
      onOutputTranscript: (t) => {
        setTranscript((p) => ({ ...p, manager: t }));
      },
      onResumptionHandle: (h) => {
        handleRef.current = h;
      },
      onGoAway: () => {
        /* server will close; onClose handles reconnect via the resumption handle */
      },
      onClose: (ev) => {
        if (import.meta.env?.DEV) console.warn('[voice] ws closed', ev.code, ev.reason);
        if (shouldReconnect(ev.code, attemptRef.current, MAX_RECONNECTS)) {
          attemptRef.current += 1;
          void connect().catch((e) => setError(e instanceof Error ? e.message : String(e)));
        } else if (ev.code === 1008) {
          setError('Voice session rejected. Please retry.');
          setState('idle');
        }
      },
      onError: (e) => {
        if (import.meta.env?.DEV) console.error('[voice] ws error', e);
        setError(e instanceof Error ? e.message : String(e));
      },
    });
    connRef.current = conn;
    setTimeout(() => markReady('timeout fallback'), 3000);

    // Audio pipeline.
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    // The awaits drop the user-gesture context, so the AudioContext can start
    // suspended — resume it or the capture worklet never runs and no audio
    // plays back (mirrors useAudioRecorder's resume).
    await ctx.resume().catch(() => undefined);
    if (import.meta.env?.DEV) console.log('[voice] AudioContext state:', ctx.state);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: settings.echoCancellation ?? true,
        noiseSuppression: settings.noiseSuppression ?? true,
        autoGainControl: settings.autoGainControl ?? true,
        ...(settings.inputDeviceId ? { deviceId: { exact: settings.inputDeviceId } } : {}),
      },
    });
    streamRef.current = stream;

    const blobUrl = URL.createObjectURL(new Blob([PCM_CAPTURE_WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    workletRef.current = node;
    source.connect(node);
    // A worklet with no output path is not pulled by the render graph, so route
    // it to the destination through a muted gain to keep process() running
    // without echoing the mic to the speaker.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(ctx.destination);

    let loggedFirstChunk = false;
    node.port.onmessage = (e: MessageEvent) => {
      if (mutedRef.current || !ready) return;
      const f = e.data as Float32Array;
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
      setLevel(Math.min(1, Math.sqrt(sum / f.length) * 4));
      conn.sendAudioChunk(floatTo16BitPCM(downsampleFloat(f, ctx.sampleRate, 16000)));
      if (import.meta.env?.DEV && !loggedFirstChunk) {
        loggedFirstChunk = true;
        console.log('[voice] first mic chunk sent to Gemini (', f.length, 'samples )');
      }
    };

    detachMilestonesRef.current = attachMilestoneInjector(streamId, (text) => conn.sendText(text));
    attemptRef.current = 0;
    setState('listening');
  }, [playPcm, settings, streamId]);

  const start = useCallback(() => {
    if (!streamId) return;
    setError(null);
    handleRef.current = undefined;
    attemptRef.current = 0;
    connect().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    });
  }, [connect, streamId]);

  const stop = useCallback(() => {
    teardown();
    setState('idle');
    setLevel(0);
  }, [teardown]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  }, []);

  useEffect(() => teardown, [teardown]);

  // Turn-mode methods are no-ops in realtime mode (Gemini VAD drives turns);
  // kept to satisfy the VoiceSessionApi contract used by the shared UI.
  const noop = useCallback(() => undefined, []);
  return {
    state,
    transcript,
    level,
    muted,
    error,
    start,
    stop,
    toggleMute,
    submitTurn: noop,
    cancelTurn: noop,
    beginTake: noop,
    interrupt: noop,
  };
}
