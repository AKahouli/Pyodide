import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowEvaluationService } from './playbook-flow-evaluation.service';

const FLOW_ID = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const EXECUTION_ID = 'bbbbbbbbbbbbbbbbbbbbbbb2';

function createService() {
  const executionRepository = { findById: jest.fn().mockResolvedValue({ id: EXECUTION_ID, flowId: FLOW_ID }) };
  const baselineRepository = {
    findActive: jest.fn().mockResolvedValue(null),
    retireActive: jest.fn().mockResolvedValue(1),
    replaceActive: jest.fn(async (input: Record<string, unknown>): Promise<Record<string, unknown> | null> => ({ id: 'baseline-2', ...input, inputSnapshots: [], replacedAt: null })),
  };
  const evaluationExecutionRepository = {
    create: jest.fn(async (input: Record<string, unknown>): Promise<Record<string, unknown> | null> => ({ id: 'evaluation-1', ...input })),
    listByFlow: jest.fn().mockResolvedValue([]),
    listForExecution: jest.fn().mockResolvedValue([]),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new PlaybookFlowEvaluationService(
    executionRepository as any,
    baselineRepository as any,
    evaluationExecutionRepository as any,
    logger as any,
  );
  return { service, executionRepository, baselineRepository, evaluationExecutionRepository };
}

describe('PlaybookFlowEvaluationService', () => {
  it('reads the active baseline of a task, optionally for one iteration', async () => {
    const { service, baselineRepository } = createService();
    baselineRepository.findActive.mockResolvedValue({ id: 'baseline-1' });

    await expect(service.getActiveBaseline(FLOW_ID, 'task-1', 2)).resolves.toEqual({ id: 'baseline-1' });
    expect(baselineRepository.findActive).toHaveBeenCalledWith(FLOW_ID, 'task-1', 2);
    await service.getActiveBaseline(FLOW_ID, 'task-1');
    expect(baselineRepository.findActive).toHaveBeenLastCalledWith(FLOW_ID, 'task-1', undefined);
  });

  it('lists the 50 newest evaluations of a flow, optionally of one task', async () => {
    const { service, evaluationExecutionRepository } = createService();

    await service.listEvaluationExecutions(FLOW_ID, 'task-1');
    await service.listEvaluationExecutions(FLOW_ID);

    expect(evaluationExecutionRepository.listByFlow).toHaveBeenNthCalledWith(1, FLOW_ID, { taskId: 'task-1', limit: 50 });
    expect(evaluationExecutionRepository.listByFlow).toHaveBeenNthCalledWith(2, FLOW_ID, { taskId: undefined, limit: 50 });
  });

  it('lists the evaluations of one run', async () => {
    const { service, evaluationExecutionRepository } = createService();

    await service.getEvaluationExecution(FLOW_ID, EXECUTION_ID);

    expect(evaluationExecutionRepository.listForExecution).toHaveBeenCalledWith(FLOW_ID, EXECUTION_ID);
  });

  it('retires the active baselines of a task', async () => {
    const { service, baselineRepository } = createService();

    await service.removeActiveBaseline(FLOW_ID, 'task-1');

    expect(baselineRepository.retireActive).toHaveBeenCalledWith(FLOW_ID, 'task-1');
  });

  it('persists an evaluation with the hybrid / completed defaults', async () => {
    const { service, evaluationExecutionRepository } = createService();

    const record = await service.persistEvaluationExecution({ flowId: FLOW_ID, executionId: EXECUTION_ID, taskId: 'task-1', iteration: 0, taskTitle: 'Task', score: 80 });

    expect(evaluationExecutionRepository.create).toHaveBeenCalledWith({
      flowId: FLOW_ID,
      executionId: EXECUTION_ID,
      taskId: 'task-1',
      iteration: 0,
      taskTitle: 'Task',
      mode: 'hybrid',
      status: 'completed',
      score: 80,
      verdict: undefined,
      summary: undefined,
      findings: [],
    });
    expect(record.id).toBe('evaluation-1');
  });

  it('refuses an evaluation for a flow that does not exist', async () => {
    const { service, evaluationExecutionRepository } = createService();
    evaluationExecutionRepository.create.mockResolvedValue(null);

    await expect(service.persistEvaluationExecution({ flowId: FLOW_ID, executionId: EXECUTION_ID, taskId: 'task-1', iteration: 0, taskTitle: 'Task' }))
      .rejects.toThrow(new NotFoundException('Flow not found'));
  });

  describe('replaceBaselineFromExecution', () => {
    it('replaces the active baseline with one pointing at the selected run', async () => {
      const { service, executionRepository, baselineRepository } = createService();

      const baseline = await service.replaceBaselineFromExecution(FLOW_ID, 'task-1', 1, EXECUTION_ID, 'user-1');

      // Mongo looked the run up by a field no document has, so this always answered 404; it now finds the run.
      expect(executionRepository.findById).toHaveBeenCalledWith(EXECUTION_ID);
      expect(baselineRepository.replaceActive).toHaveBeenCalledWith({
        flowId: FLOW_ID,
        taskId: 'task-1',
        iteration: 1,
        sourceExecutionId: EXECUTION_ID,
        sourceMode: 'selected_execution',
        createdByUserId: 'user-1',
      });
      expect(baseline).toMatchObject({ id: 'baseline-2', replacedAt: null });
    });

    it('throws when the run does not exist, without touching the baselines', async () => {
      const { service, executionRepository, baselineRepository } = createService();
      executionRepository.findById.mockResolvedValue(null);

      await expect(service.replaceBaselineFromExecution(FLOW_ID, 'task-1', 0, EXECUTION_ID, 'user-1')).rejects.toThrow(new NotFoundException('Execution not found'));
      expect(baselineRepository.replaceActive).not.toHaveBeenCalled();
    });

    it('throws when the flow does not exist', async () => {
      const { service, baselineRepository } = createService();
      baselineRepository.replaceActive.mockResolvedValue(null);

      await expect(service.replaceBaselineFromExecution(FLOW_ID, 'task-1', 0, EXECUTION_ID, 'user-1')).rejects.toThrow(new NotFoundException('Flow not found'));
    });

    it('builds the baseline from the current evaluation run the same way', async () => {
      const { service, baselineRepository } = createService();

      await service.replaceBaselineFromCurrentEvaluationExecution(FLOW_ID, 'task-1', 0, EXECUTION_ID, 'evaluation-1', 'user-1');

      expect(baselineRepository.replaceActive).toHaveBeenCalledWith(expect.objectContaining({ sourceExecutionId: EXECUTION_ID, sourceMode: 'selected_execution' }));
    });
  });
});
