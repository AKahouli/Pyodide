import { PlaybookFlowHitlController } from './playbook-flow-hitl.controller';

describe('PlaybookFlowHitlController', () => {
  const hitlService = {
    getPolicy: jest.fn(),
    updatePolicy: jest.fn(),
    getNodePolicy: jest.fn(),
    updateNodePolicy: jest.fn(),
    listBlockers: jest.fn(),
    createBlocker: jest.fn(),
    normalizeBlocker: jest.fn(),
    updateBlocker: jest.fn(),
    deleteBlocker: jest.fn(),
    listMemories: jest.fn(),
    createMemory: jest.fn(),
    updateMemory: jest.fn(),
    deleteMemory: jest.fn(),
    listExecutionEvents: jest.fn(),
    getPendingInterrupt: jest.fn(),
    disableBlocker: jest.fn(),
  };

  const executionService = {
    resumeFromStep: jest.fn(),
  };

  const controller = new PlaybookFlowHitlController(hitlService as any, executionService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('gets and updates workflow HITL policy via service', async () => {
    hitlService.getPolicy.mockResolvedValue({ mode: 'auto' });
    hitlService.updatePolicy.mockResolvedValue({ mode: 'manual' });

    await expect(controller.getPolicy('user-1', 'flow-1')).resolves.toEqual({ mode: 'auto' });
    expect(hitlService.getPolicy).toHaveBeenCalledWith('flow-1', 'user-1');

    await expect(controller.updatePolicy('user-1', 'flow-1', { mode: 'manual' } as any)).resolves.toEqual({ mode: 'manual' });
    expect(hitlService.updatePolicy).toHaveBeenCalledWith('flow-1', 'user-1', { mode: 'manual' });
  });

  it('gets and updates node HITL policy via service', async () => {
    hitlService.getNodePolicy.mockResolvedValue({ mode: 'auto' });
    hitlService.updateNodePolicy.mockResolvedValue({ mode: 'off' });

    await expect(controller.getNodePolicy('user-1', 'flow-1', 'node-1')).resolves.toEqual({ mode: 'auto' });
    expect(hitlService.getNodePolicy).toHaveBeenCalledWith('flow-1', 'user-1', 'node-1');

    await expect(controller.updateNodePolicy('user-1', 'flow-1', 'node-1', { mode: 'off' } as any)).resolves.toEqual({ mode: 'off' });
    expect(hitlService.updateNodePolicy).toHaveBeenCalledWith('flow-1', 'user-1', 'node-1', { mode: 'off' });
  });

  it('lists, creates, updates, and deletes workflow blockers', async () => {
    hitlService.listBlockers.mockResolvedValue([{ id: 'b1' }]);
    hitlService.createBlocker.mockResolvedValue({ id: 'b1' });
    hitlService.updateBlocker.mockResolvedValue({ id: 'b1' });
    hitlService.deleteBlocker.mockResolvedValue({ deleted: true });

    await expect(controller.listBlockers('user-1', 'flow-1')).resolves.toEqual([{ id: 'b1' }]);
    expect(hitlService.listBlockers).toHaveBeenCalledWith('flow-1', 'user-1');

    await expect(controller.createBlocker('user-1', 'flow-1', { kind: 'custom', label: 'x', description: 'y', action: 'clarify' } as any)).resolves.toEqual({ id: 'b1' });
    expect(hitlService.createBlocker).toHaveBeenCalledWith('flow-1', 'user-1', {
      kind: 'custom',
      label: 'x',
      description: 'y',
      action: 'clarify',
    });

    await expect(controller.updateBlocker('user-1', 'flow-1', 'b1', { enabled: true } as any)).resolves.toEqual({ id: 'b1' });
    expect(hitlService.updateBlocker).toHaveBeenCalledWith('flow-1', 'user-1', 'b1', { enabled: true });

    await expect(controller.deleteBlocker('user-1', 'flow-1', 'b1')).resolves.toEqual({ deleted: true });
    expect(hitlService.deleteBlocker).toHaveBeenCalledWith('flow-1', 'user-1', 'b1');
  });

  it('normalizes blocker payload through service helper', async () => {
    hitlService.normalizeBlocker.mockReturnValue({ kind: 'custom', action: 'clarify', label: 'parsed', description: 'desc' } as any);

    expect(controller.normalizeBlocker({ description: 'desc' } as any)).toEqual({
      kind: 'custom',
      action: 'clarify',
      label: 'parsed',
      description: 'desc',
    });
    expect(hitlService.normalizeBlocker).toHaveBeenCalledWith({ description: 'desc' });
  });

  it('lists and mutates HITL memories', async () => {
    hitlService.listMemories.mockResolvedValue([{ id: 'm1' }]);
    hitlService.createMemory.mockResolvedValue({ id: 'm1' });
    hitlService.updateMemory.mockResolvedValue({ id: 'm1' });
    hitlService.deleteMemory.mockResolvedValue({ deleted: true });

    await expect(controller.listMemories('user-1', 'flow-1')).resolves.toEqual([{ id: 'm1' }]);
    expect(hitlService.listMemories).toHaveBeenCalledWith('flow-1', 'user-1');

    await expect(controller.createMemory('user-1', 'flow-1', {
      title: 't',
      content: 'c',
      normalizedInstruction: 'i',
    } as any)).resolves.toEqual({ id: 'm1' });
    expect(hitlService.createMemory).toHaveBeenCalledWith('flow-1', 'user-1', {
      title: 't',
      content: 'c',
      normalizedInstruction: 'i',
    });

    await expect(controller.updateMemory('user-1', 'flow-1', 'm1', { title: 't2' } as any)).resolves.toEqual({ id: 'm1' });
    expect(hitlService.updateMemory).toHaveBeenCalledWith('flow-1', 'user-1', 'm1', { title: 't2' });

    await expect(controller.deleteMemory('user-1', 'flow-1', 'm1')).resolves.toEqual({ deleted: true });
    expect(hitlService.deleteMemory).toHaveBeenCalledWith('flow-1', 'user-1', 'm1');
  });

  it('reads execution HITL events and pending interrupt', async () => {
    hitlService.listExecutionEvents.mockResolvedValue([{ kind: 'created' }]);
    hitlService.getPendingInterrupt.mockResolvedValue({ interruptId: 'int-1' });

    await expect(controller.listExecutionEvents('user-1', 'exec-1')).resolves.toEqual([{ kind: 'created' }]);
    expect(hitlService.listExecutionEvents).toHaveBeenCalledWith('exec-1', 'user-1');

    await expect(controller.getPendingInterrupt('user-1', 'exec-1')).resolves.toEqual({ interruptId: 'int-1' });
    expect(hitlService.getPendingInterrupt).toHaveBeenCalledWith('exec-1', 'user-1');
  });

  it('resumes a pending interrupt with explicit taskId when provided', async () => {
    hitlService.getPendingInterrupt.mockResolvedValue({ nodeId: 'pending-node' });
    executionService.resumeFromStep.mockResolvedValue({ status: 'running' });

    await expect(
      controller.resumeInterrupt('user-1', 'exec-1', 'int-1', {
        action: 'approve',
        taskId: 'explicit-node',
        feedback: 'Looks good',
      } as any),
    ).resolves.toEqual({ status: 'running' });
    expect(executionService.resumeFromStep).toHaveBeenCalledWith('exec-1', 'user-1', {
      taskId: 'explicit-node',
      action: 'approve',
      interruptId: 'int-1',
      message: undefined,
      approved: undefined,
      reason: undefined,
      feedback: 'Looks good',
      scope: undefined,
      remember: undefined,
      payload: undefined,
    });
  });

  it('resumes a pending interrupt using fallback nodeId when taskId is omitted', async () => {
    hitlService.getPendingInterrupt.mockResolvedValue({ nodeId: 'pending-node' });
    executionService.resumeFromStep.mockResolvedValue({ status: 'running' });

    await expect(
      controller.resumeInterrupt('user-1', 'exec-1', 'int-1', { action: 'reply', message: 'Need more details' } as any),
    ).resolves.toEqual({ status: 'running' });
    expect(executionService.resumeFromStep).toHaveBeenCalledWith('exec-1', 'user-1', {
      taskId: 'pending-node',
      action: 'reply',
      interruptId: 'int-1',
      message: 'Need more details',
      approved: undefined,
      reason: undefined,
      feedback: undefined,
      scope: undefined,
      remember: undefined,
      payload: undefined,
    });
  });

  it('uses empty taskId when no pending interrupt exists', async () => {
    hitlService.getPendingInterrupt.mockResolvedValue(null);
    executionService.resumeFromStep.mockResolvedValue({ status: 'running' });

    await expect(controller.resumeInterrupt('user-1', 'exec-1', 'int-1', { action: 'skip' } as any)).resolves.toEqual({ status: 'running' });
    expect(executionService.resumeFromStep).toHaveBeenCalledWith('exec-1', 'user-1', {
      taskId: '',
      action: 'skip',
      interruptId: 'int-1',
      message: undefined,
      approved: undefined,
      reason: undefined,
      feedback: undefined,
      scope: undefined,
      remember: undefined,
      payload: undefined,
    });
  });

  it('disables blocker for execution if service allows it', async () => {
    hitlService.disableBlocker.mockResolvedValue({ disabled: true });

    await expect(controller.disableBlocker('user-1', 'exec-1', 'int-1')).resolves.toEqual({ disabled: true });
    expect(hitlService.disableBlocker).toHaveBeenCalledWith('exec-1', 'user-1', 'int-1');
  });
});
