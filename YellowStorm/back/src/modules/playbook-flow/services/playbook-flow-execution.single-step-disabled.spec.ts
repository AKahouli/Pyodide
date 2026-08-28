import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { PlaybookExecutionSingleStepPrepService } from '../execution/runtime/playbook-execution-single-step-prep.service';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { createExecutionServiceForTests, createNoopGraphSanitizer } from './playbook-flow-execution.test-support';

describe('single-step execution disabled-node safety', () => {
  it('drops disabled nodes from full workflow execution snapshots', async () => {
    const savedExecution = {
      id: 'exec-filtered',
      queuePosition: 0,
      snapshot: undefined,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-filtered' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(function ExecutionModel(this: Record<string, unknown>, payload: Record<string, unknown>) {
      Object.assign(this, savedExecution, payload);
      return this;
    }) as any;
    ExecutionModel.findByIdAndDelete = jest.fn();
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      { updateOne: jest.fn(), deleteMany: jest.fn(), find: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'output' }] } },
            { id: 'task-2', kind: 'step', metadata: { enabled: false }, input: { ports: [{ id: 'input' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'input',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'output',
          }],
          settings: {},
        }),
      } as any,
      {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'output' }] } },
            { id: 'task-2', kind: 'step', metadata: { enabled: false }, input: { ports: [{ id: 'input' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'input',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'output',
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
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1', {});

    expect(ExecutionModel.mock.calls[0][0].snapshot).toEqual({
      settings: {},
      nodes: [{ id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'output' }] } }],
      controlEdges: [],
      dataBindings: [],
    });
  });

  it('rejects single-step execution for disabled nodes', async () => {
    const { service } = createExecutionServiceForTests({
      flowService: {
        findOneForExecutionStart: jest.fn().mockResolvedValue({
          nodes: [{ id: 'task-2', kind: 'step', metadata: { enabled: false } }],
          controlEdges: [],
          dataBindings: [],
          settings: {},
        }),
        findOne: jest.fn().mockResolvedValue({
          nodes: [{ id: 'task-2', kind: 'step', metadata: { enabled: false } }],
          controlEdges: [],
          dataBindings: [],
          settings: {},
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [{ id: 'task-2', kind: 'step', metadata: { enabled: false } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
      graphSanitizerService: createNoopGraphSanitizer(),
    });

    await expect(service.start('flow-1', 'owner-1', {}, undefined, 'task-2')).rejects.toThrow(
      'Single-step target node task-2 is disabled',
    );
  });
});
