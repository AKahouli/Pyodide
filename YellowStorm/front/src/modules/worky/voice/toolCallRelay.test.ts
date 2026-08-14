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

  it('routes list_tasks to voiceListTasks', async () => {
    (api.voiceListTasks as any).mockResolvedValue({ tasks: [{ id: 't1', title: 'A', lane: 'running', executionState: 'running', blocked: false }] });
    const res = await handleToolCall('s1', { id: 'c5', name: 'list_tasks', args: {} });
    expect(api.voiceListTasks).toHaveBeenCalledWith('s1');
    expect((res.response as any).tasks[0].id).toBe('t1');
  });

  it('routes get_task_details to voiceTaskDetails with the task id', async () => {
    (api.voiceTaskDetails as any).mockResolvedValue({ id: 't1', title: 'A', result: 'done', artifacts: [] });
    const res = await handleToolCall('s1', { id: 'c6', name: 'get_task_details', args: { taskId: 't1' } });
    expect(api.voiceTaskDetails).toHaveBeenCalledWith('s1', 't1');
    expect((res.response as any).result).toBe('done');
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
