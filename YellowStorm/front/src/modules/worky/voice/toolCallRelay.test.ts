import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall } from './toolCallRelay';
import * as api from '../api';

vi.mock('../api');

describe('handleToolCall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes dispatch_task to voiceDispatch', async () => {
    (api.voiceDispatch as any).mockResolvedValue({ runId: 'r', sessionId: 's', accepted: true });
    const res = await handleToolCall('s1', { id: 'c1', name: 'dispatch_task', args: { message: 'go' } });
    expect(api.voiceDispatch).toHaveBeenCalledWith('s1', 'go');
    expect(res).toEqual({ id: 'c1', name: 'dispatch_task', response: { runId: 'r', accepted: true } });
  });

  it('routes query_status to voiceStatus', async () => {
    (api.voiceStatus as any).mockResolvedValue({ status: 'running', title: 'T', plan: {} });
    const res = await handleToolCall('s1', { id: 'c2', name: 'query_status', args: {} });
    expect(res.response).toEqual({ status: 'running', title: 'T' });
  });

  it('returns an error response on failure so the model can recover', async () => {
    (api.voiceDispatch as any).mockRejectedValue(new Error('boom'));
    const res = await handleToolCall('s1', { id: 'c3', name: 'dispatch_task', args: { message: 'x' } });
    expect(res.response).toEqual({ error: 'boom' });
  });

  it('returns an error for unknown tools', async () => {
    const res = await handleToolCall('s1', { id: 'c4', name: 'nope', args: {} });
    expect(res.response).toHaveProperty('error');
  });
});
