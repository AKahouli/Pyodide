import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Push-to-talk + hands-free audio recorder built on the native `MediaRecorder`
 * API. No dependencies. start() opens the mic; the clip comes back as a Blob
 * (webm/opus where supported) plus whether speech-level audio was detected.
 *
 * It taps the mic with a Web Audio `AnalyserNode` while recording, for three jobs:
 *
 *  1. `hadSpeech` gate — Whisper hallucinates filler words on silent / ambient
 *     clips (trained on subtitles where silence was captioned), so we let the
 *     caller skip transcription when nothing was actually said.
 *  2. End-of-speech auto-stop — in `auto` mode the recorder stops itself after a
 *     sustained silence *once the user has started speaking*. It never cuts off
 *     the lead-in and tolerates breaths / thinking pauses (only a continuous
 *     `silenceTimeoutMs` gap ends the take). In `manual` mode it never fires.
 *  3. A live `level` readout so the settings UI can show the real input against
 *     the configured threshold.
 *
 * The meter runs on a self-rescheduling timer, not `requestAnimationFrame`: rAF is throttled
 * or suspended in background tabs, which used to freeze silence detection
 * mid-turn and leave the take running to its hard cap.
 */
export interface RecordingResult {
  blob: Blob | null;
  hadSpeech: boolean;
}

export interface UseAudioRecorderOptions {
  /** Continuous silence (ms) after speech that ends the take. Default 2500. */
  silenceTimeoutMs?: number;
  /** Speech (ms) required before auto-stop arms — avoids early cutoff. Default 300. */
  minSpeechMs?: number;
  /** Hard cap (ms) on a single take. Default 120000 (2 min). */
  maxDurationMs?: number;
  /** Peak RMS (0–1) that counts as speech. Default 0.02. */
  speechThreshold?: number;
  /**
   * Measure the room's noise floor over the first `CALIBRATION_MS` and lift the
   * threshold above it. `speechThreshold` then acts as the lower bound.
   */
  adaptiveThreshold?: boolean;
  /** `manual` never auto-stops — the caller ends the take. Default 'auto'. */
  turnMode?: 'auto' | 'manual';
  /** Mic constraints. */
  deviceId?: string | null;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  /** Called with the finalized clip when the recorder auto-stops on silence. */
  onAutoStop?: (result: RecordingResult) => void;
}

export interface AudioRecorder {
  isRecording: boolean;
  isSupported: boolean;
  error: string | null;
  /** Live input RMS (0–1), updated while recording or monitoring. */
  level: number;
  start: () => Promise<void>;
  stop: () => Promise<RecordingResult>;
  cancel: () => void;
  /**
   * Open the mic for metering only (no MediaRecorder, nothing captured).
   * Used for threshold calibration in settings and for barge-in detection
   * while the agent is speaking. `onSpeech` fires once per monitor session.
   */
  monitor: (onSpeech?: () => void) => Promise<void>;
  stopMonitor: () => void;
}

const PREFERRED_MIME = 'audio/webm';
const METER_INTERVAL_MS = 50;
/** Window used to sample the ambient floor before arming speech detection. */
const CALIBRATION_MS = 400;
/** Speech must exceed the measured floor by this factor to count. */
const ADAPTIVE_MARGIN = 2.5;

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): AudioRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Loudness monitoring + auto-stop bookkeeping.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxRmsRef = useRef(0); // loudest frame seen (for hadSpeech)
  const speechAccumMsRef = useRef(0); // cumulative speech, to arm auto-stop
  const lastLoudMsRef = useRef(0); // elapsed ms at last above-threshold frame
  const elapsedMsRef = useRef(0); // ms since the take started
  const autoStoppingRef = useRef(false); // guard: fire auto-stop once
  const floorRef = useRef(0); // measured ambient RMS
  const floorSamplesRef = useRef<number[]>([]);
  const effectiveThresholdRef = useRef(0.02);
  const monitorSpeechRef = useRef<(() => void) | null>(null);

  // Latest option values, read inside the meter loop without re-arming it.
  const opt = useRef(options);
  opt.current = options;
  const num = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  const isSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined';

  const stopMeter = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    stopMeter();
    releaseStream();
    recorderRef.current = null;
    chunksRef.current = [];
    monitorSpeechRef.current = null;
  }, [stopMeter, releaseStream]);

  // Release the mic if the component unmounts mid-recording.
  useEffect(() => () => teardown(), [teardown]);

  const stop = useCallback((): Promise<RecordingResult> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      teardown();
      setIsRecording(false);
      return Promise.resolve({ blob: null, hadSpeech: false });
    }
    return new Promise<RecordingResult>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || PREFERRED_MIME;
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type })
          : null;
        const hadSpeech = maxRmsRef.current >= effectiveThresholdRef.current;
        teardown();
        setIsRecording(false);
        resolve({ blob, hadSpeech });
      };
      recorder.stop();
    });
  }, [teardown]);

  // Finalize from inside the meter loop and hand the clip to the consumer.
  const triggerAutoStop = useCallback(async () => {
    if (autoStoppingRef.current) return;
    autoStoppingRef.current = true;
    const result = await stop();
    opt.current.onAutoStop?.(result);
  }, [stop]);

  /**
   * Sample the stream's loudness on a fixed interval: track the peak (for
   * `hadSpeech`), publish a live level, and — when recording in `auto` mode —
   * watch for a sustained silence to auto-stop.
   */
  const startMeter = useCallback(
    (stream: MediaStream, mode: 'record' | 'monitor') => {
      const AudioCtx =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return; // No Web Audio → no meter/auto-stop; manual stop still works.
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      // The `await getUserMedia` upstream can drop the user-gesture context, so
      // the AudioContext may start suspended (analyser would read silence).
      void ctx.resume?.().catch(() => undefined);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      // Reset per-take counters.
      maxRmsRef.current = 0;
      speechAccumMsRef.current = 0;
      elapsedMsRef.current = 0;
      lastLoudMsRef.current = 0;
      floorRef.current = 0;
      floorSamplesRef.current = [];
      effectiveThresholdRef.current = num(opt.current.speechThreshold, 0.02);

      const tick = (): void => {
        const dt = METER_INTERVAL_MS;
        elapsedMsRef.current += dt;

        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setLevel(rms);

        const base = num(opt.current.speechThreshold, 0.02);
        const calibrating =
          opt.current.adaptiveThreshold !== false && elapsedMsRef.current <= CALIBRATION_MS;
        if (calibrating) {
          // Ambient only — do not let the room's own noise arm speech detection.
          floorSamplesRef.current.push(rms);
          const mean =
            floorSamplesRef.current.reduce((a, b) => a + b, 0) / floorSamplesRef.current.length;
          floorRef.current = mean;
          effectiveThresholdRef.current = Math.max(base, mean * ADAPTIVE_MARGIN);
          timerRef.current = setTimeout(tick, METER_INTERVAL_MS);
          return;
        }

        const threshold = effectiveThresholdRef.current;
        if (rms > maxRmsRef.current) maxRmsRef.current = rms;

        if (rms >= threshold) {
          speechAccumMsRef.current += dt;
          lastLoudMsRef.current = elapsedMsRef.current;
          if (mode === 'monitor' && speechAccumMsRef.current >= num(opt.current.minSpeechMs, 300)) {
            const notify = monitorSpeechRef.current;
            monitorSpeechRef.current = null; // once per monitor session
            notify?.();
            return; // caller tears the monitor down
          }
        }

        if (mode === 'record' && opt.current.turnMode !== 'manual' && opt.current.onAutoStop) {
          const started = speechAccumMsRef.current >= num(opt.current.minSpeechMs, 300);
          const silentFor = elapsedMsRef.current - lastLoudMsRef.current;
          const overCap = elapsedMsRef.current >= num(opt.current.maxDurationMs, 120000);
          if ((started && silentFor >= num(opt.current.silenceTimeoutMs, 2500)) || overCap) {
            void triggerAutoStop();
            return; // stop the loop; triggerAutoStop tears the meter down
          }
        }
        timerRef.current = setTimeout(tick, METER_INTERVAL_MS);
      };

      timerRef.current = setTimeout(tick, METER_INTERVAL_MS);
    },
    [triggerAutoStop],
  );

  /** Constraints from the caller's settings; `deviceId` only when one is chosen. */
  const audioConstraints = useCallback((): MediaTrackConstraints => {
    const o = opt.current;
    return {
      echoCancellation: o.echoCancellation ?? true,
      noiseSuppression: o.noiseSuppression ?? true,
      autoGainControl: o.autoGainControl ?? true,
      ...(o.deviceId ? { deviceId: { exact: o.deviceId } } : {}),
    };
  }, []);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError('unsupported');
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported(PREFERRED_MIME)
        ? PREFERRED_MIME
        : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      autoStoppingRef.current = false;
      // Timeslice so chunks flush periodically — long takes still produce data
      // even if the browser would otherwise buffer until stop().
      recorder.start(1000);
      startMeter(stream, 'record');
      setIsRecording(true);
    } catch {
      teardown();
      setError('permission');
    }
  }, [isSupported, startMeter, teardown, audioConstraints]);

  const monitor = useCallback(
    async (onSpeech?: () => void) => {
      if (!isSupported) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
        streamRef.current = stream;
        monitorSpeechRef.current = onSpeech ?? null;
        startMeter(stream, 'monitor');
      } catch {
        teardown();
        setError('permission');
      }
    },
    [isSupported, startMeter, teardown, audioConstraints],
  );

  const stopMonitor = useCallback(() => {
    monitorSpeechRef.current = null;
    stopMeter();
    releaseStream();
  }, [stopMeter, releaseStream]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    autoStoppingRef.current = true; // suppress any in-flight auto-stop
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    teardown();
    setIsRecording(false);
  }, [teardown]);

  return { isRecording, isSupported, error, level, start, stop, cancel, monitor, stopMonitor };
}
