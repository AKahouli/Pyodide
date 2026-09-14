import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSessionApi, VoiceState } from './useVoiceSession';
import { useVoiceSettings } from './voiceSettings';
import { createVoiceSession, voiceTranscript, voiceThematicMemory, voiceThematicRetrieve } from '../api';
import { openGeminiLive, type GeminiLiveConnection } from './geminiLiveClient';
import { handleToolCall } from './toolCallRelay';
import { attachMilestoneInjector } from './milestoneInjector';
import { PCM_CAPTURE_WORKLET } from './pcm-capture-worklet';
import { openVoiceMemoryIngest, type VoiceMemoryIngest } from './voiceMemoryIngest';
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
  // Set when we intentionally tear the session down (hang-up / unmount) so the
  // WS close it triggers is not mistaken for a dropped connection and reconnected.
  const closingRef = useRef(false);
  // So a spoken request isn't lost when the user hangs up before the concierge
  // calls dispatch_task: accumulate the user's transcribed speech, and on hang-up
  // auto-dispatch it — but ONLY if dispatch never fired (when it did, the request
  // was already sent). Falls back to just saving the transcript if dispatch fails.
  const dispatchedRef = useRef(false);
  const userSpeechRef = useRef<string[]>([]);
  // MCP tool routing from the session envelope, captured so hang-up can dispatch.
  const toolRoutingRef = useRef<{ endpoints?: Record<string, string>; streamIdTools?: string[] }>({});
  // Voice-memory sidecar: mirrors mic PCM + per-turn transcript for long-term
  // memory. Best-effort and fully independent of the Gemini path; a no-op unless
  // the session envelope carries a memoryWsUrl. `memTurnRef` accumulates the current
  // user turn's transcript, flushed on turnComplete.
  const memRef = useRef<VoiceMemoryIngest | null>(null);
  const memTurnRef = useRef<string[]>([]);

  const teardown = useCallback(() => {
    closingRef.current = true;
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
    memRef.current?.close();
    memRef.current = null;
    memTurnRef.current = [];
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
    closingRef.current = false;
    const envelope = await createVoiceSession(streamId, handleRef.current);
    toolRoutingRef.current = { endpoints: envelope.toolEndpoints, streamIdTools: envelope.streamIdTools };
    // Best-effort long-term memory: a no-op unless the backend put a memoryWsUrl in
    // the session envelope (runtime-configured server-side, not a front build var).
    memRef.current = openVoiceMemoryIngest(envelope.memoryWsUrl);
    memTurnRef.current = [];

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
          // Once the request is dispatched it's persisted by the dispatch flow,
          // so the hang-up transcript fallback must not also save it.
          if (call.name === 'dispatch_task') dispatchedRef.current = true;
          // Thematic memory retrieval is backend-proxied (smart-memory needs a
          // secret key the browser can't hold), so it does NOT go through the MCP
          // relay — call our own endpoint and return the result to the model.
          if (call.name === 'retrieve_thematic_memory') {
            const query = String((call.args as { query?: unknown })?.query ?? '');
            const response = await voiceThematicRetrieve(query, streamId)
              .then((data) => ({ data }))
              .catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
            const res = { id: call.id, name: call.name, response };
            if (import.meta.env?.DEV) console.log('[voice] toolResponse (thematic)', res);
            connRef.current?.sendToolResponse([res]);
            continue;
          }
          const res = await handleToolCall(streamId, call, envelope.toolEndpoints, envelope.streamIdTools);
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
        if (import.meta.env?.DEV) console.log('[voice] you:', t);
        setTranscript((p) => ({ ...p, you: t }));
        // ponytail: assumes fragments are deltas (join → full text). If Gemini
        // ever sends cumulative snapshots, de-dup here or split on turnComplete.
        userSpeechRef.current.push(t);
        memTurnRef.current.push(t); // this turn's transcript, for memory ingest
      },
      onOutputTranscript: (t) => {
        if (import.meta.env?.DEV) console.log('[voice] concierge:', t);
        setTranscript((p) => ({ ...p, manager: t }));
      },
      // End of a turn: hand this turn's transcript to memory (the sidecar pairs it
      // with the audio it has been buffering), then start a fresh turn.
      onTurnComplete: () => {
        const said = memTurnRef.current.join('').trim();
        memTurnRef.current = [];
        if (said) {
          memRef.current?.endTurn(said);
          // Thematic (smart-memory) ingestion — same per-turn cadence; backend does
          // the memory.write (the MCP key can't reach the browser). Best-effort.
          if (envelope.thematicMemory) void voiceThematicMemory(said, streamId).catch(() => undefined);
        }
      },
      onResumptionHandle: (h) => {
        handleRef.current = h;
      },
      onGoAway: () => {
        /* server will close; onClose handles reconnect via the resumption handle */
      },
      onClose: (ev) => {
        if (import.meta.env?.DEV) console.warn('[voice] ws closed', ev.code, ev.reason);
        // Ignore closes from a connection that is no longer the active one:
        // a stream switch (or hang-up) tears this socket down and opens a fresh
        // session, so `connRef` already points elsewhere (or is null). The
        // shared `closingRef` flag alone is unsafe here — the new session's
        // connect() resets it to false before this old socket's async close
        // fires, which would otherwise reconnect and resurrect the previous
        // stream's conversation context.
        if (connRef.current !== conn) return;
        // Intentional teardown (hang-up / unmount) — do not reconnect.
        if (closingRef.current) {
          setState('idle');
          return;
        }
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
    // Fresh context clock starts near 0; a stale play head from a prior call
    // (hang-up/restart or reconnect) would schedule all output far in the
    // future, so the concierge is inaudible on the second call.
    playHeadRef.current = 0;
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
      const pcm16 = floatTo16BitPCM(downsampleFloat(f, ctx.sampleRate, 16000));
      conn.sendAudioChunk(pcm16); // Gemini path — unchanged, always first
      memRef.current?.sendAudio(pcm16); // fork a copy to long-term memory (best-effort)
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
    dispatchedRef.current = false;
    userSpeechRef.current = [];
    connect().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    });
  }, [connect, streamId]);

  const stop = useCallback(() => {
    // Hang-up: if the user voiced a request but the concierge never dispatched it,
    // dispatch it now through the same MCP path the concierge would use (persists
    // + runs it in the orchestrator). The dispatch fetch is independent of the WS
    // we tear down below, so it completes after teardown.
    const spoken = userSpeechRef.current.join('').trim();
    userSpeechRef.current = [];
    // ponytail: 2-word floor skips acks/farewells ("ok", "merci"); swap for an
    // intent check if chit-chat starts leaking through.
    if (!dispatchedRef.current && spoken.split(/\s+/).length >= 2) {
      const { endpoints, streamIdTools } = toolRoutingRef.current;
      void (async () => {
        const res = await handleToolCall(
          streamId,
          { id: `hangup-${Date.now()}`, name: 'dispatch_task', args: { message: spoken } },
          endpoints,
          streamIdTools,
        );
        // Dispatch failed — save the transcript so the words aren't lost.
        if ((res.response as { error?: unknown })?.error) {
          await voiceTranscript(streamId, 'owner', spoken).catch(() => undefined);
        }
      })();
    }
    teardown();
    setState('idle');
    setLevel(0);
  }, [teardown, streamId]);

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
