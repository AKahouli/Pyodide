import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { PlaybookExecutionSingleStepPrepService } from '../execution/runtime/playbook-execution-single-step-prep.service';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { createExecutionRepositoryMock, createTaskResultRepositoryMock } from './playbook-flow-execution.test-support';

describe('single-step execution upstream seeding', () => {
  it('seeds both current and previous upstream iterations when needed', async () => {
    const executionRepository = createExecutionRepositoryMock({
      listRecentCompletedWithSnapshot: jest.fn().mockResolvedValue([{
        id: 'prev-exec-1',
        snapshot: {
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
        },
      }]),
    });
    const taskResultRepository = createTaskResultRepositoryMock({
      listForExecution: jest.fn().mockResolvedValue([
        {
          taskId: 'task-1',
          iteration: 2,
          output: 'latest',
          displayText: 'latest',
          outputs: { summary: { content: 'latest' } },
        },
        {
          taskId: 'task-1',
          iteration: 1,
          output: 'previous',
          displayText: 'previous',
          outputs: { summary: { content: 'previous' } },
        },
      ]),
    });
    const service = new PlaybookFlowExecutionService(
      executionRepository as any,
      taskResultRepository as any,
      { create: jest.fn(), listForExecution: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'previous',
          }],
          settings: {},
        }),
      } as any,
      {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'previous',
          }],
        }),
      } as any,
      { validate: jest.fn(), collectValidationErrors: jest.fn().mockReturnValue([]) } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );

    (service as any).singleStepPrepService = new PlaybookExecutionSingleStepPrepService(
      executionRepository as any,
      taskResultRepository as any,
    );
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1', {}, undefined, 'task-2');

    expect(executionRepository.listRecentCompletedWithSnapshot).toHaveBeenCalledWith('flow-1', 'owner-1', 20);
    expect(taskResultRepository.listForExecution).toHaveBeenCalledWith('prev-exec-1', {
      taskIds: ['task-1'],
      statuses: ['completed'],
      order: 'latest',
    });
    expect(executionRepository.insert).toHaveBeenCalledWith(expect.objectContaining({
      seededTaskOutputs: [
        expect.objectContaining({ nodeId: 'task-1', iteration: 2 }),
        expect.objectContaining({ nodeId: 'task-1', iteration: 1 }),
      ],
    }));
  });
});
