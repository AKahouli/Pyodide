import { PlaybookFlowExecutionAdvisorController } from './playbook-flow-execution-advisor.controller';

describe('PlaybookFlowExecutionAdvisorController', () => {
  it('delegates advisor execution to the service', async () => {
    const advisorService = {
      runTaskEvaluation: jest.fn().mockResolvedValue({ executionId: 'exec-1', taskId: 'task-1' }),
    };
    const controller = new PlaybookFlowExecutionAdvisorController(advisorService as any);

    const result = await controller.runTaskEvaluation('user-1', 'exec-1', 'task-1', { iteration: 2 });

    expect(advisorService.runTaskEvaluation).toHaveBeenCalledWith('exec-1', 'task-1', 'user-1', { iteration: 2 });
    expect(result).toEqual({ executionId: 'exec-1', taskId: 'task-1' });
  });
});
