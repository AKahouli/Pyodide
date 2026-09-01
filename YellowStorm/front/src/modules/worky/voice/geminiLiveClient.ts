import type { VoiceSessionEnvelope } from '../api';
import { int16ToBase64, base64ToInt16 } from './pcmAudio';

export interface GeminiLiveHandlers {
  onAudio: (pcm: Int16Array) => void;
  onToolCall: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => void;
  onSetupComplete?: () => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  /** Gemini signals the end of a turn — used to segment the user's utterance for memory. */
  onTurnComplete?: () => void;
  onResumptionHandle?: (handle: string) => void;
  onGoAway?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (err: unknown) => void;
}

export interface GeminiLiveConnection {
  sendAudioChunk: (pcm: Int16Array) => void;
  sendText: (text: string) => void;
  sendToolResponse: (responses: Array<{ id: string; name: string; response: Record<string, unknown> }>) => void;
  close: () => void;
}

/**
 * Opens a WebSocket to Gemini Live using a backend-minted, config-locked
 * ephemeral token. The client is transport-only: it relays the server-authored
 * `setup`, streams PCM audio, and surfaces tool calls / transcripts / audio /
 * resumption events. It knows nothing about worky.
 */
export function openGeminiLive(
  envelope: VoiceSessionEnvelope,
  handlers: GeminiLiveHandlers,
  wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
): GeminiLiveConnection {
  const ws = wsFactory(envelope.wsUrl);
  const send = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.onopen = () => {
    if (import.meta.env?.DEV) console.log('[voice] ws open → sending setup', envelope.setup);
    send({ setup: envelope.setup });
  };
  ws.onerror = (e) => handlers.onError?.(e);
  ws.onclose = (e) => handlers.onClose?.(e as CloseEvent);
  ws.onmessage = async (event: MessageEvent) => {
    // Server frames may arrive as text or as a Blob (binary) — normalise to text.
    let raw: string;
    if (typeof event.data === 'string') raw = event.data;
    else if (event.data instanceof Blob) raw = await event.data.text();
    else return;

    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (import.meta.env?.DEV && (msg.setupComplete || msg.error)) {
      console.log('[voice] server frame:', Object.keys(msg), msg.error ?? '');
    }
    if (msg.setupComplete) handlers.onSetupComplete?.();

    if (msg.toolCall?.functionCalls) {
      handlers.onToolCall(
        msg.toolCall.functionCalls.map((f: any) => ({ id: f.id, name: f.name, args: f.args ?? {} })),
      );
    }
    if (msg.sessionResumptionUpdate?.newHandle) handlers.onResumptionHandle?.(msg.sessionResumptionUpdate.newHandle);
    if (msg.goAway) handlers.onGoAway?.();

    const sc = msg.serverContent;
    if (sc) {
      if (sc.inputTranscription?.text) handlers.onInputTranscript?.(sc.inputTranscription.text);
      if (sc.outputTranscription?.text) handlers.onOutputTranscript?.(sc.outputTranscription.text);
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) handlers.onAudio(base64ToInt16(part.inlineData.data));
      }
      if (sc.turnComplete) handlers.onTurnComplete?.();
    }
  };

  return {
    sendAudioChunk: (pcm) =>
      send({ realtimeInput: { audio: { data: int16ToBase64(pcm), mimeType: 'audio/pcm;rate=16000' } } }),
    sendText: (text) => send({ realtimeInput: { text } }),
    sendToolResponse: (responses) => send({ toolResponse: { functionResponses: responses } }),
    close: () => ws.close(),
  };
}
