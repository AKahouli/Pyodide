import { AUTH_STORAGE_KEYS } from '../../../lib/api/config';

/**
 * Mirrors the realtime mic PCM to the voice-memory sidecar so it can build
 * long-term memory (facts + acoustic affect) from the user's speech — a SECOND
 * consumer of the same audio Gemini Live already gets. It never touches the
 * Gemini path and every operation is best-effort: if the sidecar is unreachable
 * or misbehaves, memory is silently skipped and the voice loop is unaffected.
 *
 * Enabled only when VITE_VOICE_MEMORY_WS_URL is set; otherwise a no-op handle.
 *
 * Protocol (to the sidecar): binary frames = 16 kHz mono PCM16 (the same buffer
 * sent to Gemini); {"type":"turn_end","transcript":...} on each finished user
 * turn; {"type":"reset"} to drop a partial turn (barge-in).
 */
export interface VoiceMemoryIngest {
  sendAudio: (pcm: Int16Array) => void;
  endTurn: (transcript: string) => void;
  reset: () => void;
  close: () => void;
}

const NOOP: VoiceMemoryIngest = {
  sendAudio: () => undefined,
  endTurn: () => undefined,
  reset: () => undefined,
  close: () => undefined,
};

function accessToken(): string | null {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  } catch {
    return null;
  }
}

export function openVoiceMemoryIngest(): VoiceMemoryIngest {
  const base = import.meta.env.VITE_VOICE_MEMORY_WS_URL as string | undefined;
  const token = accessToken();
  if (!base || !token) return NOOP; // feature off, or not authenticated

  let ws: WebSocket | null = null;
  let open = false;
  try {
    ws = new WebSocket(`${base}?token=${encodeURIComponent(token)}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      open = true;
    };
    ws.onclose = () => {
      open = false;
    };
    ws.onerror = () => {
      open = false; // stay silent — memory is best-effort
    };
  } catch {
    return NOOP;
  }

  const safeSend = (data: string | ArrayBufferView) => {
    try {
      if (open && ws && ws.readyState === WebSocket.OPEN) ws.send(data as never);
    } catch {
      /* ignore — never disturb the voice loop */
    }
  };

  return {
    // Send a copy, so nothing this consumer does can affect the exact bytes
    // already handed to Gemini.
    sendAudio: (pcm) => safeSend(pcm.slice()),
    endTurn: (transcript) => safeSend(JSON.stringify({ type: 'turn_end', transcript })),
    reset: () => safeSend(JSON.stringify({ type: 'reset' })),
    close: () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
