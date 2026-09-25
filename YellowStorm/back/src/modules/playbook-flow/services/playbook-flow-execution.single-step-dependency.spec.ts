import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { PlaybookExecutionSingleStepPrepService } from '../execution/runtime/playbook-execution-single-step-prep.service';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { createExecutionServiceForTests, createNoopGraphSanitizer } from './playbook-flow-execution.test-support';

describe('single-step execution dependency safety', () => {
  it('rejects dependent single-step execution when upstream results are missing', async () => {
    const savedExecution = {
      id: 'exec-missing-upstream',
      save: jest.fn(),
      toJSON: jest.fn(),
    };
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    const service = createExecutionServiceForTests({
      executionModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                lean: jest.fn().mockReturnValue({
                  exec: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      },
      flowService: {
        findOneForExecutionStart: jest.fn().mockResolvedValue({
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
      },
      builderService: {
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
      },
      graphSanitizerService: createNoopGraphSanitizer(),
    }).service;

    await expect(service.start('flow-1', 'owner-1', {}, undefined, 'task-2')).rejects.toThrow(
      'Single-step execution for node task-2 requires a previous completed or failed execution with matching upstream node snapshots.',
    );
    expect(ExecutionModel).not.toHaveBeenCalled();
  });

  it('rejects single-step execution for router-controlled nodes', async () => {
    const { service } = createExecutionServiceForTests({
      flowService: {
        findOneForExecutionStart: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'router-1', kind: 'router', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'conditional', source: 'router-1', target: 'task-2', routerLabel: 'valid' }],
          dataBindings: [],
          settings: {},
        }),
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'router-1', kind: 'router', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'conditional', source: 'router-1', target: 'task-2', routerLabel: 'valid' }],
          dataBindings: [],
          settings: {},
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'router-1', kind: 'router', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'conditional', source: 'router-1', target: 'task-2', routerLabel: 'valid' }],
          dataBindings: [],
        }),
      },
      graphSanitizerService: createNoopGraphSanitizer(),
    });

    await expect(service.start('flow-1', 'owner-1', {}, undefined, 'task-2')).rejects.toThrow(
      'Single-step execution only supports nodes reached by sequential step dependencies.',
    );
  });

  it('rejects dependent single-step execution when the upstream snapshot no longer matches', async () => {
    const savedExecution = {
      id: 'exec-mismatch',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-mismatch' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      {
        updateOne: jest.fn(),
        deleteMany: jest.fn(),
        find: jest.fn(() => ({
          sort: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
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
            { id: 'task-1', kind: 'step', metadata: { version: 2 }, output: { ports: [{ id: 'summary' }] } },
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
      } as any,
      {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'task-1', kind: 'step', metadata: { version: 2 }, output: { ports: [{ id: 'summary' }] } },
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
                    { id: 'task-1', kind: 'step', metadata: { version: 1 }, output: { ports: [{ id: 'summary' }] } },
                    { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
                  ],
                },
              }]),
            }),
          }),
        }),
      }),
    });

    await expect(service.start('flow-1', 'owner-1', {}, undefined, 'task-2')).rejects.toThrow(
      'Single-step execution for node task-2 requires a previous completed or failed execution with matching upstream node snapshots.',
    );
  });
});
