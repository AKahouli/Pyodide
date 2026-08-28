import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { PlaybookExecutionSingleStepPrepService } from '../execution/runtime/playbook-execution-single-step-prep.service';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { createExecutionServiceForTests, createNoopGraphSanitizer } from './playbook-flow-execution.test-support';

describe('single-step execution allowed paths', () => {
  it('allows single-step execution for flow-dependent nodes when upstream results exist', async () => {
    const savedExecution = {
      id: 'exec-dependent',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-dependent' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn();
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      {
        updateOne: jest.fn(),
        deleteMany: jest.fn(),
        find: jest.fn(() => ({
          sort: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  taskId: 'task-1',
                  iteration: 0,
                  output: {
                    outputs: {
                      summary: { content: 'seeded summary' },
                    },
                  },
                  displayText: 'seeded summary',
                  outputs: {
                    summary: { content: 'seeded summary' },
                  },
                  artifacts: [{ port_id: 'summary', artifact_kind: 'text', content: 'seeded summary' }],
                  components: [],
                  traceMetadata: {},
                },
              ]),
            }),
          }),
        })),
      } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
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
            iteration: 'current',
          }],
          settings: {},
        }),
        findById: jest.fn(),
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
            iteration: 'current',
          }],
        }),
      } as any,
      { validate: jest.fn() } as any,
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
      (service as any).executionModel,
      (service as any).taskResultModel,
    );

    (service as any).executionModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([{
                _id: 'prev-exec-1',
                snapshot: {
                  nodes: [
                    { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
                    { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
                  ],
                },
              }]),
            }),
          }),
        }),
      }),
    });
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1', {}, undefined, 'task-2');

    expect(ExecutionModel).toHaveBeenCalledWith(expect.objectContaining({
      singleStepTaskId: 'task-2',
      snapshot: expect.objectContaining({
        nodes: [{ id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } }],
        controlEdges: [],
        dataBindings: [{
          id: 'binding-1',
          targetNode: 'task-2',
          targetPort: 'summary',
          sourceKind: 'node-output',
          sourceNode: 'task-1',
          sourcePort: 'summary',
          iteration: 'current',
        }],
      }),
      seededTaskOutputs: [{
        nodeId: 'task-1',
        iteration: 0,
        payload: expect.objectContaining({
          output: expect.any(String),
          displayText: 'seeded summary',
          outputs: {
            summary: { content: 'seeded summary' },
          },
          artifacts: [{ port_id: 'summary', artifact_kind: 'text', content: 'seeded summary' }],
        }),
      }],
    }));
  });

  it('allows single-step execution for standalone step nodes', async () => {
    const savedExecution = {
      id: 'exec-standalone',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-standalone' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn();

    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'input-data', required: true }] } },
          ],
          controlEdges: [],
          dataBindings: [],
          settings: {},
        }),
      } as any,
      {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'task-1', kind: 'step' },
            { id: 'task-2', kind: 'step', input: { ports: [{ id: 'input-data', required: true }] } },
          ],
          controlEdges: [],
          dataBindings: [],
        }),
      } as any,
      { validate: jest.fn() } as any,
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
      (service as any).executionModel,
      (service as any).taskResultModel,
    );
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1', {}, undefined, 'task-1');

    expect(ExecutionModel).toHaveBeenCalledWith(expect.objectContaining({
      singleStepTaskId: 'task-1',
      snapshot: expect.objectContaining({
        nodes: [{ id: 'task-1', kind: 'step' }],
        controlEdges: [],
        dataBindings: [],
      }),
    }));
    expect((service as any).validatorService.validate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      { requiredBindingNodeIds: ['task-1'] },
    );
  });
});
