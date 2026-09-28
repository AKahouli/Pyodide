import { createExecutionServiceForTests, createNoopGraphSanitizer } from './playbook-flow-execution.test-support';

describe('runFromStep', () => {
  it('queues replay execution with the immutable source snapshot', async () => {
    const sourceExecution = {
      id: 'exec-source',
      flowId: 'flow-1',
      ownerId: 'owner-1',
      status: 'completed',
      inputContext: {
        ticketId: '42',
        __playbook_resume: { decision: 'approved' },
        __playbook_hitl_memory: [{ id: 'runtime-only' }],
      },
      snapshot: {
        settings: { recursionLimit: 10, maxParallelism: 2 },
        nodes: [
          { id: 'task-1', kind: 'step', input: { raw: 'old task 1' }, metadata: {} },
          { id: 'task-2', kind: 'step', input: { raw: 'old task 2' }, metadata: {} },
          { id: 'task-3', kind: 'step', input: { raw: 'old task 3' }, metadata: {} },
        ],
        controlEdges: [
          { id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' },
          { id: 'edge-2', kind: 'sequential', source: 'task-2', target: 'task-3' },
        ],
        dataBindings: [],
      },
    };

    const { service, queueService, executionRepository } = createExecutionServiceForTests({
      executionRepository: {
        findById: jest.fn().mockResolvedValue(sourceExecution),
        insert: jest.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'exec-replay-latest', queuePosition: 0, pendingApproval: null })),
      },
      queueService: {
        admit: jest.fn().mockResolvedValue(1),
        release: jest.fn(),
        refreshPositions: jest.fn().mockResolvedValue([]),
      },
      flowService: {
        findOneForExecutionStart: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'task-1', kind: 'step', input: { raw: 'old task 1' }, metadata: {} },
            { id: 'task-2', kind: 'step', input: { raw: 'new task 2' }, metadata: {} },
            { id: 'task-3', kind: 'step', input: { raw: 'new task 3' }, metadata: {} },
          ],
          controlEdges: [
            { id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' },
            { id: 'edge-2', kind: 'sequential', source: 'task-2', target: 'task-3' },
          ],
          dataBindings: [],
          settings: { recursionLimit: 25, maxParallelism: 5 },
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: { recursionLimit: 25, maxParallelism: 5 },
          nodes: [
            { id: 'task-1', kind: 'step', input: { raw: 'old task 1' }, metadata: {} },
            { id: 'task-2', kind: 'step', input: { raw: 'new task 2' }, metadata: {} },
            { id: 'task-3', kind: 'step', input: { raw: 'new task 3' }, metadata: {} },
          ],
          controlEdges: [
            { id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' },
            { id: 'edge-2', kind: 'sequential', source: 'task-2', target: 'task-3' },
          ],
          dataBindings: [],
        }),
      },
      graphSanitizerService: createNoopGraphSanitizer(),
      executionDispatcherService: { schedule: jest.fn() },
    });
    const response = await service.runFromStep('exec-source', 'owner-1', { taskId: 'task-2' });

    expect(executionRepository.findById).toHaveBeenCalledWith('exec-source', { withSnapshot: true });
    expect(executionRepository.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      flowId: 'flow-1',
      inputContext: { ticketId: '42' },
      recursionLimit: 10,
      maxParallelism: 2,
      snapshot: expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'task-2', input: { raw: 'old task 2' } }),
          expect.objectContaining({ id: 'task-3', input: { raw: 'old task 3' } }),
        ]),
      }),
      replaySource: {
        executionId: 'exec-source',
        taskId: 'task-2',
        iteration: 0,
      },
    }));
    expect((queueService as any).admit).toHaveBeenCalledWith('owner-1', 'exec-replay-latest', 10, 50);
    expect(response).toMatchObject({ id: 'exec-replay-latest', status: 'queued', replaySource: { executionId: 'exec-source', taskId: 'task-2', iteration: 0 } });
  });

  it('rejects when the target step does not exist in the source snapshot', async () => {
    const sourceExecution = {
      id: 'exec-source',
      flowId: 'flow-1',
      ownerId: 'owner-1',
      status: 'completed',
      inputContext: {},
      snapshot: {
        settings: { recursionLimit: 10, maxParallelism: 2 },
        nodes: [
          { id: 'task-1', kind: 'step', input: { raw: 'old task 1' }, metadata: {} },
        ],
        controlEdges: [],
        dataBindings: [],
      },
    };

    const { service, executionRepository } = createExecutionServiceForTests({
      executionRepository: { findById: jest.fn().mockResolvedValue(sourceExecution) },
      flowService: {
        findOneForExecutionStart: jest.fn().mockResolvedValue({
          nodes: [{ id: 'task-3', kind: 'step', input: { raw: 'new task 3' }, metadata: {} }],
          controlEdges: [],
          dataBindings: [],
          settings: { recursionLimit: 25, maxParallelism: 5 },
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: { recursionLimit: 25, maxParallelism: 5 },
          nodes: [{ id: 'task-3', kind: 'step', input: { raw: 'new task 3' }, metadata: {} }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
      graphSanitizerService: createNoopGraphSanitizer(),
      executionDispatcherService: { schedule: jest.fn() },
    });
    await expect(service.runFromStep('exec-source', 'owner-1', { taskId: 'task-2' })).rejects.toThrow(
      'Target must be a top-level step node',
    );
    expect(executionRepository.insert).not.toHaveBeenCalled();
  });
});
