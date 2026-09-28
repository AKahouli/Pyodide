import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowReplayService } from './playbook-flow-replay.service';
import {
  FlowReplayFormatGuideStatus,
  FlowReplayValidationMode,
  FlowReplayValidationStatus,
} from '../interfaces/playbook-flow-validated-replay.interface';
import type { FlowValidatedReplayRecord } from '../persistence/validated-replay.repository';

const FLOW_ID = 'aaaaaaaaaaaaaaaaaaaaaaa1';

function makeReplayRecord(overrides: Partial<FlowValidatedReplayRecord> = {}): FlowValidatedReplayRecord {
  return {
    id: 'replay-1',
    flowId: FLOW_ID,
    taskId: 'step-1',
    iteration: 0,
    taskTitle: 'step-1',
    createdBy: 'user-1',
    referenceExecutionId: 'exec-1',
    referenceExecutionNumber: 1,
    validationVersion: 1,
    status: FlowReplayValidationStatus.ACTIVE,
    mode: FlowReplayValidationMode.STRICT,
    isStale: false,
    staleReasons: [],
    referenceWorkspaceIds: [],
    toolCalls: [],
    reasoningChain: [],
    llmPromptTrace: [],
    formatGuideStatus: FlowReplayFormatGuideStatus.DISABLED,
    reasoningOutline: [],
    stableReasoningRules: [],
    contextVariableSchema: [],
    toolTraceTemplate: [],
    acceptedExamples: [],
    semanticChecklist: [],
    hitlMemorySnapshots: [],
    replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as FlowValidatedReplayRecord;
}

function createReplayServiceForTests(overrides?: {
  replayBaselineService?: Record<string, any>;
}) {
  const executionRepository = {
    findOwned: jest.fn(),
  };
  const taskResultRepository = {
    listForExecution: jest.fn().mockResolvedValue([]),
    find: jest.fn(),
  };
  const routerDecisionRepository = {
    listForExecution: jest.fn().mockResolvedValue([]),
  };
  const replayRepository = {
    createNextVersion: jest.fn(async (input: Record<string, unknown>) => makeReplayRecord({ ...input, id: 'replay-new', validationVersion: 1 } as Partial<FlowValidatedReplayRecord>)),
    listByTask: jest.fn().mockResolvedValue([]),
    activate: jest.fn(),
    findInTask: jest.fn(),
    update: jest.fn(),
    deleteInTask: jest.fn(),
    findActive: jest.fn(),
    listActiveForTasks: jest.fn().mockResolvedValue([]),
  };
  const executionService = {
    start: jest.fn(),
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
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const service = new PlaybookFlowReplayService(
    executionRepository as any,
    taskResultRepository as any,
    routerDecisionRepository as any,
    replayRepository as any,
    executionService as any,
    replayBaselineService as any,
    logger as any,
  );

  return { service, executionRepository, taskResultRepository, routerDecisionRepository, replayRepository, executionService, replayBaselineService };
}

const execution = (overrides: Record<string, unknown> = {}) => ({
  id: 'exec-1',
  ownerId: 'user-1',
  flowId: FLOW_ID,
  status: 'completed',
  endedAt: null,
  error: null,
  schemaVersion: 1,
  inputContext: null,
  hitlEvents: [],
  executionMode: 'live',
  stepExecutionModes: {},
  modelIdOverride: null,
  ...overrides,
});

describe('PlaybookFlowReplayService', () => {
  describe('traceReplay', () => {
    it('reconstructs a linear flow with 3 completed nodes', async () => {
      const { service, executionRepository, taskResultRepository } = createReplayServiceForTests();

      const t1 = new Date('2026-01-01T00:00:00Z');
      const t2 = new Date('2026-01-01T00:01:00Z');
      const t3 = new Date('2026-01-01T00:02:00Z');
      const t4 = new Date('2026-01-01T00:03:00Z');
      const t5 = new Date('2026-01-01T00:04:00Z');
      const t6 = new Date('2026-01-01T00:05:00Z');
      const tEnd = new Date('2026-01-01T00:06:00Z');

      executionRepository.findOwned.mockResolvedValue(execution({ endedAt: tEnd }));
      taskResultRepository.listForExecution.mockResolvedValue([
        {
          taskId: 'step-1', iteration: 0, status: 'completed', startedAt: t1, endedAt: t2, output: 'hello',
          displayText: 'hello', toolTrace: [{ toolName: 'search' }], llmPromptTrace: [{ stage: 'initial_request' }],
          reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-4o-mini' },
          semanticMatch: { matchScore: 0.9 }, traceMetadata: { collected: true },
        },
        { taskId: 'step-2', iteration: 0, status: 'completed', startedAt: t3, endedAt: t4, output: 'world', toolTrace: [], reasoningChain: [], llmPromptTrace: [] },
        { taskId: 'step-3', iteration: 0, status: 'completed', startedAt: t5, endedAt: t6, output: 'done', toolTrace: [], reasoningChain: [], llmPromptTrace: [] },
      ]);

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
      const { service, executionRepository, taskResultRepository, routerDecisionRepository } = createReplayServiceForTests();

      const t1 = new Date('2026-01-01T00:01:00Z');
      const t2 = new Date('2026-01-01T00:02:00Z');
      const t3 = new Date('2026-01-01T00:03:00Z');

      executionRepository.findOwned.mockResolvedValue(execution({ id: 'exec-2', endedAt: t3 }));
      taskResultRepository.listForExecution.mockResolvedValue([
        { taskId: 'step-1', iteration: 0, status: 'completed', startedAt: t1, endedAt: t2, output: 'ok', toolTrace: [], reasoningChain: [], llmPromptTrace: [] },
      ]);
      routerDecisionRepository.listForExecution.mockResolvedValue([
        { routerNodeId: 'router-1', iteration: 0, label: 'retry', decidedAt: new Date('2026-01-01T00:01:30Z') },
      ]);

      const events = await service.traceReplay('exec-2', 'user-1');

      const routerEvents = events.filter(e => e.type === 'RouterDecision');
      expect(routerEvents).toHaveLength(1);
      expect(routerEvents[0].data).toMatchObject({ routerNodeId: 'router-1', label: 'retry' });
      expect(events.map((e) => e.type)).toEqual(['NodeStarted', 'RouterDecision', 'NodeCompleted', 'ExecutionCompleted']);
    });

    it('emits NodeFailed when task result status is failed', async () => {
      const { service, executionRepository, taskResultRepository } = createReplayServiceForTests();

      const t = new Date('2026-01-01T00:01:00Z');

      executionRepository.findOwned.mockResolvedValue(execution({ id: 'exec-3', status: 'failed', endedAt: t }));
      taskResultRepository.listForExecution.mockResolvedValue([
        { taskId: 'step-1', iteration: 0, status: 'failed', startedAt: t, endedAt: t, error: 'LLM error' },
      ]);

      const events = await service.traceReplay('exec-3', 'user-1');

      const failedEvents = events.filter(e => e.type === 'NodeFailed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].data).toMatchObject({ taskId: 'step-1', error: 'LLM error' });
      expect(events[events.length - 1].type).toBe('ExecutionFailed');
    });

    it('throws NotFoundException for non-existent execution', async () => {
      const { service, executionRepository } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(null);

      await expect(service.traceReplay('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('loads the owner-scoped execution, its task results by end time and its router decisions', async () => {
      const { service, executionRepository, taskResultRepository, routerDecisionRepository } = createReplayServiceForTests();
      executionRepository.findOwned.mockResolvedValue(execution({ endedAt: new Date('2026-01-01T00:06:00Z') }));

      await service.traceReplay('exec-1', 'user-1');

      expect(executionRepository.findOwned).toHaveBeenCalledWith('exec-1', 'user-1');
      expect(taskResultRepository.listForExecution).toHaveBeenCalledWith('exec-1', { order: 'ended' });
      expect(routerDecisionRepository.listForExecution).toHaveBeenCalledWith('exec-1');
    });
  });

  describe('reExecute', () => {
    it('calls executionService.start with the original flowId and inputContext', async () => {
      const { service, executionRepository, executionService } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(execution({
        inputContext: { query: 'hello' },
        executionMode: 'live',
        modelIdOverride: 'gpt-override',
      }));
      executionService.start.mockResolvedValue({ id: 'exec-42' });

      const result = await service.reExecute('exec-1', 'user-1');

      expect(executionRepository.findOwned).toHaveBeenCalledWith('exec-1', 'user-1');
      // stepExecutionModes is a NOT NULL column: an execution without per-step modes carries {} (start treats it like undefined).
      expect(executionService.start).toHaveBeenCalledWith(
        FLOW_ID,
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
        {},
        'gpt-override',
      );
      expect(result.executionId).toBe('exec-42');
      expect(result.divergenceWarning).toBe(true);
    });

    it('passes no input context or model override when the run had none', async () => {
      const { service, executionRepository, executionService } = createReplayServiceForTests();
      executionRepository.findOwned.mockResolvedValue(execution({ executionMode: 'replay_flex', stepExecutionModes: { 'step-1': 'live' } }));
      executionService.start.mockResolvedValue({ id: 'exec-43' });

      await service.reExecute('exec-1', 'user-1');

      const args = executionService.start.mock.calls[0];
      expect(args[2]).toBeUndefined();
      expect(args[10]).toBe('replay_flex');
      expect(args[11]).toEqual({ 'step-1': 'live' });
      expect(args[12]).toBeUndefined();
    });

    it('throws NotFoundException for non-existent execution', async () => {
      const { service, executionRepository } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(null);

      await expect(service.reExecute('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateTaskReplay', () => {
    it('creates the next validated replay version from the task result and the baseline', async () => {
      const { service, executionRepository, taskResultRepository, replayRepository, replayBaselineService } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(execution({
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
      taskResultRepository.find.mockResolvedValue({
        executionId: 'exec-1', taskId: 'step-1', iteration: 0,
        output: 'original output',
        toolTrace: [{ callIndex: 0, toolName: 'search', args: {}, outputSummary: 'ok' }],
        reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
        llmPromptTrace: [{ stage: 'initial_request', model: 'gpt-4o-mini', prompt: 'Hello' }],
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-4o-mini' },
        semanticMatch: { matchScore: 0.9 },
        traceMetadata: { collected: true },
        judgeResult: null,
      });

      const result = await service.validateTaskReplay('user-1', FLOW_ID, 'step-1', 0, 'exec-1');

      expect(executionRepository.findOwned).toHaveBeenCalledWith('exec-1', 'user-1', { withSnapshot: true });
      expect(taskResultRepository.find).toHaveBeenCalledWith({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 });
      expect(result.id).toBe('replay-new');
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
      expect(replayRepository.createNextVersion).toHaveBeenCalledWith(expect.objectContaining({
        flowId: FLOW_ID,
        taskId: 'step-1',
        iteration: 0,
        createdBy: 'user-1',
        referenceExecutionId: 'exec-1',
        referenceExecutionNumber: 2,
        referenceTaskDescription: '',
        referenceOutput: 'original output',
        status: FlowReplayValidationStatus.ACTIVE,
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
        referenceFlowRevision: 3,
        referenceNodeSnapshot: { id: 'step-1', modelId: 'gpt-4o-mini', metadata: { agent_model: 'gpt-4o-mini' } },
        isStale: false,
        staleReasons: [],
        preserveOutputFormat: false,
        replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
      }));
    });

    it('stores the normalised mode and a JSON-encoded structured reference output', async () => {
      const { service, executionRepository, taskResultRepository, replayRepository } = createReplayServiceForTests({
        replayBaselineService: { buildValidatedReplayBaseline: jest.fn().mockReturnValue({ mode: 'replay_flex', hitlMemorySnapshots: [] }) },
      });
      executionRepository.findOwned.mockResolvedValue(execution({ snapshot: { nodes: [{ id: 'step-1', label: ' Summarise ', metadata: { description: ' Write it up ' } }] } }));
      taskResultRepository.find.mockResolvedValue({ executionId: 'exec-1', taskId: 'step-1', iteration: 1, output: { summary: 'ok' }, toolTrace: [], reasoningChain: [], llmPromptTrace: [] });

      await service.validateTaskReplay('user-1', FLOW_ID.toUpperCase(), 'step-1', 1, 'exec-1', {
        mode: 'strict_replay',
        preserveOutputFormat: true,
        replayConfig: { replayToolTrace: true },
      });

      expect(replayRepository.createNextVersion).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        taskTitle: 'Summarise',
        referenceTaskDescription: 'Write it up',
        mode: 'replay_flex',
        referenceOutput: '{"summary":"ok"}',
        preserveOutputFormat: true,
        replayConfig: { replayOutputFormat: false, replayToolTrace: true, replayReasoningChain: true },
      }));
    });

    it('defaults missing reasoningChain to an empty array', async () => {
      const { service, executionRepository, taskResultRepository, replayRepository } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(execution({ snapshot: { nodes: [{ id: 'step-1' }] } }));
      taskResultRepository.find.mockResolvedValue({ executionId: 'exec-1', taskId: 'step-1', iteration: 0, output: 'original output' });

      await service.validateTaskReplay('user-1', FLOW_ID, 'step-1', 0, 'exec-1');

      expect(replayRepository.createNextVersion).toHaveBeenCalledWith(expect.objectContaining({ reasoningChain: [], toolCalls: [], llmPromptTrace: [] }));
    });

    it('throws NotFoundException when execution not found', async () => {
      const { service, executionRepository, replayRepository } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(null);

      await expect(
        service.validateTaskReplay('user-1', FLOW_ID, 'step-1', 0, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
      expect(replayRepository.createNextVersion).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when task result not found', async () => {
      const { service, executionRepository, taskResultRepository } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(execution({ snapshot: { nodes: [{ id: 'step-1' }] } }));
      taskResultRepository.find.mockResolvedValue(null);

      await expect(
        service.validateTaskReplay('user-1', FLOW_ID, 'step-1', 0, 'exec-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the task is not in the execution snapshot', async () => {
      const { service, executionRepository, taskResultRepository, replayRepository } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(execution({ snapshot: { nodes: [{ id: 'other-step' }] } }));
      taskResultRepository.find.mockResolvedValue({ executionId: 'exec-1', taskId: 'step-1', iteration: 0, output: 'x' });

      await expect(service.validateTaskReplay('user-1', FLOW_ID, 'step-1', 0, 'exec-1')).rejects.toThrow('Task not found in execution snapshot');
      expect(replayRepository.createNextVersion).not.toHaveBeenCalled();
    });

    it('rejects validation when the execution belongs to a different flow', async () => {
      const { service, executionRepository, taskResultRepository } = createReplayServiceForTests();

      executionRepository.findOwned.mockResolvedValue(execution({ flowId: 'bbbbbbbbbbbbbbbbbbbbbbb2', snapshot: { nodes: [{ id: 'step-1' }] } }));

      await expect(service.validateTaskReplay('user-1', FLOW_ID, 'step-1', 0, 'exec-1')).rejects.toThrow(NotFoundException);
      expect(taskResultRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('listTaskReplays', () => {
    it('returns the JSON the Mongo documents produced: schema defaults filled in, legacy strict_replay serialised', async () => {
      const { service, replayRepository } = createReplayServiceForTests();
      const legacy = { id: 'replay-2', flowId: FLOW_ID, taskId: 'step-1', validationVersion: 2, status: 'inactive', mode: 'strict_replay', isStale: false } as unknown as FlowValidatedReplayRecord;
      replayRepository.listByTask.mockResolvedValue([makeReplayRecord({ validationVersion: 3 }), legacy]);

      const result = await service.listTaskReplays(FLOW_ID, 'step-1');

      expect(replayRepository.listByTask).toHaveBeenCalledWith(FLOW_ID, 'step-1');
      expect(result.map((replay) => replay.validationVersion)).toEqual([3, 2]);
      expect(result[1]).toMatchObject({
        id: 'replay-2',
        mode: 'replay_strict',
        intentLabel: '',
        reasoningOutline: [],
        formatGuideStatus: 'disabled',
        replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
      });
    });
  });

  describe('activateTaskReplay', () => {
    it('activates the target (the repository deactivates the task\'s other baselines in the same statement)', async () => {
      const { service, replayRepository } = createReplayServiceForTests();

      replayRepository.activate.mockResolvedValue(makeReplayRecord({ id: 'replay-1', status: FlowReplayValidationStatus.ACTIVE }));

      const result = await service.activateTaskReplay(FLOW_ID, 'step-1', 'replay-1');

      expect(replayRepository.activate).toHaveBeenCalledWith('replay-1', FLOW_ID, 'step-1');
      expect(result.status).toBe(FlowReplayValidationStatus.ACTIVE);
    });

    it('throws NotFoundException when replay not found', async () => {
      const { service, replayRepository } = createReplayServiceForTests();

      replayRepository.activate.mockResolvedValue(null);

      await expect(service.activateTaskReplay(FLOW_ID, 'step-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTaskReplayFormatGuide', () => {
    it('updates output format guide fields', async () => {
      const { service, replayRepository } = createReplayServiceForTests();

      replayRepository.findInTask.mockResolvedValue(makeReplayRecord({
        referenceOutput: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'Old guide',
        outputContract: { type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' } as any,
        fingerprints: { inputContextHash: 'hash-1' },
      }));
      replayRepository.update.mockResolvedValue(makeReplayRecord({ preserveOutputFormat: true, outputFormatGuide: 'JSON array' }));

      const result = await service.updateTaskReplayFormatGuide(FLOW_ID, 'step-1', 'replay-1', {
        preserveOutputFormat: true, outputFormatGuide: 'JSON array',
      });

      expect(replayRepository.findInTask).toHaveBeenCalledWith('replay-1', FLOW_ID, 'step-1');
      expect(replayRepository.update).toHaveBeenCalledWith('replay-1', FLOW_ID, 'step-1', expect.objectContaining({
        outputFormatGuide: 'JSON array',
        preserveOutputFormat: true,
        outputContract: expect.anything(),
        fingerprints: { inputContextHash: 'hash-1', outputContractHash: 'contract-hash' },
        replayConfig: {},
      }));
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
      const { service, replayRepository, replayBaselineService } = createReplayServiceForTests({
        replayBaselineService: {
          buildOutputContractFromReplay: jest.fn().mockReturnValue(jsonSchemaContract),
          buildOutputContractHash: jest.fn().mockReturnValue('json-hash'),
        },
      });

      replayRepository.findInTask.mockResolvedValue(makeReplayRecord({
        referenceOutput: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'Old guide',
        outputContract: jsonSchemaContract as any,
        fingerprints: { outputContractHash: 'old-hash' },
      }));
      replayRepository.update.mockResolvedValue(makeReplayRecord());

      await service.updateTaskReplayFormatGuide(FLOW_ID, 'step-1', 'replay-1', {
        preserveOutputFormat: true,
        outputFormatGuide: 'Keep same JSON keys.',
      });

      expect(replayBaselineService.buildOutputContractFromReplay).toHaveBeenCalledWith({
        output: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'Keep same JSON keys.',
        existingOutputContract: jsonSchemaContract,
      });
      expect(replayRepository.update).toHaveBeenCalledWith('replay-1', FLOW_ID, 'step-1', expect.objectContaining({
        outputContract: jsonSchemaContract,
        fingerprints: { outputContractHash: 'json-hash' },
      }));
    });

    it('keeps existing preserveOutputFormat when omitted from partial updates', async () => {
      const jsonSchemaContract = {
        type: 'json_schema',
        requiredSections: [],
        forbiddenSections: [],
        jsonSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
        citationPolicy: 'optional',
      };
      const { service, replayRepository, replayBaselineService } = createReplayServiceForTests({
        replayBaselineService: {
          buildOutputContractFromReplay: jest.fn().mockReturnValue(jsonSchemaContract),
          buildOutputContractHash: jest.fn().mockReturnValue('json-hash'),
        },
      });

      replayRepository.findInTask.mockResolvedValue(makeReplayRecord({
        referenceOutput: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'Old guide',
        outputContract: jsonSchemaContract as any,
        fingerprints: { outputContractHash: 'old-hash' },
      }));
      replayRepository.update.mockResolvedValue(makeReplayRecord({ preserveOutputFormat: true, outputFormatGuide: 'New guide' }));

      await service.updateTaskReplayFormatGuide(FLOW_ID, 'step-1', 'replay-1', {
        outputFormatGuide: 'New guide',
        replayConfig: { replayOutputFormat: true },
      });

      expect(replayBaselineService.buildOutputContractFromReplay).toHaveBeenCalledWith({
        output: '{"summary":"ok"}',
        preserveOutputFormat: true,
        outputFormatGuide: 'New guide',
        existingOutputContract: jsonSchemaContract,
      });
      // Only the replayConfig keys the request carries are merged into the stored config.
      expect(replayRepository.update).toHaveBeenCalledWith('replay-1', FLOW_ID, 'step-1', expect.objectContaining({
        outputFormatGuide: 'New guide',
        preserveOutputFormat: true,
        outputContract: jsonSchemaContract,
        fingerprints: { outputContractHash: 'json-hash' },
        replayConfig: { replayOutputFormat: true },
      }));
    });

    it('does not write fingerprints the replay never had', async () => {
      const { service, replayRepository } = createReplayServiceForTests();
      replayRepository.findInTask.mockResolvedValue(makeReplayRecord({ fingerprints: null }));
      replayRepository.update.mockResolvedValue(makeReplayRecord());

      await service.updateTaskReplayFormatGuide(FLOW_ID, 'step-1', 'replay-1', { outputFormatGuide: 'Guide' });

      expect(replayRepository.update.mock.calls[0][3]).not.toHaveProperty('fingerprints');
    });

    it('throws NotFoundException when the replay is not one of the task\'s', async () => {
      const { service, replayRepository } = createReplayServiceForTests();
      replayRepository.findInTask.mockResolvedValue(null);

      await expect(service.updateTaskReplayFormatGuide(FLOW_ID, 'step-1', 'replay-1', {})).rejects.toThrow(NotFoundException);
      expect(replayRepository.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the replay disappears before the write', async () => {
      const { service, replayRepository } = createReplayServiceForTests();
      replayRepository.findInTask.mockResolvedValue(makeReplayRecord());
      replayRepository.update.mockResolvedValue(null);

      await expect(service.updateTaskReplayFormatGuide(FLOW_ID, 'step-1', 'replay-1', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTaskReplayLabel', () => {
    it('updates the label on the replay', async () => {
      const { service, replayRepository } = createReplayServiceForTests();

      replayRepository.update.mockResolvedValue(makeReplayRecord({ label: 'v2' }));

      const result = await service.updateTaskReplayLabel(FLOW_ID, 'step-1', 'replay-1', 'v2');

      expect(replayRepository.update).toHaveBeenCalledWith('replay-1', FLOW_ID, 'step-1', { label: 'v2' });
      expect(result.label).toBe('v2');
    });

    it('throws NotFoundException when replay not found', async () => {
      const { service, replayRepository } = createReplayServiceForTests();
      replayRepository.update.mockResolvedValue(null);

      await expect(service.updateTaskReplayLabel(FLOW_ID, 'step-1', 'replay-1', null)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTaskReplay', () => {
    it('deletes the replay and returns wasActive true for active replay', async () => {
      const { service, replayRepository } = createReplayServiceForTests();

      replayRepository.deleteInTask.mockResolvedValue({ status: FlowReplayValidationStatus.ACTIVE });

      const result = await service.deleteTaskReplay(FLOW_ID, 'step-1', 'replay-1');

      expect(replayRepository.deleteInTask).toHaveBeenCalledWith('replay-1', FLOW_ID, 'step-1');
      expect(result).toEqual({ removed: true, wasActive: true });
    });

    it('returns wasActive false for inactive replay', async () => {
      const { service, replayRepository } = createReplayServiceForTests();

      replayRepository.deleteInTask.mockResolvedValue({ status: FlowReplayValidationStatus.INACTIVE });

      const result = await service.deleteTaskReplay(FLOW_ID, 'step-1', 'replay-1');

      expect(result).toEqual({ removed: true, wasActive: false });
    });

    it('returns removed false when replay does not exist', async () => {
      const { service, replayRepository } = createReplayServiceForTests();

      replayRepository.deleteInTask.mockResolvedValue(null);

      const result = await service.deleteTaskReplay(FLOW_ID, 'step-1', 'replay-1');

      expect(result).toEqual({ removed: false, wasActive: false });
    });
  });

  describe('getActiveReplay', () => {
    it('returns the active replay for a flow and task', async () => {
      const { service, replayRepository } = createReplayServiceForTests();

      replayRepository.findActive.mockResolvedValue(makeReplayRecord({ taskId: 'step-1' }));

      const result = await service.getActiveReplay(FLOW_ID, 'step-1');

      expect(replayRepository.findActive).toHaveBeenCalledWith(FLOW_ID, 'step-1');
      expect(result).not.toBeNull();
    });

    it('returns null when the task has no active replay', async () => {
      const { service, replayRepository } = createReplayServiceForTests();
      replayRepository.findActive.mockResolvedValue(null);

      await expect(service.getActiveReplay(FLOW_ID, 'step-1')).resolves.toBeNull();
    });
  });

  describe('getActiveReplays', () => {
    it('returns the active replays of the given tasks', async () => {
      const { service, replayRepository } = createReplayServiceForTests();
      replayRepository.listActiveForTasks.mockResolvedValue([makeReplayRecord({ taskId: 'step-1' }), makeReplayRecord({ id: 'replay-2', taskId: 'step-2' })]);

      const result = await service.getActiveReplays(FLOW_ID, ['step-1', 'step-2']);

      expect(replayRepository.listActiveForTasks).toHaveBeenCalledWith(FLOW_ID, ['step-1', 'step-2']);
      expect(result.map((replay) => replay.id)).toEqual(['replay-1', 'replay-2']);
    });
  });
});
