import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVoiceSession, voiceDispatch, voiceStatus, voiceTranscript } from './api';
import apiClient from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ default: { post: vi.fn() } }));

describe('voice api', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createVoiceSession posts the resumption handle and unwraps the envelope', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { data: { wsUrl: 'wss://x', setup: {}, expiresAt: 'z' } } });
    const env = await createVoiceSession('h1');
    expect(apiClient.post).toHaveBeenCalledWith('/worky/voice/session', { resumptionHandle: 'h1' });
    expect(env.wsUrl).toBe('wss://x');
  });

  it('voiceDispatch posts streamId + message', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { data: { runId: 'r', sessionId: 's', accepted: true } } });
    const res = await voiceDispatch('s1', 'go');
    expect(apiClient.post).toHaveBeenCalledWith('/worky/voice/tool/dispatch', { streamId: 's1', message: 'go' });
    expect(res.runId).toBe('r');
  });

  it('voiceStatus posts streamId', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { data: { status: 'running', title: 'T', plan: {} } } });
    const res = await voiceStatus('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/worky/voice/tool/status', { streamId: 's1' });
    expect(res.status).toBe('running');
  });

  it('voiceTranscript posts the turn', async () => {
    (apiClient.post as any).mockResolvedValue({ data: {} });
    await voiceTranscript('s1', 'manager', 'hi');
    expect(apiClient.post).toHaveBeenCalledWith('/worky/voice/tool/transcript', { streamId: 's1', role: 'manager', text: 'hi' });
  });
});
