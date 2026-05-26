import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowExecutionController } from './playbook-flow-execution.controller';

describe('PlaybookFlowExecutionController', () => {
  const executionService = {
    findOne: jest.fn(),
    resumeApproval: jest.fn(),
    cancel: jest.fn(),
    delete: jest.fn(),
  };
  const replayService = {
    traceReplay: jest.fn(),
    reExecute: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-1' });
    executionService.resumeApproval.mockResolvedValue({ resumed: true });
    executionService.cancel.mockResolvedValue({ cancelled: true });
    executionService.delete.mockResolvedValue(undefined);
  });

  it('returns nested compat execution details when flowId matches', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any);

    await expect(controller.compatGetExecution('user-1', 'flow-1', 'exec-1')).resolves.toEqual({
      id: 'exec-1',
      flowId: 'flow-1',
    });
    expect(executionService.findOne).toHaveBeenCalledWith('exec-1', 'user-1');
  });

  it('rejects nested compat execution reads when the execution belongs to another flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any);
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-2' });

    await expect(controller.compatGetExecution('user-1', 'flow-1', 'exec-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects compat resume when the execution belongs to another flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any);
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-2' });

    await expect(controller.compatResume('user-1', 'flow-1', { executionId: 'exec-1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(executionService.resumeApproval).not.toHaveBeenCalled();
  });

  it('rejects compat stop when the execution belongs to another flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any);
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-2' });

    await expect(controller.compatStop('user-1', 'flow-1', { executionId: 'exec-1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(executionService.cancel).not.toHaveBeenCalled();
  });

  it('rejects compat delete when the execution belongs to another flow', async () => {
    const controller = new PlaybookFlowExecutionController(executionService as any, replayService as any);
    executionService.findOne.mockResolvedValue({ id: 'exec-1', flowId: 'flow-2' });

    await expect(controller.compatDeleteExecution('user-1', 'flow-1', 'exec-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(executionService.delete).not.toHaveBeenCalled();
  });
});
