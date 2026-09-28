import { PlaybookFlowHitlContextService } from './playbook-flow-hitl-context.service';

describe('PlaybookFlowHitlContextService', () => {
  const executionRepository = { findOwned: jest.fn() };
  const service = new PlaybookFlowHitlContextService(executionRepository as any);

  const pendingApproval = { nodeId: 'task-1', iteration: 0, prompt: 'Approve?', interruptId: 'interrupt-1', blockerRuleId: 'rule-1' };
  const hitlEvents = [{ id: 'event-1', nodeId: 'task-1', iteration: 0, interruptId: 'interrupt-1', status: 'pending' }];

  beforeEach(() => {
    jest.clearAllMocks();
    executionRepository.findOwned.mockResolvedValue({ id: 'exec-1', flowId: 'flow-1', ownerId: 'owner-1', pendingApproval, hitlEvents });
  });

  it('reads the HITL audit and the pending interrupt of an execution the caller owns', async () => {
    await expect(service.listExecutionEvents('exec-1', 'owner-1')).resolves.toEqual(hitlEvents);
    await expect(service.getPendingInterrupt('exec-1', 'owner-1')).resolves.toEqual(pendingApproval);
    expect(executionRepository.findOwned).toHaveBeenCalledWith('exec-1', 'owner-1');
  });

  it('returns null when the execution is not paused', async () => {
    executionRepository.findOwned.mockResolvedValue({ id: 'exec-1', flowId: 'flow-1', pendingApproval: null, hitlEvents: [] });

    await expect(service.getPendingInterrupt('exec-1', 'owner-1')).resolves.toBeNull();
    await expect(service.getPendingBlocker('exec-1', 'owner-1', 'interrupt-1')).resolves.toBeNull();
  });

  it('names the blocker behind the pending interrupt only when the interrupt matches', async () => {
    await expect(service.getPendingBlocker('exec-1', 'owner-1', 'interrupt-1')).resolves.toEqual({ flowId: 'flow-1', blockerId: 'rule-1' });
    await expect(service.getPendingBlocker('exec-1', 'owner-1', 'interrupt-2')).resolves.toBeNull();
  });

  it('reports an execution the caller does not own as not found', async () => {
    executionRepository.findOwned.mockResolvedValue(null);

    await expect(service.listExecutionEvents('exec-1', 'someone-else')).rejects.toThrow('Execution not found');
  });
});
