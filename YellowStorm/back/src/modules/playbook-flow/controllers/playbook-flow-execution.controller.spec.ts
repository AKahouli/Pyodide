import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowExecutionController } from './playbook-flow-execution.controller';
import { normalizeApprovalDecision } from '../dto/resume-playbook-flow-approval.dto';

describe('PlaybookFlowExecutionController', () => {
  const executionService = {
    findOne: jest.fn(),
    resumeApproval: jest.fn(),
    resumeFromStep: jest.fn(),
    cancel: jest.fn(),
    delete: jest.fn(),
  };
  const replayService = {
    traceReplay: jest.fn(),
    reExecute: jest.fn(),
  };
  const artifactService = { issueAccess: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-1' });
    executionService.resumeApproval.mockResolvedValue({ resumed: true });
    executionService.resumeFromStep.mockResolvedValue({ id: 'exec-1', status: 'running' });
    executionService.cancel.mockResolvedValue({ cancelled: true });
    executionService.delete.mockResolvedValue(undefined);
  });

  it('returns nested compat execution details when flowId matches', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any, artifactService as any);

    await expect(controller.compatGetExecution('user-1', 'flow-1', 'exec-1')).resolves.toEqual({
      id: 'exec-1',
      flowId: 'flow-1',
    });
    expect(executionService.findOne).toHaveBeenCalledWith('exec-1', 'user-1');
  });

  it('rejects nested compat execution reads when the execution belongs to another flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any, artifactService as any);
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-2' });

    await expect(controller.compatGetExecution('user-1', 'flow-1', 'exec-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects compat resume when the execution belongs to another flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any, artifactService as any);
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-2' });

    await expect(controller.compatResume('user-1', 'flow-1', { executionId: 'exec-1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(executionService.resumeApproval).not.toHaveBeenCalled();
  });

  it('rejects compat stop when the execution belongs to another flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any, artifactService as any);
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-2' });

    await expect(controller.compatStop('user-1', 'flow-1', { executionId: 'exec-1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(executionService.cancel).not.toHaveBeenCalled();
  });

  it('resumes a compat interrupted step when the execution belongs to the flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any, artifactService as any);

    await expect(controller.compatResumeFromStep('user-1', 'flow-1', 'exec-1', { taskId: 'task-1' })).resolves.toEqual({
      status: 'running',
      executionId: 'exec-1',
    });
    expect(executionService.resumeFromStep).toHaveBeenCalledWith('exec-1', 'user-1', { taskId: 'task-1', streaming: undefined, action: undefined, interruptId: undefined, iteration: undefined, message: undefined, approved: undefined, reason: undefined, feedback: undefined, payload: undefined });
  });

  it('rejects compat delete when the execution belongs to another flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any, artifactService as any);
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-2' });

    await expect(controller.compatDeleteExecution('user-1', 'flow-1', 'exec-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(executionService.delete).not.toHaveBeenCalled();
  });

  it('normalizes approval decision aliases at the request boundary', () => {
    expect(normalizeApprovalDecision('approve')).toBe('approved');
    expect(normalizeApprovalDecision('REJECT')).toBe('rejected');
    expect(normalizeApprovalDecision('skip')).toBe('skip');
  });
});
