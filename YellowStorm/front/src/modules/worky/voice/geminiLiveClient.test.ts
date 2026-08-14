import { describe, it, expect, vi } from 'vitest';
import { openGeminiLive } from './geminiLiveClient';
import { int16ToBase64 } from './pcmAudio';

class FakeWS {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: (e: unknown) => void;
  onerror?: (e: unknown) => void;
  constructor(public url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function setup() {
  let ws!: FakeWS;
  const handlers = {
    onAudio: vi.fn(),
    onToolCall: vi.fn(),
    onResumptionHandle: vi.fn(),
    onOutputTranscript: vi.fn(),
  };
  const conn = openGeminiLive(
    { wsUrl: 'wss://x?access_token=t', setup: {}, expiresAt: 'z' },
    handlers as never,
    (url) => {
      ws = new FakeWS(url);
      return ws as unknown as WebSocket;
    },
  );
  return { ws, conn, handlers };
}

describe('geminiLiveClient', () => {
  it('sends the setup message on open', () => {
    const { ws } = setup();
    ws.onopen?.();
    expect(JSON.parse(ws.sent[0])).toEqual({ setup: {} });
  });

  it('encodes audio chunks as realtimeInput pcm', () => {
    const { ws, conn } = setup();
    ws.onopen?.();
    conn.sendAudioChunk(new Int16Array([1, 2, 3]));
    const msg = JSON.parse(ws.sent[1]);
    expect(msg.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(msg.realtimeInput.audio.data).toBe(int16ToBase64(new Int16Array([1, 2, 3])));
  });

  it('routes incoming toolCall, resumption and audio', () => {
    const { ws, handlers } = setup();
    ws.onopen?.();
    ws.emit({ toolCall: { functionCalls: [{ id: 'c1', name: 'dispatch_task', args: { message: 'go' } }] } });
    expect(handlers.onToolCall).toHaveBeenCalledWith([{ id: 'c1', name: 'dispatch_task', args: { message: 'go' } }]);
    ws.emit({ sessionResumptionUpdate: { resumable: true, newHandle: 'h-7' } });
    expect(handlers.onResumptionHandle).toHaveBeenCalledWith('h-7');
    ws.emit({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: int16ToBase64(new Int16Array([9])) } }] } },
    });
    expect(handlers.onAudio).toHaveBeenCalled();
  });

  it('sends tool responses', () => {
    const { ws, conn } = setup();
    ws.onopen?.();
    conn.sendToolResponse([{ id: 'c1', name: 'dispatch_task', response: { ok: true } }]);
    expect(JSON.parse(ws.sent[1])).toEqual({
      toolResponse: { functionResponses: [{ id: 'c1', name: 'dispatch_task', response: { ok: true } }] },
    });
  });
});
