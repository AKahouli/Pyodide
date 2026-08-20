import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { GeminiLiveHandlers } from './geminiLiveClient';

// --- Module mocks (transport, api, side-effects) -------------------------
const createVoiceSession = vi.fn(async (..._a: unknown[]) => ({ wsUrl: 'wss://x', setup: {}, expiresAt: 'z' }));
vi.mock('../api', () => ({ createVoiceSession: (...a: unknown[]) => createVoiceSession(...a) }));

const openCalls: GeminiLiveHandlers[] = [];
const fakeConn = () => ({
  sendAudioChunk: vi.fn(),
  sendText: vi.fn(),
  sendToolResponse: vi.fn(),
  close: vi.fn(), // does NOT auto-fire onClose — the test drives close timing
});
vi.mock('./geminiLiveClient', () => ({
  openGeminiLive: (_env: unknown, handlers: GeminiLiveHandlers) => {
    openCalls.push(handlers);
    return fakeConn();
  },
}));

vi.mock('./milestoneInjector', () => ({ attachMilestoneInjector: () => () => undefined }));
vi.mock('./toolCallRelay', () => ({ handleToolCall: vi.fn(async () => ({ id: 'c', name: 'n', response: {} })) }));
vi.mock('./voiceSettings', () => ({ useVoiceSettings: () => ({}) }));

import { useRealtimeVoiceSession } from './useRealtimeVoiceSession';

// --- Browser audio stubs -------------------------------------------------
function stubAudio() {
  const node = { port: { onmessage: null as unknown }, connect: vi.fn(), disconnect: vi.fn() };
  class AudioContextMock {
    currentTime = 0;
    sampleRate = 48000;
    destination = {};
    resume = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    audioWorklet = { addModule: vi.fn(async () => undefined) };
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
    createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() }));
    createBuffer = vi.fn(() => ({ copyToChannel: vi.fn(), duration: 0 }));
    createBufferSource = vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), buffer: null, onended: null }));
  }
  vi.stubGlobal('AudioContext', AudioContextMock);
  vi.stubGlobal('AudioWorkletNode', vi.fn(() => node));
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
  });
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
  });
}

// Let all of connect()'s awaits (createVoiceSession, resume, getUserMedia,
// addModule) settle before we inspect refs.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('useRealtimeVoiceSession', () => {
  beforeEach(() => {
    openCalls.length = 0;
    createVoiceSession.mockClear();
    stubAudio();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not reconnect a connection that has been superseded by a restart', async () => {
    const { result } = renderHook(() => useRealtimeVoiceSession('s1'));

    // First session for stream A.
    await act(async () => { result.current.start(); });
    await flush();
    expect(openCalls).toHaveLength(1);
    const firstHandlers = openCalls[0];

    // Tear it down and start a fresh session (what a stream switch does:
    // stop() then start()).
    await act(async () => { result.current.stop(); });
    await act(async () => { result.current.start(); });
    await flush();
    expect(openCalls).toHaveLength(2);
    expect(createVoiceSession).toHaveBeenCalledTimes(2);

    // The old socket now closes late (async in the browser), after the new
    // session already reset the shared closing flag. It must NOT reconnect —
    // reconnecting would resurrect the previous stream's conversation.
    await act(async () => { firstHandlers.onClose?.({ code: 1000, reason: '' } as CloseEvent); });
    await flush();

    expect(createVoiceSession).toHaveBeenCalledTimes(2);
    expect(openCalls).toHaveLength(2);
  });

  it('still reconnects the active connection when it drops unexpectedly', async () => {
    const { result } = renderHook(() => useRealtimeVoiceSession('s1'));

    await act(async () => { result.current.start(); });
    await flush();
    expect(openCalls).toHaveLength(1);

    // The current (active) socket drops on its own — this must reconnect using
    // the resumption handle so the same conversation continues.
    await act(async () => { openCalls[0].onClose?.({ code: 1000, reason: '' } as CloseEvent); });
    await flush();

    expect(openCalls).toHaveLength(2);
    expect(createVoiceSession).toHaveBeenCalledTimes(2);
  });
});
