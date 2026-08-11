/**
 * Per-device voice tuning. Persisted to localStorage rather than the server:
 * every knob here describes *this* machine's mic, room and speakers, so it
 * should not follow the user to another device.
 *
 * Model / provider / API keys stay server-side env config — those are admin
 * concerns, not per-user knobs.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** How a take ends. */
export type WorkyTurnMode =
  /** Silence auto-ends the take; "Done" can cut it short. */
  | 'auto'
  /** Nothing auto-ends the take; the user holds/taps to talk and presses Done. */
  | 'manual';

export interface WorkyVoiceSettings {
  // --- Capture ---
  /** `null` = the browser default input. */
  inputDeviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /**
   * Peak RMS (0–1) that counts as speech. Only used when `adaptiveThreshold`
   * is off; otherwise it is the floor the calibrated value cannot go below.
   */
  speechThreshold: number;
  /** Measure the room's noise floor at take start and set the threshold above it. */
  adaptiveThreshold: boolean;

  // --- Turn timing ---
  /** Continuous silence (ms) after speech that ends a take, in `auto` mode. */
  silenceTimeoutMs: number;
  /** Speech (ms) required before auto-stop arms, so lead-in is never cut. */
  minSpeechMs: number;
  /** Hard cap (ms) on a single take. */
  maxDurationMs: number;

  // --- Behaviour ---
  turnMode: WorkyTurnMode;
  /** Let speech interrupt the agent mid-reply. Requires echo cancellation. */
  bargeIn: boolean;
  /** Re-open the mic automatically once the agent finishes speaking. */
  autoRearm: boolean;
  /** How long (ms) to wait for the manager's reply before recovering. */
  replyTimeoutMs: number;

  // --- Playback ---
  ttsVoice: string;
  ttsSpeed: number;
  volume: number;
}

/** Gemini TTS voice names; update if WORKY_TTS_MODEL changes provider. */
export const TTS_VOICES = [
  'Kore',
  'Puck',
  'Zephyr',
  'Charon',
  'Fenrir',
  'Aoede',
  'Leda',
  'Orus',
] as const;

/** Defaults reproduce the behaviour the recorder had before it was tunable. */
export const VOICE_DEFAULTS: WorkyVoiceSettings = {
  inputDeviceId: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  speechThreshold: 0.02,
  adaptiveThreshold: true,
  silenceTimeoutMs: 2500,
  minSpeechMs: 300,
  maxDurationMs: 120000,
  turnMode: 'auto',
  bargeIn: true,
  autoRearm: true,
  replyTimeoutMs: 60000,
  ttsVoice: TTS_VOICES[0],
  ttsSpeed: 1,
  volume: 1,
};

/** Bounds used by the settings UI and to clamp restored values. */
export const VOICE_LIMITS = {
  speechThreshold: { min: 0.002, max: 0.15, step: 0.002 },
  silenceTimeoutMs: { min: 500, max: 8000, step: 100 },
  minSpeechMs: { min: 0, max: 2000, step: 50 },
  maxDurationMs: { min: 10000, max: 300000, step: 5000 },
  replyTimeoutMs: { min: 10000, max: 180000, step: 5000 },
  ttsSpeed: { min: 0.5, max: 2, step: 0.05 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

interface WorkyVoiceSettingsState extends WorkyVoiceSettings {
  set: <K extends keyof WorkyVoiceSettings>(key: K, value: WorkyVoiceSettings[K]) => void;
  reset: () => void;
}

export const useVoiceSettings = create<WorkyVoiceSettingsState>()(
  persist(
    (setState) => ({
      ...VOICE_DEFAULTS,
      set: (key, value) => setState({ [key]: value } as Partial<WorkyVoiceSettings>),
      reset: () => setState({ ...VOICE_DEFAULTS }),
    }),
    {
      name: 'worky-voice-settings',
      version: 1,
      // A persisted value from an older build (or hand-edited storage) must not
      // be able to push the recorder into a nonsensical state.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkyVoiceSettings>;
        const numeric = (
          key: keyof typeof VOICE_LIMITS,
          value: unknown,
        ): number => {
          const limit = VOICE_LIMITS[key];
          return typeof value === 'number' && Number.isFinite(value)
            ? clamp(value, limit.min, limit.max)
            : (VOICE_DEFAULTS[key] as number);
        };
        return {
          ...current,
          ...p,
          speechThreshold: numeric('speechThreshold', p.speechThreshold),
          silenceTimeoutMs: numeric('silenceTimeoutMs', p.silenceTimeoutMs),
          minSpeechMs: numeric('minSpeechMs', p.minSpeechMs),
          maxDurationMs: numeric('maxDurationMs', p.maxDurationMs),
          replyTimeoutMs: numeric('replyTimeoutMs', p.replyTimeoutMs),
          ttsSpeed: numeric('ttsSpeed', p.ttsSpeed),
          volume: numeric('volume', p.volume),
          turnMode: p.turnMode === 'manual' ? 'manual' : 'auto',
        };
      },
    },
  ),
);

/** Read the current settings outside React (rAF/interval callbacks, handlers). */
export const readVoiceSettings = (): WorkyVoiceSettings => useVoiceSettings.getState();
