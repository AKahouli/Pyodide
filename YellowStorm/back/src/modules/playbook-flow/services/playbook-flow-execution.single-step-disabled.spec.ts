import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { PlaybookExecutionSingleStepPrepService } from '../execution/runtime/playbook-execution-single-step-prep.service';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import {
  createExecutionRepositoryMock,
  createExecutionServiceForTests,
  createNoopGraphSanitizer,
  createTaskResultRepositoryMock,
} from './playbook-flow-execution.test-support';

describe('single-step execution disabled-node safety', () => {
  it('drops disabled nodes from full workflow execution snapshots', async () => {
    const executionRepository = createExecutionRepositoryMock();
    const taskResultRepository = createTaskResultRepositoryMock();
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

    await service.start('flow-1', 'owner-1', {});

    expect(executionRepository.insert.mock.calls[0][0].snapshot).toEqual({
      settings: {},
      nodes: [{ id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'output' }] } }],
      controlEdges: [],
      dataBindings: [],
    });
  });

  it('does not promote a disabled branch into a new entrypoint', () => {
    const prep = new PlaybookExecutionSingleStepPrepService({} as any, {} as any);
    const snapshot = {
      nodes: [
        { id: 'collect', kind: 'step', metadata: { enabled: false } },
        { id: 'iterate', kind: 'iterator', metadata: {} },
        { id: 'extract', kind: 'step', metadata: { containerConfig: { parentIteratorId: 'iterate' } } },
        { id: 'classify', kind: 'step', metadata: { containerConfig: { parentIteratorId: 'iterate' } } },
        { id: 'aggregate', kind: 'step', metadata: {} },
        { id: 'report', kind: 'step', metadata: {} },
        { id: 'copy', kind: 'step', metadata: {} },
      ],
      controlEdges: [
        { id: 'e1', kind: 'sequential', source: 'collect', target: 'iterate' },
        { id: 'e2', kind: 'sequential', source: 'iterate', target: 'aggregate' },
        { id: 'e3', kind: 'sequential', source: 'aggregate', target: 'report' },
        { id: 'e4', kind: 'sequential', source: 'extract', target: 'classify' },
      ],
      dataBindings: [{
        id: 'b1', targetNode: 'iterate', targetPort: 'items',
        sourceKind: 'node-output', sourceNode: 'collect', sourcePort: 'files',
      }],
      settings: {},
    } as any;

    expect(prep.buildExecutableSnapshot(snapshot, 'flow-1')).toEqual({
      ...snapshot,
      nodes: [snapshot.nodes[6]],
      controlEdges: [],
      dataBindings: [],
    });
  });

  it('retains iterator children when their parent is reachable', () => {
    const prep = new PlaybookExecutionSingleStepPrepService({} as any, {} as any);
    const snapshot = {
      nodes: [
        { id: 'collect', kind: 'step', metadata: {} },
        { id: 'iterate', kind: 'iterator', metadata: {} },
        { id: 'extract', kind: 'step', metadata: { containerConfig: { parentIteratorId: 'iterate' } } },
        { id: 'classify', kind: 'step', metadata: { containerConfig: { parentIteratorId: 'iterate' } } },
        { id: 'unrelated', kind: 'step', metadata: { enabled: false } },
      ],
      controlEdges: [
        { id: 'e1', kind: 'sequential', source: 'collect', target: 'iterate' },
        { id: 'e2', kind: 'sequential', source: 'extract', target: 'classify' },
      ],
      dataBindings: [], settings: {},
    } as any;

    const executable = prep.buildExecutableSnapshot(snapshot, 'flow-1');
    expect(executable.nodes.map((node: { id: string }) => node.id)).toEqual([
      'collect', 'iterate', 'extract', 'classify',
    ]);
    expect(executable.controlEdges).toEqual(snapshot.controlEdges);
  });

  it('rejects a playbook with no runnable branch and releases its idempotency key', async () => {
    const snapshot = {
      nodes: [
        { id: 'collect', kind: 'step', metadata: { enabled: false } },
        { id: 'iterate', kind: 'iterator', metadata: {} },
      ],
      controlEdges: [{ id: 'edge', kind: 'sequential', source: 'collect', target: 'iterate' }],
      dataBindings: [],
      settings: {},
    };
    const { service, idempotencyService } = createExecutionServiceForTests({
      flowService: { findOneForExecutionStart: jest.fn().mockResolvedValue(snapshot) },
      builderService: { buildSnapshot: jest.fn().mockReturnValue(snapshot) },
      graphSanitizerService: createNoopGraphSanitizer(),
    });
    idempotencyService.reserve.mockResolvedValue({ type: 'reserved' });

    await expect(service.start('flow-1', 'owner-1', {}, 'request-1')).rejects.toThrow(
      'No runnable steps remain after disabled branches are excluded.',
    );
    expect(idempotencyService.release).toHaveBeenCalledWith('owner-1', 'request-1');
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
