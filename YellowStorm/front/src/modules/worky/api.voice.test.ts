import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createVoiceSession,
  getVoicePrompt,
  setVoicePrompt,
  voiceDispatch,
  voiceStatus,
  voiceTranscript,
} from './api';
import apiClient from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ default: { post: vi.fn(), get: vi.fn(), put: vi.fn() } }));

describe('voice api', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createVoiceSession posts streamId + handle and unwraps the envelope', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { data: { wsUrl: 'wss://x', setup: {}, expiresAt: 'z' } } });
    const env = await createVoiceSession('s1', 'h1');
    expect(apiClient.post).toHaveBeenCalledWith('/worky/voice/session', { streamId: 's1', resumptionHandle: 'h1' });
    expect(env.wsUrl).toBe('wss://x');
  });

  it('getVoicePrompt GETs the per-stream prompt', async () => {
    (apiClient.get as any).mockResolvedValue({ data: { data: { prompt: 'p', isDefault: false } } });
    const res = await getVoicePrompt('s1');
    expect(apiClient.get).toHaveBeenCalledWith('/worky/voice/prompt/s1');
    expect(res.prompt).toBe('p');
  });

  it('setVoicePrompt PUTs the prompt', async () => {
    (apiClient.put as any).mockResolvedValue({ data: { data: { prompt: 'p2', isDefault: false } } });
    const res = await setVoicePrompt('s1', 'p2');
    expect(apiClient.put).toHaveBeenCalledWith('/worky/voice/prompt/s1', { prompt: 'p2' });
    expect(res.prompt).toBe('p2');
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
