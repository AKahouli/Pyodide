import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';

import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';

import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('PlaybookFlowExecutionService start preflight', () => {
  it('uses the base execution-start read instead of the enriched read path', async () => {
    const savedExecution = {
      id: 'exec-new',
      queuePosition: 0,
      save: jest.fn(),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-new' }),
    };
    savedExecution.save.mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn();
    const flowService = {
      findOneForExecutionStart: jest.fn().mockResolvedValue({
        id: 'flow-1',
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        settings: {},
      }),
      findOne: jest.fn(),
      findById: jest.fn(),
    };
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn().mockResolvedValue(0), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      flowService as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) } as any,
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
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1');

    expect(flowService.findOneForExecutionStart).toHaveBeenCalledWith('flow-1', 'owner-1');
    expect(flowService.findOne).not.toHaveBeenCalled();
  });
});



describe('PlaybookFlowExecutionService lifecycle handling', () => {
  it('does not claim queued work when gRPC is unavailable', async () => {
    const { service, queueService } = createExecutionServiceForTests();
    (service as any).isGrpcAvailable = false;

    await (service as any).drainQueue('owner-1');

    expect(queueService.release).not.toHaveBeenCalled();
  });

  it('fails a claimed execution when its flow cannot be loaded', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
        }),
      })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    };
    const queueService = {
      release: jest.fn()
        .mockResolvedValueOnce({ id: 'exec-missing', flowId: 'flow-missing', inputContext: {} })
        .mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([]),
    };
    const flowService = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    await (service as any).drainQueue('owner-1');

    expect(executionModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'exec-missing',
      expect.objectContaining({ status: 'failed', error: 'Flow not found before runtime start' }),
    );
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith(
      'exec-missing',
      'failed',
      'Flow not found before runtime start',
    );
  });

  it('ignores late approval requests after a terminal state already won', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel });

    await (service as any).handleRunEvent('exec-2', {
      event_type: 'ApprovalRequested',
      node_id: 'approval-1',
      iteration: 0,
      payload: { prompt: 'Approve?' },
    });

    expect(streamEvents.emitInterrupt).not.toHaveBeenCalled();
  });

  it('ignores late reserved router labels after a terminal state already won', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel });

    await (service as any).handleRunEvent('exec-3', {
      event_type: 'RouterDecision',
      node_id: 'router-2',
      iteration: 0,
      payload: { label: '__error__' },
    });

    expect(streamEvents.emitExecutionComplete).not.toHaveBeenCalled();
  });

  it('rejects modelIdOverride for inactive or invalid models after reserving idempotency and releases the reservation', async () => {
    const modelsService = {
      validateModelActive: jest.fn().mockResolvedValue({ valid: false, model: null, inactive: true }),
    };
    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      release: jest.fn().mockResolvedValue(undefined),
      confirmLink: jest.fn(),
    };

    const service = new PlaybookFlowExecutionService(
      {} as any,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
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
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      modelsService as any,
    );

    await expect(
      service.start('flow-1', 'owner-1', {}, 'idem-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'inactive-model-id'),
    ).rejects.toThrow('Model override');

    expect(idempotencyService.reserve).toHaveBeenCalledWith('owner-1', 'idem-1', expect.any(Object));
    expect(modelsService.validateModelActive).toHaveBeenCalledWith('inactive-model-id');
    expect(idempotencyService.release).toHaveBeenCalledWith('owner-1', 'idem-1');
  });

  it('rolls back a saved execution when idempotency linking fails', async () => {
    const savedExecution = {
      id: 'exec-rollback',
      save: jest.fn().mockResolvedValue({
        id: 'exec-rollback',
        queuePosition: 1,
        toJSON: jest.fn().mockReturnValue({ id: 'exec-rollback' }),
      }),
    };
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) }));

    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      confirmLink: jest.fn().mockRejectedValue(new Error('link failed')),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
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
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );

    await expect(service.start('flow-1', 'owner-1', {}, 'idem-1')).rejects.toThrow('link failed');
    expect(ExecutionModel.findByIdAndDelete).toHaveBeenCalledWith('exec-rollback');
    expect(idempotencyService.release).toHaveBeenCalledWith('owner-1', 'idem-1');
  });

  it('returns the existing execution for a duplicate idempotency key', async () => {
    const existingExecution = {
      id: 'exec-existing',
      ownerId: 'owner-1',
      toJSON: jest.fn().mockReturnValue({ id: 'exec-existing', status: 'queued' }),
    };
    const executionModel = {
      findById: jest.fn().mockResolvedValue(existingExecution),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ executionModel });
    idempotencyService.reserve.mockResolvedValue({ type: 'duplicate', executionId: 'exec-existing' });

    const result = await service.start('flow-1', 'owner-1', { brief: 'same' }, 'idem-1');

    expect(result).toEqual({ id: 'exec-existing', status: 'queued' });
    expect(executionModel.findById).toHaveBeenCalledWith('exec-existing');
  });

  it('returns the existing execution for a duplicate idempotency key before validating model override', async () => {
    const existingExecution = {
      id: 'exec-existing',
      ownerId: 'owner-1',
      toJSON: jest.fn().mockReturnValue({ id: 'exec-existing', status: 'queued' }),
    };
    const executionModel = {
      findById: jest.fn().mockResolvedValue(existingExecution),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ executionModel });
    idempotencyService.reserve.mockResolvedValue({ type: 'duplicate', executionId: 'exec-existing' });
    (service as any).modelsService = {
      validateModelActive: jest.fn().mockResolvedValue({ valid: false, model: null, inactive: true }),
    };

    const result = await service.start('flow-1', 'owner-1', { brief: 'same' }, 'idem-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'inactive-model-id');

    expect(result).toEqual({ id: 'exec-existing', status: 'queued' });
    expect((service as any).modelsService.validateModelActive).not.toHaveBeenCalled();
  });

  it('releases the idempotency reservation when model validation throws after reservation', async () => {
    const modelsService = {
      validateModelActive: jest.fn().mockRejectedValue(new Error('model lookup failed')),
    };
    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      release: jest.fn().mockResolvedValue(undefined),
      confirmLink: jest.fn(),
    };

    const service = new PlaybookFlowExecutionService(
      {} as any,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
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
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn(), findLatestReportForExecutionTask: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      modelsService as any,
    );

    await expect(
      service.start('flow-1', 'owner-1', {}, 'idem-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'unstable-model-id'),
    ).rejects.toThrow('model lookup failed');

    expect(idempotencyService.reserve).toHaveBeenCalledWith('owner-1', 'idem-1', expect.any(Object));
    expect(idempotencyService.release).toHaveBeenCalledWith('owner-1', 'idem-1');
  });

  it('uses the model override in replay eligibility fingerprints', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null),
    };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('APPLY_REPLAY') };
    const replayEligibilityService = {
      evaluateReplayEligibility: jest.fn().mockReturnValue({
        applied: true,
        confidenceScore: 100,
        confidenceFactors: {},
        invalidationReasons: [],
        appliedSections: ['tool_policy'],
        skippedSections: [],
      }),
    };
    const replayBaselineService = {
      buildCurrentReplayFingerprints: jest.fn().mockReturnValue({ nodeSnapshotHash: 'node-a' }),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: { agent_model: 'baseline-model' } }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_strict',
          referenceOutput: null,
          outputFormatGuide: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { nodeSnapshotHash: 'node-a' },
          behaviorBaseline: null,
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
        findById: jest.fn(() => ({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: { 'step-1': 'replay_strict' }, modelIdOverride: 'override-model' }),
          }),
        })),
        findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      },
      replayPromptService,
      replayBaselineService,
      replayEligibilityService,
      replayReportService,
    });
    const run = jest.fn();
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(replayBaselineService.buildCurrentReplayFingerprints).toHaveBeenCalledWith(expect.objectContaining({
      nodeSnapshot: expect.objectContaining({
        modelId: 'override-model',
        metadata: expect.objectContaining({ agent_model: 'override-model' }),
      }),
      flowSnapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          modelId: 'override-model',
          metadata: {},
        })],
      }),
    }));
  });

  it('ignores runtime agent enrichment when building replay_flex fingerprints', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null),
    };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('APPLY_REPLAY') };
    const replayEligibilityService = {
      evaluateReplayEligibility: jest.fn().mockReturnValue({
        applied: true,
        confidenceScore: 100,
        confidenceFactors: {
          nodeSnapshotHash: 30,
          modelConfigHash: 20,
          flowSnapshotHash: 5,
          toolConfigHash: 20,
          outputContractHash: 15,
          inputContextHash: 10,
        },
        invalidationReasons: [],
        appliedSections: ['decision_invariants', 'tool_policy'],
        skippedSections: [],
      }),
    };
    const replayBaselineService = {
      buildCurrentReplayFingerprints: jest.fn().mockReturnValue({
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-runtime',
        nodeSnapshotHash: 'node-runtime',
        agentConfigHash: null,
        modelConfigHash: 'model-runtime',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-a',
      }),
    };
    const snapshot = {
      settings: {},
      nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
      controlEdges: [],
      dataBindings: [],
    };
    const { service, agentService, replayPromptService: replayPromptSpy, replayBaselineService: replayBaselineSpy, replayReportService: replayReportSpy } = createExecutionServiceForTests({
      flowService: {
        findOne: jest.fn().mockResolvedValue({
          settings: {},
          nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue(snapshot),
      },
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_flex',
          isStale: false,
          staleReasons: [],
          referenceOutput: null,
          outputFormatGuide: null,
          intentKey: null,
          intentLabel: null,
          reasoningOutline: [],
          stableReasoningRules: [],
          contextVariableSchema: [],
          toolTraceTemplate: [],
          semanticChecklist: [],
          driftPolicy: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: {
            inputContextHash: 'input-a',
            flowSnapshotHash: 'flow-baseline',
            nodeSnapshotHash: 'node-baseline',
            agentConfigHash: null,
            modelConfigHash: 'model-baseline',
            toolConfigHash: 'tool-a',
            outputContractHash: 'contract-a',
          },
          behaviorBaseline: null,
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
        findById: jest.fn(() => ({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ executionMode: 'replay_flex', stepExecutionModes: { 'step-1': 'replay_flex' }, modelIdOverride: null }),
          }),
        })),
        findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      },
      replayPromptService,
      replayBaselineService,
      replayEligibilityService,
      replayReportService,
    });
    const run = jest.fn();
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([{ id: 'agent-1', name: 'Agent 1', chatbot: { model: 'runtime-model' } }]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {});

    expect(replayBaselineSpy.buildCurrentReplayFingerprints).toHaveBeenCalledWith(expect.objectContaining({
      nodeSnapshot: expect.objectContaining({
        metadata: expect.objectContaining({ assignedAgentId: 'agent-1' }),
      }),
      flowSnapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: expect.objectContaining({ assignedAgentId: 'agent-1' }),
        })],
      }),
    }));
    expect(replayReportSpy.createPreRunReport).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'replay_flex',
      eligibility: expect.objectContaining({
        applied: true,
        invalidationReasons: [],
      }),
    }));
    expect(replayPromptSpy.buildReplayPromptSection).toHaveBeenCalled();
  });

  it('persists replay drift for queued node completions before a stream error clears tracking', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        replayId: 'replay-1',
        validationVersion: 2,
        applied: true,
      }),
    };
    const replayArtifactService = {
      resolveReplayArtifacts: jest.fn(async () => new Map([['step-1', {
        taskId: 'step-1',
        replayId: 'replay-1',
        flowId: 'flow-1',
        validationVersion: 2,
        mode: 'replay_strict',
        referenceOutput: null,
        outputFormatGuide: null,
        toolCalls: [],
        reasoningChain: [],
        fingerprints: null,
        behaviorBaseline: null,
        toolPolicy: {
          requiredTools: ['search'],
          forbiddenTools: [],
          sequencingRules: [],
          requireSameOrder: false,
        },
        outputContract: null,
        replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
      }]])),
    };
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      findById: jest.fn()
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: { 'step-1': 'replay_strict' } }),
          }),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', singleStepTaskId: null }),
          }),
        })
        .mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
          }),
        }),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, taskResultModel, agentService } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
      executionModel,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    const handlers: Record<string, (arg?: any) => void> = {};
    const runCall = {
      on: jest.fn((event: string, handler: (arg?: any) => void) => {
        handlers[event] = handler;
      }),
    };
    (service as any).playbookFlowClient = { Run: jest.fn().mockReturnValue(runCall) };
    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    handlers.data?.({
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        tool_trace: [{ call_index: 1, tool_name: 'search', args: {}, status: 'completed' }],
      },
    });
    handlers.error?.(new Error('stream failed'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      taskId: 'step-1',
      iteration: 0,
      replayArtifacts: expect.objectContaining({ replayId: 'replay-1' }),
      toolTrace: [expect.objectContaining({ callIndex: 1, toolName: 'search' })],
    }));
  });

  it('scopes idempotency reservations by flowId and inputContext', async () => {
    const savedExecution = {
      id: 'exec-new',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-new' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn();
    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      confirmLink: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) } as any,
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
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );
    idempotencyService.reserve.mockResolvedValue({ type: 'reserved' });
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-abc', 'owner-1', { brief: 'same' }, 'idem-1');

    expect(idempotencyService.reserve).toHaveBeenCalledWith('owner-1', 'idem-1', {
      flowId: 'flow-abc',
      inputContext: { brief: 'same' },
      executionMode: 'live',
      stepExecutionModes: {},
    });
  });

  it('drains the queue after a pre-stream startup failure without claiming and abandoning work', async () => {
    const { service, agentService } = createExecutionServiceForTests({
      flowService: { findOne: jest.fn().mockResolvedValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
    });
    const scheduleQueueDrainSpy = jest.spyOn(service as any, 'scheduleQueueDrain').mockImplementation(() => undefined);
    agentService.buildGrpcAgentsForPlaybook.mockRejectedValue(new Error('bootstrap failed'));

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    }, {});

    expect(scheduleQueueDrainSpy).toHaveBeenCalledWith('owner-1');
    scheduleQueueDrainSpy.mockRestore();
  });

  it('does not start gRPC when a claimed execution is cancelled before launch', async () => {
    const { service, agentService, executionModel, streamEvents } = createExecutionServiceForTests({
      flowService: { findOne: jest.fn().mockResolvedValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      builderService: { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
        findById: jest.fn(() => ({ lean: () => ({ exec: jest.fn().mockResolvedValue({ ownerId: 'owner-1', status: 'cancelled' }) }) })),
        findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      },
    });
    const mockRun = jest.fn();
    (service as any).playbookFlowClient = { Run: mockRun };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    }, {});

    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-1', status: 'running' },
      expect.objectContaining({ queuePosition: 0 }),
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(streamEvents.emitExecutionStart).not.toHaveBeenCalled();
  });

  it('includes step execution modes in the execution start SSE payload', async () => {
    const { service, streamEvents, agentService } = createExecutionServiceForTests({
      flowService: {
        findOne: jest.fn().mockResolvedValue({
          settings: {},
          nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({
                singleStepTaskId: null,
                executionMode: 'inherit',
                stepExecutionModes: { 'step-1': 'replay_flex' },
                modelIdOverride: null,
                replayPlanningByTask: null,
              }),
            }),
          })
          .mockReturnValueOnce({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({
                singleStepTaskId: null,
                advisorAutopilotEnabled: false,
                advisorAutopilotTargetScore: 90,
                advisorAutopilotMaxTurns: 4,
                reflectionEnabled: false,
                advisorScoringMode: 'llm',
                executionMode: 'inherit',
                stepExecutionModes: { 'step-1': 'replay_flex' },
                replayPlanningByTask: null,
              }),
            }),
          })
          .mockReturnValueOnce({
            lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }),
          }),
      },
    });
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([{ id: 'agent-1', name: 'Agent 1' }]);
    (service as any).playbookFlowClient = { Run: jest.fn(() => ({ on: jest.fn() })) };

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {
      settings: {},
      nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
      controlEdges: [],
      dataBindings: [],
    }, {});

    expect(streamEvents.emitExecutionStart).toHaveBeenCalledWith(
      'exec-1',
      'flow-1',
      'owner-1',
      expect.objectContaining({
        executionMode: 'inherit',
        stepExecutionModes: { 'step-1': 'replay_flex' },
      }),
    );
  });

  it('does not fail running executions during startup without ownership proof', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
      updateMany: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 3 }) })),
    };
    const { service } = createExecutionServiceForTests({ executionModel });
    (service as any).isGrpcAvailable = true;
    Object.defineProperty(service as any, 'executionModel', { value: executionModel });

    await (service as any).reconcileOrphanedExecutions();

    expect(executionModel.updateMany).not.toHaveBeenCalled();
  });

  it('recovers queued executions until all available concurrency slots are filled', async () => {
    let countDocsCallCount = 0;
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      distinct: jest.fn().mockResolvedValue(['owner-1']),
      countDocuments: jest.fn().mockImplementation(() => {
        countDocsCallCount++;
        return Promise.resolve(countDocsCallCount === 1 ? 3 : 0);
      }),
    };
    const queueService = {
      release: jest.fn()
        .mockResolvedValueOnce({ id: 'exec-1', flowId: 'flow-1', inputContext: {} })
        .mockResolvedValueOnce({ id: 'exec-2', flowId: 'flow-1', inputContext: {} })
        .mockResolvedValueOnce({ id: 'exec-3', flowId: 'flow-1', inputContext: {} })
        .mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([]),
      getRunningCount: jest.fn().mockResolvedValue(0),
    };
    const flowService = {
      findOne: jest.fn().mockResolvedValue({ settings: {} }),
    };
    const { service } = createExecutionServiceForTests({ executionModel, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    const scheduleQueueDrainSpy = jest.spyOn(service as any, 'scheduleQueueDrain').mockImplementation(() => undefined);

    await (service as any).recoverQueuedExecutions();

    expect(executionModel.distinct).toHaveBeenCalledWith('ownerId', { status: 'queued' });
    expect(scheduleQueueDrainSpy).toHaveBeenCalledWith('owner-1');
    scheduleQueueDrainSpy.mockRestore();
  });

  it('drainQueue continues draining after a flow-not-found failure', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
        }),
      })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    };
    const queueService = {
      release: jest.fn()
        .mockResolvedValueOnce({ id: 'exec-missing', flowId: 'flow-missing', inputContext: {} })
        .mockResolvedValueOnce({ id: 'exec-ok', flowId: 'flow-ok', inputContext: {} })
        .mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([]),
    };
    const flowService = {
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ settings: {} }),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    const callGrpcRunSpy = jest.spyOn(service as any, 'callGrpcRun').mockResolvedValue(undefined);

    await (service as any).drainQueue('owner-1');

    expect(executionModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'exec-missing',
      expect.objectContaining({ status: 'failed', error: 'Flow not found before runtime start' }),
    );
    expect(flowService.findOne).toHaveBeenCalledTimes(2);
    expect(callGrpcRunSpy).toHaveBeenCalledTimes(1);
    expect(callGrpcRunSpy).toHaveBeenCalledWith('exec-ok', 'flow-ok', 'owner-1', { settings: {} }, {}, undefined);
    callGrpcRunSpy.mockRestore();
  });

  it('re-queues a claimed execution when distributed capacity is exhausted', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    };
    const queueService = {
      release: jest.fn().mockResolvedValueOnce({ id: 'exec-1', flowId: 'flow-1', inputContext: {} }).mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([{ executionId: 'exec-1', queuePosition: 1 }]),
    };
    const { service, streamEvents, executionLeaseService } = createExecutionServiceForTests({
      executionModel,
      queueService,
      executionLeaseService: {
        isEnabled: jest.fn().mockReturnValue(true),
        acquire: jest.fn().mockResolvedValue({ acquired: false, reason: 'global_limit' }),
        release: jest.fn().mockResolvedValue(undefined),
      },
    });
    (service as any).isGrpcAvailable = true;

    await (service as any).drainQueue('owner-1');

    expect(executionLeaseService.acquire).toHaveBeenCalledWith('exec-1', 'owner-1', 'flow-1', {});
    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-1', status: 'running' },
      {
        $set: { status: 'queued', queuePosition: 0 },
        $unset: { startedAt: 1 },
      },
    );
    expect(streamEvents.emitQueuePositionUpdate).toHaveBeenCalledWith('exec-1', 1);
  });
});

describe('PlaybookFlowExecutionService lease release', () => {
  it('releases the distributed lease when an execution completes', async () => {
    const { service, executionLeaseService } = createExecutionServiceForTests({
      executionLeaseService: {
        isEnabled: jest.fn().mockReturnValue(true),
        release: jest.fn().mockResolvedValue(undefined),
      },
    });

    await (service as any).handleRunEvent('exec-1', { event_type: 'ExecutionCompleted', payload: {} });

    expect(executionLeaseService.release).toHaveBeenCalledWith('exec-1');
  });
});
