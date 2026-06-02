import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playbookKeys } from '@/modules/playbook/query/queryKeys';

const apiMocks = vi.hoisted(() => ({
  createPlaybook: vi.fn(),
  updatePlaybook: vi.fn(),
  patchFlowDelta: vi.fn(),
  deletePlaybook: vi.fn(),
  clonePlaybook: vi.fn(),
  startFlowExecution: vi.fn(),
  cancelFlowExecution: vi.fn(),
  resumeFlowApproval: vi.fn(),
  resumePlaybookFromStep: vi.fn(),
  validateTaskReplay: vi.fn(),
  validateFlowTaskReplay: vi.fn(),
  updateOutputFormatTemplate: vi.fn(),
  updateFlowOutputFormatTemplate: vi.fn(),
  upsertFlowTriggerSchedule: vi.fn(),
  upsertFlowTriggerMail: vi.fn(),
  designFlow: vi.fn(),
}));

vi.mock('@/modules/playbook/api', () => apiMocks);

describe('playbook query mutation actions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { playbookQueryClient } = await import('@/modules/playbook/query/queryClient');
    playbookQueryClient.clear();
  });

  it('updates detail caches after create, full save, clone, and delete mutations', async () => {
    const { playbookQueryClient } = await import('@/modules/playbook/query/queryClient');
    const {
      clonePlaybookMutation,
      createPlaybookMutation,
      deletePlaybookMutation,
      updatePlaybookMutation,
    } = await import('@/modules/playbook/query/mutationActions');
    const playbook = { id: 'flow-1', name: 'Draft', tasks: [], nodes: [] };
    const cloned = { ...playbook, id: 'flow-2', name: 'Draft copy' };

    apiMocks.createPlaybook.mockResolvedValueOnce(playbook);
    apiMocks.updatePlaybook.mockResolvedValueOnce({ ...playbook, name: 'Saved' });
    apiMocks.clonePlaybook.mockResolvedValueOnce(cloned);
    apiMocks.deletePlaybook.mockResolvedValueOnce(undefined);

    await createPlaybookMutation({ name: 'Draft' } as Parameters<typeof createPlaybookMutation>[0]);
    await updatePlaybookMutation({ id: 'flow-1', data: { name: 'Saved' } });
    await clonePlaybookMutation('flow-1');

    expect(playbookQueryClient.getQueryData(playbookKeys.legacyDetail('flow-1'))).toMatchObject({ name: 'Saved' });
    expect(playbookQueryClient.getQueryData(playbookKeys.detail('flow-1', 'base'))).toMatchObject({ name: 'Saved' });
    expect(playbookQueryClient.getQueryData(playbookKeys.legacyDetail('flow-2'))).toMatchObject({ name: 'Draft copy' });

    await deletePlaybookMutation('flow-1');

    expect(playbookQueryClient.getQueryData(playbookKeys.legacyDetail('flow-1'))).toBeUndefined();
    expect(apiMocks.deletePlaybook).toHaveBeenCalledWith('flow-1');
  });

  it('keeps autosave delta and execution mutations behind Query invalidation boundaries', async () => {
    const { playbookQueryClient } = await import('@/modules/playbook/query/queryClient');
    const {
      cancelExecutionMutation,
      patchFlowDeltaMutation,
      resumeApprovalMutation,
      resumeFromStepMutation,
      startExecutionMutation,
    } = await import('@/modules/playbook/query/mutationActions');
    const invalidateSpy = vi.spyOn(playbookQueryClient, 'invalidateQueries');

    apiMocks.patchFlowDelta.mockResolvedValueOnce({ updatedAt: '2026-05-30T00:00:00.000Z' });
    apiMocks.startFlowExecution.mockResolvedValueOnce({ executionId: 'exec-1' });
    apiMocks.cancelFlowExecution.mockResolvedValueOnce(undefined);
    apiMocks.resumeFlowApproval.mockResolvedValueOnce({ ok: true });
    apiMocks.resumePlaybookFromStep.mockResolvedValueOnce({ executionId: 'exec-2' });

    const deltaPatch = {
      expectedUpdatedAt: '2026-05-30T00:00:00.000Z',
      patch: { fields: { name: 'Saved' } },
    };

    await patchFlowDeltaMutation({ id: 'flow-1', data: deltaPatch, idempotencyKey: 'save-1' });
    await startExecutionMutation({ flowId: 'flow-1', inputContext: { value: true }, idempotencyKey: 'run-1' });
    await cancelExecutionMutation('exec-1');
    await resumeApprovalMutation({ executionId: 'exec-1', decision: 'approve', payload: { taskId: 'task-1' } });
    await resumeFromStepMutation({ playbookId: 'flow-1', executionId: 'exec-1', data: { taskId: 'task-1' } });

    expect(apiMocks.patchFlowDelta).toHaveBeenCalledWith('flow-1', deltaPatch, 'save-1');
    expect(apiMocks.startFlowExecution).toHaveBeenCalledWith('flow-1', { value: true }, 'run-1', undefined);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: playbookKeys.detail('flow-1', 'base') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: playbookKeys.activeExecutions() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: playbookKeys.execution('exec-2') });
  });

  it('refreshes replay, template, trigger, and design caches after domain mutations', async () => {
    const { playbookQueryClient } = await import('@/modules/playbook/query/queryClient');
    const {
      designFlowMutation,
      updateFlowOutputFormatTemplateMutation,
      updateOutputFormatTemplateMutation,
      upsertTriggerMailMutation,
      upsertTriggerScheduleMutation,
      validateFlowReplayMutation,
      validateReplayMutation,
    } = await import('@/modules/playbook/query/mutationActions');
    const invalidateSpy = vi.spyOn(playbookQueryClient, 'invalidateQueries');
    const playbookTemplate = { id: 'template-1', templateVersion: 1 };
    const flowTemplate = { id: 'template-2', templateVersion: 2 };

    apiMocks.validateTaskReplay.mockResolvedValueOnce({ id: 'replay-1' });
    apiMocks.validateFlowTaskReplay.mockResolvedValueOnce({ id: 'replay-2' });
    apiMocks.updateOutputFormatTemplate.mockResolvedValueOnce(playbookTemplate);
    apiMocks.updateFlowOutputFormatTemplate.mockResolvedValueOnce(flowTemplate);
    apiMocks.upsertFlowTriggerSchedule.mockResolvedValueOnce({ id: 'trigger-1' });
    apiMocks.upsertFlowTriggerMail.mockResolvedValueOnce({ id: 'trigger-2' });
    apiMocks.designFlow.mockResolvedValueOnce({ message: 'done' });

    await validateReplayMutation({ playbookId: 'playbook-1', taskId: 'task-1', data: { executionId: 'exec-1' } });
    await validateFlowReplayMutation({ flowId: 'flow-1', taskId: 'task-1', data: { executionId: 'exec-1' } });
    await updateOutputFormatTemplateMutation({ playbookId: 'playbook-1', taskId: 'task-1', data: { formatGuide: 'json' } });
    await updateFlowOutputFormatTemplateMutation({ flowId: 'flow-1', taskId: 'task-1', data: { formatGuide: 'json' } });
    await upsertTriggerScheduleMutation({ flowId: 'flow-1', data: { enabled: true } });
    await upsertTriggerMailMutation({ flowId: 'flow-1', data: { enabled: true } });
    await designFlowMutation({ flowId: 'flow-1', data: { query: 'add validation' } });

    expect(playbookQueryClient.getQueryData(playbookKeys.outputFormatTemplate('playbook-1', 'task-1'))).toBe(playbookTemplate);
    expect(playbookQueryClient.getQueryData(playbookKeys.flowOutputFormatTemplate('flow-1', 'task-1'))).toBe(flowTemplate);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: playbookKeys.replays('playbook-1', 'task-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: playbookKeys.flowTriggers('flow-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: playbookKeys.designMessages('flow-1') });
  });
});
