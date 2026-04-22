import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS } from '@/lib/api/config';
import {
  bulkDeletePlaybooks,
  clonePlaybook,
  cloneSharePlaybook,
  createPlaybook,
  deleteAllExecutions,
  executePlaybook,
  getExecution,
  getPlaybook,
  getPlaybooks,
  syncPlaybookTriggerMailSubscription,
  toggleFavorite,
  updatePlaybook,
  upsertPlaybookTriggerSchedule,
  clearPlaybookTriggerSchedule,
  rerunPlaybookStep,
  resumePlaybookFromStep,
} from './api';

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: apiClientMock,
}));

describe('playbook api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets paginated playbooks with query params', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { data: { playbooks: [{ id: 'p1' }], pagination: { page: 1 } } } });
    const result = await getPlaybooks({ page: 2, limit: 10, search: 'ops' });
    expect(apiClientMock.get).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.list, {
      params: { page: 2, limit: 10, search: 'ops' },
    });
    expect(result.playbooks[0].id).toBe('p1');
  });

  it('creates, updates, and fetches a playbook by id', async () => {
    const payload = { name: 'Automation', description: 'desc' };
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { id: 'p1' } } });
    await createPlaybook(payload);
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.list, payload);

    apiClientMock.patch.mockResolvedValueOnce({ data: { data: { id: 'p1', name: 'Updated' } } });
    await updatePlaybook('p1', { name: 'Updated' });
    expect(apiClientMock.patch).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.byId('p1'), { name: 'Updated' });

    apiClientMock.get.mockResolvedValueOnce({ data: { data: { id: 'p1', name: 'Updated' } } });
    const playbook = await getPlaybook('p1');
    expect(apiClientMock.get).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.byId('p1'));
    expect(playbook.id).toBe('p1');
  });

  it('strips client-only task flags before updating a playbook', async () => {
    const task = {
      id: 'task-1',
      title: 'Step 1',
      description: 'desc',
      assignedAgentId: 'agent-1',
      executionOrder: 0,
      positionX: 10,
      positionY: 20,
      interruptBefore: false,
      interruptAfter: false,
      allowClarification: true,
      clarificationPrompt: 'ask',
      maxClarifications: 3,
      inputKeys: ['input'],
      outputKey: 'output',
      enabled: true,
      notifyOnComplete: false,
      notifyEmails: ['a@example.com'],
      stepReplayMode: 'live',
      inputFiles: [],
      taskType: 'generic',
      inputPorts: [],
      outputPorts: [],
      isSavingReplayBaseline: true,
      hasValidatedReplay: true,
      activeReplayId: 'replay-1',
    } as any;

    apiClientMock.patch.mockResolvedValueOnce({ data: { data: { id: 'p1' } } });
    await updatePlaybook('p1', { tasks: [task] });

    expect(apiClientMock.patch).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.byId('p1'), {
      reflectionEnabled: undefined,
      advisorAutopilotEnabled: undefined,
      advisorAutopilotTargetScore: undefined,
      advisorAutopilotMaxTurns: undefined,
      tasks: [{
        id: 'task-1',
        title: 'Step 1',
        description: 'desc',
        assignedAgentId: 'agent-1',
        executionOrder: 0,
        positionX: 10,
        positionY: 20,
        interruptBefore: false,
        interruptAfter: false,
        allowClarification: true,
        clarificationPrompt: 'ask',
        maxClarifications: 3,
        inputKeys: ['input'],
        outputKey: 'output',
        enabled: true,
        notifyOnComplete: false,
        notifyEmails: ['a@example.com'],
        stepReplayMode: 'live',
        inputFiles: [],
        taskType: 'generic',
        inputPorts: [],
        outputPorts: [],
      }],
    });
  });

  it('keeps playbook advisor settings when updating without tasks', async () => {
    apiClientMock.patch.mockResolvedValueOnce({ data: { data: { id: 'p1' } } });

    await updatePlaybook('p1', {
      reflectionEnabled: false,
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 95,
      advisorAutopilotMaxTurns: 3,
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.byId('p1'), {
      reflectionEnabled: false,
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 95,
      advisorAutopilotMaxTurns: 3,
    });
  });

  it('executes and gets execution details', async () => {
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { executionId: 'e1' } } });
    const started = await executePlaybook('p1', { query: 'test run' });
    expect(started.executionId).toBe('e1');
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.execute('p1'), { query: 'test run' });

    apiClientMock.get.mockResolvedValueOnce({ data: { data: { id: 'e1' } } });
    await getExecution('p1', 'e1');
    expect(apiClientMock.get).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.execution('p1', 'e1'));
  });

  it('upserts and clears playbook trigger schedule', async () => {
    apiClientMock.put.mockResolvedValueOnce({ data: { data: { id: 'p1', executionSchedule: null } } });
    await upsertPlaybookTriggerSchedule('p1', {
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      daily: { timesLocal: ['09:00'] },
    });
    expect(apiClientMock.put).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.triggerSchedule('p1'), {
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      daily: { timesLocal: ['09:00'] },
    });

    apiClientMock.delete.mockResolvedValueOnce({ data: { data: { id: 'p1', executionSchedule: null } } });
    await clearPlaybookTriggerSchedule('p1');
    expect(apiClientMock.delete).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.triggerSchedule('p1'));
  });

  it('syncs playbook mail subscription', async () => {
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { id: 'sub-1' } } });

    await syncPlaybookTriggerMailSubscription('p1', {
      notificationUrl: 'https://example.com/api/v1/playbooks/mail/webhook',
      autoRenewUntil: '2026-05-01T23:59:59.999Z',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      `${API_ENDPOINTS.playbooks.triggerMail('p1')}/sync-subscription`,
      {
        notificationUrl: 'https://example.com/api/v1/playbooks/mail/webhook',
        autoRenewUntil: '2026-05-01T23:59:59.999Z',
      },
    );
  });

  it('toggles favorite, bulk deletes, clones, and clone-shares', async () => {
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { isFavorite: true } } });
    await toggleFavorite('p1');
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.favorite('p1'));

    apiClientMock.post.mockResolvedValueOnce({ data: { data: { deleted: 2 } } });
    await bulkDeletePlaybooks(['p1', 'p2']);
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.bulkDelete, { ids: ['p1', 'p2'] });

    apiClientMock.post.mockResolvedValueOnce({ data: { data: { id: 'p2' } } });
    await clonePlaybook('p1');
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.clone('p1'));

    apiClientMock.post.mockResolvedValueOnce({ data: { data: { succeeded: [], failed: [] } } });
    await cloneSharePlaybook('p1', ['a@x.com']);
    expect(apiClientMock.post).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.cloneShare('p1'), { emails: ['a@x.com'] });
  });

  it('deletes all executions for a playbook', async () => {
    apiClientMock.delete.mockResolvedValueOnce({ data: { data: { deleted: 3, kept: 1 } } });
    const result = await deleteAllExecutions('p1');
    expect(apiClientMock.delete).toHaveBeenCalledWith(API_ENDPOINTS.playbooks.deleteAllExecutions('p1'));
    expect(result).toEqual({ deleted: 3, kept: 1 });
  });

  it('targets the rerun and resume-from-step routes', async () => {
    apiClientMock.post.mockResolvedValue({ data: { data: { status: 'running', executionId: 'e1' } } });

    await rerunPlaybookStep('p1', 'e1', { taskId: 't1', runEvaluation: true, executionMode: 'live', streaming: false });
    expect(apiClientMock.post).toHaveBeenCalledWith(
      API_ENDPOINTS.playbooks.rerunStep('p1', 'e1'),
      { taskId: 't1', runEvaluation: true, executionMode: 'live', streaming: false },
    );

    await resumePlaybookFromStep('p1', 'e1', { taskId: 't2', streaming: true });
    expect(apiClientMock.post).toHaveBeenCalledWith(
      API_ENDPOINTS.playbooks.resumeFromStep('p1', 'e1'),
      { taskId: 't2', streaming: true },
    );
  });
});
