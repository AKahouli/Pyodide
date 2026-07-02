import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Push-to-talk + hands-free audio recorder built on the native `MediaRecorder`
 * API. No dependencies. start() opens the mic; the clip comes back as a Blob
 * (webm/opus where supported) plus whether speech-level audio was detected.
 *
 * It taps the mic with a Web Audio `AnalyserNode` while recording, for two jobs:
 *
 *  1. `hadSpeech` gate — Whisper hallucinates filler words on silent / ambient
 *     clips (trained on subtitles where silence was captioned), so we let the
 *     caller skip transcription when nothing was actually said.
 *  2. End-of-speech auto-stop — when `onAutoStop` is provided, the recorder
 *     stops itself after a sustained silence *once the user has started
 *     speaking*. It never cuts off the lead-in (they can take their time to
 *     begin) and tolerates breaths / thinking pauses (only a continuous
 *     `silenceTimeoutMs` gap ends the take).
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
  /** Called with the finalized clip when the recorder auto-stops on silence. */
  onAutoStop?: (result: RecordingResult) => void;
}

export interface AudioRecorder {
  isRecording: boolean;
  isSupported: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<RecordingResult>;
  cancel: () => void;
}

const PREFERRED_MIME = 'audio/webm';
// Peak RMS (0–1) the clip must cross to count as speech. Ambient room noise
// sits well below this; normal speaking voice peaks comfortably above it.
const SPEECH_RMS_THRESHOLD = 0.02;

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): AudioRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Loudness monitoring + auto-stop bookkeeping.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const maxRmsRef = useRef(0); // loudest frame seen (for hadSpeech)
  const speechAccumMsRef = useRef(0); // cumulative speech, to arm auto-stop
  const lastLoudTsRef = useRef(0); // ts of last above-threshold frame
  const prevTsRef = useRef(0); // previous tick ts, for dt
  const autoStoppingRef = useRef(false); // guard: fire auto-stop once

  // Latest option values, read inside the rAF loop without re-arming it.
  const onAutoStopRef = useRef(options.onAutoStop);
  onAutoStopRef.current = options.onAutoStop;
  const silenceMsRef = useRef(options.silenceTimeoutMs ?? 2500);
  silenceMsRef.current = options.silenceTimeoutMs ?? 2500;
  const minSpeechMsRef = useRef(options.minSpeechMs ?? 300);
  minSpeechMsRef.current = options.minSpeechMs ?? 300;
  const maxDurationMsRef = useRef(options.maxDurationMs ?? 120000);
  maxDurationMsRef.current = options.maxDurationMs ?? 120000;

  const isSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined';

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    stopMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, [stopMeter]);

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
        const hadSpeech = maxRmsRef.current >= SPEECH_RMS_THRESHOLD;
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
    onAutoStopRef.current?.(result);
  }, [stop]);

  // Sample the stream's loudness each frame: track peak (for hadSpeech) and,
  // once enough speech has accrued, watch for a sustained silence to auto-stop.
  const startMeter = useCallback(
    (stream: MediaStream) => {
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

      const tick = (ts: number) => {
        const dt = prevTsRef.current ? ts - prevTsRef.current : 0;
        prevTsRef.current = ts;

        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (rms > maxRmsRef.current) maxRmsRef.current = rms;

        if (rms >= SPEECH_RMS_THRESHOLD) {
          speechAccumMsRef.current += dt;
          lastLoudTsRef.current = ts;
        }

        // Auto-stop only when a consumer wants it.
        if (onAutoStopRef.current) {
          const started = speechAccumMsRef.current >= minSpeechMsRef.current;
          const silentFor = ts - lastLoudTsRef.current;
          const overCap = ts - startTs >= maxDurationMsRef.current;
          if ((started && silentFor >= silenceMsRef.current) || overCap) {
            void triggerAutoStop();
            return; // stop the loop; triggerAutoStop tears the meter down
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      const startTs = (typeof performance !== 'undefined' ? performance.now() : 0);
      // Reset per-take counters.
      maxRmsRef.current = 0;
      speechAccumMsRef.current = 0;
      prevTsRef.current = 0;
      lastLoudTsRef.current = startTs;
      rafRef.current = requestAnimationFrame(tick);
    },
    [triggerAutoStop],
  );

  const start = useCallback(async () => {
    if (!isSupported) {
      setError('unsupported');
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      startMeter(stream);
      setIsRecording(true);
    } catch {
      teardown();
      setError('permission');
    }
  }, [isSupported, startMeter, teardown]);

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

  return { isRecording, isSupported, error, start, stop, cancel };
}
