import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowReplayService } from './playbook-flow-replay.service';
import { FlowReplayValidationStatus } from '../schemas/playbook-flow-validated-replay.schema';

function createReplayServiceForTests(overrides?: {
  executionModel?: Record<string, any>;
  taskResultModel?: Record<string, any>;
  routerDecisionModel?: Record<string, any>;
  replayModel?: Record<string, any>;
  executionService?: Record<string, any>;
  replayBaselineService?: Record<string, any>;
  logger?: Record<string, any>;
}) {
  const executionModel = {
    findOne: jest.fn(),
    ...overrides?.executionModel,
  };
  const taskResultModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    ...overrides?.taskResultModel,
  };
  const routerDecisionModel = {
    find: jest.fn(),
    ...overrides?.routerDecisionModel,
  };
  const replayModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    deleteOne: jest.fn(),
    ...overrides?.replayModel,
  };
  const executionService = {
    start: jest.fn(),
    ...overrides?.executionService,
  };
  const replayBaselineService = {
    buildValidatedReplayBaseline: jest.fn().mockReturnValue({
      mode: 'replay_strict',
      fingerprints: { inputContextHash: 'hash-1' },
      behaviorBaseline: { decisionInvariants: ['Verify facts'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
      toolPolicy: { requiredTools: ['search'], forbiddenTools: [], sequencingRules: [], requireSameOrder: false },
      outputContract: { type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' },
      intentKey: 'task-review',
      intentLabel: 'Task review',
      reasoningOutline: [{ stageKey: 'analyze', stageType: 'analysis', label: 'Analyze', description: 'Inspect the request.', confidence: 0.9 }],
      stableReasoningRules: ['Preserve analyze.'],
      contextVariableSchema: [{ key: 'query', label: 'query', source: 'input_context', valueType: 'string', required: true, exampleValue: 'hello' }],
      toolTraceTemplate: [{ stepIndex: 1, toolName: 'search', purpose: 'Find evidence.', argumentShape: { query: 'string' }, required: true }],
      driftPolicy: {
        requireSameIntent: true,
        requireSameReasoningStages: true,
        requireSameToolOrder: true,
        allowAdditionalTools: false,
        allowArgumentValueChanges: true,
        enforceOutputContract: true,
      },
      acceptedExamples: [{ referenceExecutionId: 'exec-1', referenceExecutionNumber: 2, summary: 'Validated replay baseline for Task review.', outputPreview: 'original output' }],
      hitlMemorySnapshots: [],
    }),
    buildOutputContractFromReplay: jest.fn().mockReturnValue({ type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' }),
    buildOutputContractHash: jest.fn().mockReturnValue('contract-hash'),
    ...overrides?.replayBaselineService,
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    ...overrides?.logger,
  };

  const service = new PlaybookFlowReplayService(
    executionModel as any,
    taskResultModel as any,
    routerDecisionModel as any,
    replayModel as any,
    executionService as any,
    replayBaselineService as any,
    logger as any,
  );

  return {
    service,
    executionModel,
    taskResultModel,
    routerDecisionModel,
    replayModel,
    executionService,
    replayBaselineService,
    logger,
  };
}

function makeFindOneChain(value: unknown) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
  return chain;
}

function makeFindChain(value: unknown) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

describe('PlaybookFlowReplayService', () => {
  describe('traceReplay', () => {
    it('reconstructs a linear flow with 3 completed nodes', async () => {
      const { service, executionModel, taskResultModel, routerDecisionModel } = createReplayServiceForTests();

      const t1 = new Date('2026-01-01T00:00:00Z');
      const t2 = new Date('2026-01-01T00:01:00Z');
      const t3 = new Date('2026-01-01T00:02:00Z');
      const t4 = new Date('2026-01-01T00:03:00Z');
      const t5 = new Date('2026-01-01T00:04:00Z');
      const t6 = new Date('2026-01-01T00:05:00Z');
      const tEnd = new Date('2026-01-01T00:06:00Z');

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', status: 'completed', endedAt: tEnd,
      }));

      taskResultModel.find.mockReturnValue(makeFindChain([
        {
          taskId: 'step-1', iteration: 0, status: 'completed', startedAt: t1, endedAt: t2, output: 'hello',
          displayText: 'hello', toolTrace: [{ toolName: 'search' }], llmPromptTrace: [{ stage: 'initial_request' }],
          reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-4o-mini' },
          semanticMatch: { matchScore: 0.9 }, traceMetadata: { collected: true },
        },
        { taskId: 'step-2', iteration: 0, status: 'completed', startedAt: t3, endedAt: t4, output: 'world' },
        { taskId: 'step-3', iteration: 0, status: 'completed', startedAt: t5, endedAt: t6, output: 'done' },
      ]));

      routerDecisionModel.find.mockReturnValue(makeFindChain([]));

      const events = await service.traceReplay('exec-1', 'user-1');

      expect(events).toHaveLength(7);
      expect(events[0].type).toBe('NodeStarted');
      expect(events[0].data).toMatchObject({ taskId: 'step-1', iteration: 0 });
      expect(events[1].type).toBe('NodeCompleted');
      expect(events[1].data).toMatchObject({
        taskId: 'step-1',
        output: 'hello',
        displayText: 'hello',
        toolTrace: [{ toolName: 'search' }],
        reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
        llmPromptTrace: [{ stage: 'initial_request' }],
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        modelName: 'gpt-4o-mini',
        semanticMatch: { matchScore: 0.9 },
        traceMetadata: { collected: true },
      });
      expect(events[6].type).toBe('ExecutionCompleted');
    });

    it('includes router decision events sorted by timestamp', async () => {
      const { service, executionModel, taskResultModel, routerDecisionModel } = createReplayServiceForTests();

      const t1 = new Date('2026-01-01T00:01:00Z');
      const t2 = new Date('2026-01-01T00:02:00Z');
      const t3 = new Date('2026-01-01T00:03:00Z');

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-2', ownerId: 'user-1', status: 'completed', endedAt: t3,
      }));

      taskResultModel.find.mockReturnValue(makeFindChain([
        { taskId: 'step-1', iteration: 0, status: 'completed', startedAt: t1, endedAt: t2, output: 'ok' },
      ]));

      routerDecisionModel.find.mockReturnValue(makeFindChain([
        { routerNodeId: 'router-1', iteration: 0, label: 'retry', decidedAt: new Date('2026-01-01T00:01:30Z') },
      ]));

      const events = await service.traceReplay('exec-2', 'user-1');

      const routerEvents = events.filter(e => e.type === 'RouterDecision');
      expect(routerEvents).toHaveLength(1);
      expect(routerEvents[0].data).toMatchObject({ routerNodeId: 'router-1', label: 'retry' });
    });

    it('emits NodeFailed when task result status is failed', async () => {
      const { service, executionModel, taskResultModel, routerDecisionModel } = createReplayServiceForTests();

      const t = new Date('2026-01-01T00:01:00Z');

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-3', ownerId: 'user-1', status: 'failed', endedAt: t,
      }));

      taskResultModel.find.mockReturnValue(makeFindChain([
        { taskId: 'step-1', iteration: 0, status: 'failed', startedAt: t, endedAt: t, error: 'LLM error' },
      ]));

      routerDecisionModel.find.mockReturnValue(makeFindChain([]));

      const events = await service.traceReplay('exec-3', 'user-1');

      const failedEvents = events.filter(e => e.type === 'NodeFailed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].data).toMatchObject({ taskId: 'step-1', error: 'LLM error' });
      expect(events[events.length - 1].type).toBe('ExecutionFailed');
    });

    it('throws NotFoundException for non-existent execution', async () => {
      const { service, executionModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain(null));

      await expect(service.traceReplay('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('selects snapshot and inputContext when loading the execution', async () => {
      const { service, executionModel, taskResultModel, routerDecisionModel } = createReplayServiceForTests();
      const executionQuery = makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', status: 'completed', endedAt: new Date('2026-01-01T00:06:00Z'),
      });

      executionModel.findOne.mockReturnValue(executionQuery);
      taskResultModel.find.mockReturnValue(makeFindChain([]));
      routerDecisionModel.find.mockReturnValue(makeFindChain([]));

      await service.traceReplay('exec-1', 'user-1');

      expect(executionQuery.select).toHaveBeenCalledWith('+snapshot +inputContext');
    });
  });

  describe('reExecute', () => {
    it('calls executionService.start with the original flowId and inputContext', async () => {
      const { service, executionModel, executionService } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', flowId: 'flow-1',
        inputContext: { query: 'hello' },
        modelIdOverride: 'gpt-override',
      }));

      executionService.start.mockResolvedValue({ id: 'exec-42' });

      const result = await service.reExecute('exec-1', 'user-1');

      expect(executionService.start).toHaveBeenCalledWith(
        'flow-1',
        'user-1',
        { query: 'hello' },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'live',
        undefined,
        'gpt-override',
      );
      expect(result.executionId).toBe('exec-42');
      expect(result.divergenceWarning).toBe(true);
    });

    it('throws NotFoundException for non-existent execution', async () => {
      const { service, executionModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain(null));

      await expect(service.reExecute('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('selects snapshot and inputContext before replay re-execution', async () => {
      const { service, executionModel, executionService } = createReplayServiceForTests();
      const executionQuery = makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', flowId: 'flow-1', inputContext: { query: 'hello' }, executionMode: 'live', modelIdOverride: 'gpt-override',
      });

      executionModel.findOne.mockReturnValue(executionQuery);
      executionService.start.mockResolvedValue({ id: 'exec-42' });

      await service.reExecute('exec-1', 'user-1');

      expect(executionQuery.select).toHaveBeenCalledWith('+snapshot +inputContext');
    });
  });

  describe('validateTaskReplay', () => {
    it('creates a validated replay entry with incremented version', async () => {
      const { service, executionModel, taskResultModel, replayModel, replayBaselineService } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', flowId: 'flow-1', status: 'completed',
        executionNumber: 2,
        inputContext: { query: 'hello' },
        snapshot: { nodes: [{ id: 'step-1', modelId: 'gpt-4o-mini', metadata: { agent_model: 'gpt-4o-mini' } }] },
        schemaVersion: 3,
        hitlEvents: [{
          interruptId: 'int-1',
          nodeId: 'step-1',
          iteration: 0,
          status: 'answered',
          type: 'clarification',
          reasonCode: 'missing_document',
          prompt: 'Which document?',
          response: { action: 'reply', message: 'Use signed contract.', scope: 'downstream_run' },
          downstreamNodeIds: ['step-2'],
        }],
      }));

      taskResultModel.findOne.mockReturnValue(makeFindOneChain({
        executionId: 'exec-1', taskId: 'step-1', iteration: 0,
        output: 'original output',
        toolTrace: [{ callIndex: 0, toolName: 'search', args: {}, outputSummary: 'ok' }],
        reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
        llmPromptTrace: [{ stage: 'initial_request', model: 'gpt-4o-mini', prompt: 'Hello' }],
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-4o-mini' },
        semanticMatch: { matchScore: 0.9 },
        traceMetadata: { collected: true },
      }));

      replayModel.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      replayModel.create.mockResolvedValue([{
        flowId: 'flow-1', taskId: 'step-1', iteration: 0, validationVersion: 1,
        status: FlowReplayValidationStatus.ACTIVE,
      }]);
      replayModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'exec-1');

      expect(result.validationVersion).toBe(1);
      expect(result.status).toBe(FlowReplayValidationStatus.ACTIVE);
      expect(replayBaselineService.buildValidatedReplayBaseline).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'step-1',
        taskTitle: 'step-1',
        referenceExecutionNumber: 2,
        inputContext: { query: 'hello' },
        flowSnapshot: { nodes: [{ id: 'step-1', modelId: 'gpt-4o-mini', metadata: { agent_model: 'gpt-4o-mini' } }] },
        hitlEvents: expect.arrayContaining([expect.objectContaining({ interruptId: 'int-1' })]),
      }));
      expect(replayModel.create).toHaveBeenCalledWith([expect.objectContaining({
        referenceExecutionNumber: 2,
        mode: 'replay_strict',
        intentKey: 'task-review',
        intentLabel: 'Task review',
        reasoningOutline: [{ stageKey: 'analyze', stageType: 'analysis', label: 'Analyze', description: 'Inspect the request.', confidence: 0.9 }],
        stableReasoningRules: ['Preserve analyze.'],
        contextVariableSchema: [{ key: 'query', label: 'query', source: 'input_context', valueType: 'string', required: true, exampleValue: 'hello' }],
        toolTraceTemplate: [{ stepIndex: 1, toolName: 'search', purpose: 'Find evidence.', argumentShape: { query: 'string' }, required: true }],
        driftPolicy: expect.objectContaining({ requireSameIntent: true }),
        acceptedExamples: [{ referenceExecutionId: 'exec-1', referenceExecutionNumber: 2, summary: 'Validated replay baseline for Task review.', outputPreview: 'original output' }],
        hitlMemorySnapshots: [],
        toolCalls: [{ callIndex: 0, toolName: 'search', args: {}, outputSummary: 'ok' }],
        reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
        llmPromptTrace: [{ stage: 'initial_request', model: 'gpt-4o-mini', prompt: 'Hello' }],
        fingerprints: { inputContextHash: 'hash-1' },
        behaviorBaseline: { decisionInvariants: ['Verify facts'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
        toolPolicy: { requiredTools: ['search'], forbiddenTools: [], sequencingRules: [], requireSameOrder: false },
        outputContract: { type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' },
        referenceUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-4o-mini' },
        referenceSemanticMatch: { matchScore: 0.9 },
        traceMetadata: { collected: true },
        isStale: false,
        staleReasons: [],
      })]);
    });

    it('selects snapshot and inputContext before building replay fingerprints', async () => {
      const { service, executionModel, taskResultModel, replayModel, replayBaselineService } = createReplayServiceForTests();
      const executionQuery = makeFindOneChain({
        id: 'exec-1',
        ownerId: 'user-1',
        flowId: 'flow-1',
        status: 'completed',
        inputContext: { query: 'hello' },
        snapshot: {
          nodes: [{ id: 'step-1', modelId: 'gpt-4o-mini', metadata: { agent_model: 'gpt-4o-mini' } }],
        },
        schemaVersion: 3,
      });

      executionModel.findOne.mockReturnValue(executionQuery);
      taskResultModel.findOne.mockReturnValue(makeFindOneChain({
        executionId: 'exec-1',
        taskId: 'step-1',
        iteration: 0,
        output: 'original output',
      }));
      replayModel.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      replayModel.create.mockResolvedValue([{ validationVersion: 1, status: FlowReplayValidationStatus.ACTIVE }]);

      await service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'exec-1');

      expect(executionQuery.select).toHaveBeenCalledWith('+snapshot +inputContext');
      expect(replayBaselineService.buildValidatedReplayBaseline).toHaveBeenCalledWith(expect.objectContaining({
        inputContext: { query: 'hello' },
        flowSnapshot: {
          nodes: [{ id: 'step-1', modelId: 'gpt-4o-mini', metadata: { agent_model: 'gpt-4o-mini' } }],
        },
        nodeSnapshot: { id: 'step-1', modelId: 'gpt-4o-mini', metadata: { agent_model: 'gpt-4o-mini' } },
      }));
    });

    it('defaults missing reasoningChain to an empty array', async () => {
      const { service, executionModel, taskResultModel, replayModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', flowId: 'flow-1', status: 'completed',
        snapshot: { nodes: [{ id: 'step-1' }] },
      }));

      taskResultModel.findOne.mockReturnValue(makeFindOneChain({
        executionId: 'exec-1', taskId: 'step-1', iteration: 0, output: 'original output',
      }));

      replayModel.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      replayModel.create.mockResolvedValue([{ validationVersion: 1, status: FlowReplayValidationStatus.ACTIVE }]);

      await service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'exec-1');

      expect(replayModel.create).toHaveBeenCalledWith([expect.objectContaining({ reasoningChain: [] })]);
    });

    it('throws NotFoundException when execution not found', async () => {
      const { service, executionModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain(null));

      await expect(
        service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when task result not found', async () => {
      const { service, executionModel, taskResultModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', flowId: 'flow-1', status: 'completed',
        snapshot: { nodes: [{ id: 'step-1' }] },
      }));

      taskResultModel.findOne.mockReturnValue(makeFindOneChain(null));

      await expect(
        service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'exec-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects validation when the execution belongs to a different flow', async () => {
      const { service, executionModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1',
        ownerId: 'user-1',
        flowId: 'flow-2',
        snapshot: { nodes: [{ id: 'step-1' }] },
      }));

      await expect(service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'exec-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('activateTaskReplay', () => {
    it('deactivates all other replays and activates the target', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
      replayModel.findOneAndUpdate.mockResolvedValue({
        _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1',
        status: FlowReplayValidationStatus.ACTIVE,
      });

      const result = await service.activateTaskReplay('flow-1', 'step-1', 'replay-1');

      expect(replayModel.updateMany).toHaveBeenCalledWith(
        { flowId: 'flow-1', taskId: 'step-1', status: FlowReplayValidationStatus.ACTIVE },
        { status: FlowReplayValidationStatus.INACTIVE },
      );
      expect(result.status).toBe(FlowReplayValidationStatus.ACTIVE);
    });

    it('throws NotFoundException when replay not found', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.updateMany.mockResolvedValue({ modifiedCount: 0 });
      replayModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.activateTaskReplay('flow-1', 'step-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTaskReplayFormatGuide', () => {
    it('updates output format guide fields', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
        _id: 'replay-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        referenceOutput: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'Old guide',
        outputContract: { type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' },
        fingerprints: { inputContextHash: 'hash-1' },
      }) });

      replayModel.findOneAndUpdate.mockResolvedValue({
        _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1',
        preserveOutputFormat: true, outputFormatGuide: 'JSON array',
      });

      const result = await service.updateTaskReplayFormatGuide('flow-1', 'step-1', 'replay-1', {
        preserveOutputFormat: true, outputFormatGuide: 'JSON array',
      });

      expect(replayModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1' },
        { $set: expect.objectContaining({ outputFormatGuide: 'JSON array', preserveOutputFormat: true, outputContract: expect.anything() }) },
        { new: true },
      );
      expect(result.preserveOutputFormat).toBe(true);
    });

    it('preserves json schema contract when reference output is stored as stringified json', async () => {
      const jsonSchemaContract = {
        type: 'json_schema',
        requiredSections: [],
        forbiddenSections: [],
        jsonSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
        citationPolicy: 'optional',
      };
      const { service, replayModel, replayBaselineService } = createReplayServiceForTests({
        replayBaselineService: {
          buildOutputContractFromReplay: jest.fn().mockReturnValue(jsonSchemaContract),
          buildOutputContractHash: jest.fn().mockReturnValue('json-hash'),
        },
      });

      replayModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
        _id: 'replay-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        referenceOutput: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'Old guide',
        outputContract: jsonSchemaContract,
        fingerprints: { outputContractHash: 'old-hash' },
      }) });
      replayModel.findOneAndUpdate.mockResolvedValue({ _id: 'replay-1' });

      await service.updateTaskReplayFormatGuide('flow-1', 'step-1', 'replay-1', {
        preserveOutputFormat: true,
        outputFormatGuide: 'Keep same JSON keys.',
      });

      expect(replayBaselineService.buildOutputContractFromReplay).toHaveBeenCalledWith({
        output: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'Keep same JSON keys.',
        existingOutputContract: jsonSchemaContract,
      });
      expect(replayModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1' },
        { $set: expect.objectContaining({
          outputContract: jsonSchemaContract,
          fingerprints: { outputContractHash: 'json-hash' },
        }) },
        { new: true },
      );
    });

    it('keeps existing preserveOutputFormat when omitted from partial updates', async () => {
      const jsonSchemaContract = {
        type: 'json_schema',
        requiredSections: [],
        forbiddenSections: [],
        jsonSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
        citationPolicy: 'optional',
      };
      const { service, replayModel, replayBaselineService } = createReplayServiceForTests({
        replayBaselineService: {
          buildOutputContractFromReplay: jest.fn().mockReturnValue(jsonSchemaContract),
          buildOutputContractHash: jest.fn().mockReturnValue('json-hash'),
        },
      });

      replayModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
        _id: 'replay-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        referenceOutput: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'Old guide',
        outputContract: jsonSchemaContract,
        fingerprints: { outputContractHash: 'old-hash' },
      }) });
      replayModel.findOneAndUpdate.mockResolvedValue({
        _id: 'replay-1',
        preserveOutputFormat: true,
        outputFormatGuide: 'New guide',
      });

      await service.updateTaskReplayFormatGuide('flow-1', 'step-1', 'replay-1', {
        outputFormatGuide: 'New guide',
        replayConfig: { replayOutputFormat: true },
      });

      expect(replayBaselineService.buildOutputContractFromReplay).toHaveBeenCalledWith({
        output: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'New guide',
        existingOutputContract: jsonSchemaContract,
      });
      expect(replayModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1' },
        { $set: expect.objectContaining({
          outputFormatGuide: 'New guide',
          preserveOutputFormat: true,
          outputContract: jsonSchemaContract,
          fingerprints: { outputContractHash: 'json-hash' },
          'replayConfig.replayOutputFormat': true,
        }) },
        { new: true },
      );
    });
  });

  describe('updateTaskReplayLabel', () => {
    it('updates the label on the replay', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOneAndUpdate.mockResolvedValue({
        _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1', label: 'v2',
      });

      const result = await service.updateTaskReplayLabel('flow-1', 'step-1', 'replay-1', 'v2');

      expect(replayModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1' },
        { $set: { label: 'v2' } },
        { new: true },
      );
      expect(result.label).toBe('v2');
    });
  });

  describe('deleteTaskReplay', () => {
    it('deletes the replay document and returns wasActive true for active replay', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'replay-1', status: FlowReplayValidationStatus.ACTIVE }) });
      replayModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.deleteTaskReplay('flow-1', 'step-1', 'replay-1');

      expect(result).toEqual({ removed: true, wasActive: true });
    });

    it('returns wasActive false for inactive replay', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'replay-1', status: FlowReplayValidationStatus.INACTIVE }) });
      replayModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.deleteTaskReplay('flow-1', 'step-1', 'replay-1');

      expect(result).toEqual({ removed: true, wasActive: false });
    });

    it('returns removed false when replay does not exist', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      const result = await service.deleteTaskReplay('flow-1', 'step-1', 'replay-1');

      expect(result).toEqual({ removed: false, wasActive: false });
    });
  });

  describe('getActiveReplay', () => {
    it('returns the active replay for a flow and task', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ taskId: 'step-1', status: 'active' }) });

      const result = await service.getActiveReplay('flow-1', 'step-1');

      expect(result).not.toBeNull();
    });
  });
});
