import { BadRequestException } from '@modules/exceptions';
import { PlaybookExecutionSingleStepPrepService } from './playbook-execution-single-step-prep.service';

const FLOW_ID = '64b000000000000000000002';
const OWNER_ID = '64b000000000000000000003';

const upstream = { id: 'task-1', kind: 'step', metadata: { positionX: 10 }, output: { ports: [{ id: 'summary' }] } };
const target = { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } };
const binding = (iteration: 'current' | 'previous' = 'current') => ({
  id: 'binding-1', targetNode: 'task-2', targetPort: 'summary', sourceKind: 'node-output', sourceNode: 'task-1', sourcePort: 'summary', iteration,
});

function createService() {
  const executionRepository = { listRecentCompletedWithSnapshot: jest.fn().mockResolvedValue([]) };
  const taskResultRepository = { listForExecution: jest.fn().mockResolvedValue([]) };
  const service = new PlaybookExecutionSingleStepPrepService(executionRepository as never, taskResultRepository as never);
  return { service, executionRepository, taskResultRepository };
}

describe('PlaybookExecutionSingleStepPrepService seeding', () => {
  const snapshot = { nodes: [upstream, target], controlEdges: [], dataBindings: [] } as never;

  it('seeds from the latest finished run whose upstream nodes match, reading its completed results newest first', async () => {
    const { service, executionRepository, taskResultRepository } = createService();
    executionRepository.listRecentCompletedWithSnapshot.mockResolvedValue([
      { id: 'exec-new', snapshot: { nodes: [{ ...upstream, label: 'changed since' }, target] } },
      // Only the canvas position differs: still the same upstream node.
      { id: 'exec-old', snapshot: { nodes: [{ ...upstream, metadata: { positionX: 99 } }, target] } },
    ]);
    taskResultRepository.listForExecution.mockResolvedValue([
      { taskId: 'task-1', iteration: 2, output: 'latest', displayText: 'latest', outputs: { summary: { content: 'latest' } }, artifacts: null, toolTrace: [], usage: null, traceMetadata: {} },
      { taskId: 'task-1', iteration: 1, output: 'previous', displayText: 'previous', outputs: null, toolTrace: [], traceMetadata: {} },
    ]);

    const seeds = await service.buildSeededTaskOutputsForSingleStep(FLOW_ID, OWNER_ID, 'task-2', snapshot, [binding('previous')] as never);

    expect(executionRepository.listRecentCompletedWithSnapshot).toHaveBeenCalledWith(FLOW_ID, OWNER_ID, 20);
    expect(taskResultRepository.listForExecution).toHaveBeenCalledWith('exec-old', { taskIds: ['task-1'], statuses: ['completed'], order: 'latest' });
    expect(seeds).toEqual([
      { nodeId: 'task-1', iteration: 2, payload: { output: 'latest', displayText: 'latest', outputs: { summary: { content: 'latest' } }, toolTrace: [], traceMetadata: {} } },
      { nodeId: 'task-1', iteration: 1, payload: { output: 'previous', displayText: 'previous', toolTrace: [], traceMetadata: {} } },
    ]);
  });

  it('needs no previous run when nothing is bound to an upstream output', async () => {
    const { service, executionRepository } = createService();

    await expect(service.buildSeededTaskOutputsForSingleStep(FLOW_ID, OWNER_ID, 'task-2', snapshot, [])).resolves.toEqual([]);
    expect(executionRepository.listRecentCompletedWithSnapshot).not.toHaveBeenCalled();
  });

  it('refuses when no finished run matches the upstream nodes, or it lacks the needed results', async () => {
    const { service, executionRepository, taskResultRepository } = createService();
    await expect(service.buildSeededTaskOutputsForSingleStep(FLOW_ID, OWNER_ID, 'task-2', snapshot, [binding()] as never))
      .rejects.toBeInstanceOf(BadRequestException);

    executionRepository.listRecentCompletedWithSnapshot.mockResolvedValue([{ id: 'exec-1', snapshot: { nodes: [upstream, target] } }]);
    taskResultRepository.listForExecution.mockResolvedValue([{ taskId: 'task-1', iteration: 0, output: { value: 1 }, toolTrace: [], traceMetadata: {} }]);
    await expect(service.buildSeededTaskOutputsForSingleStep(FLOW_ID, OWNER_ID, 'task-2', snapshot, [binding('previous')] as never))
      .rejects.toThrow('requires completed upstream results for: task-1');

    const [seed] = await service.buildSeededTaskOutputsForSingleStep(FLOW_ID, OWNER_ID, 'task-2', snapshot, [binding()] as never);
    expect(seed.payload.output).toBe('{"value":1}');
  });
});
