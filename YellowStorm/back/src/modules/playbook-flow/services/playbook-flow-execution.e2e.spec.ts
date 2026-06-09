import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowReplayDriftService } from './playbook-flow-replay-drift.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';

function mockExecutionModel(overrides?: Record<string, any>) {
  const base = {
    exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(null) })),
    updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
    findById: jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'exec-e2e', ownerId: 'owner-1', inputContext: {} }),
      }),
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) }),
    })),
    findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    findByIdAndDelete: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    countDocuments: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    distinct: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
  };
  return { ...base, ...overrides };
}

interface E2EContext {
  service: PlaybookFlowExecutionService;
  executionModel: Record<string, any>;
  taskResultModel: Record<string, any>;
  queueService: Record<string, any>;
  flowService: Record<string, any>;
  streamEvents: Record<string, any>;
  routerDecisionModel: Record<string, any>;
  mockRun: jest.Mock;
  triggerStreamEvents: () => Promise<void>;
  buildSnapshot: Record<string, any>;
}

async function createE2EService(
  streamEventsSequence?: Array<{ event_type: string; node_id?: string; iteration?: number; payload?: Record<string, unknown> }>,
  overrides?: {
    executionModel?: Record<string, any>;
    queueService?: Record<string, any>;
    flowService?: Record<string, any>;
    configService?: Record<string, any>;
    idempotencyService?: Record<string, any>;
    builderService?: Record<string, any>;
  },
): Promise<E2EContext> {
  const settleAsyncHandlers = async (cycles: number = 4) => {
    for (let i = 0; i < cycles; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
  };

  const waitFor = async (predicate: () => boolean, maxCycles: number = 40) => {
    for (let i = 0; i < maxCycles; i += 1) {
      if (predicate()) {
        return;
      }
      await new Promise((r) => setImmediate(r));
    }
  };

  const savedDoc: Record<string, any> = {
    id: 'exec-e2e',
    _id: 'exec-e2e',
    ownerId: 'owner-1',
    status: 'queued',
    toJSON: jest.fn().mockReturnValue({ id: 'exec-e2e', queuePosition: 1 }),
  };
  savedDoc.save = jest.fn().mockResolvedValue(savedDoc);
  const ExecutionModel = jest.fn(() => savedDoc) as any;
  Object.assign(ExecutionModel, mockExecutionModel(overrides?.executionModel));

  const taskResultModel = {
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    findOne: jest.fn(() => ({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) })),
  };
  const routerDecisionModel = {
    create: jest.fn(),
    deleteMany: jest.fn(),
  };

  const streamHandlers: Record<string, (data?: unknown) => void> = {};
  let streamMockCall: { on: jest.Mock };
  const mockOn = jest.fn((event: string, handler: (data?: unknown) => void) => {
    streamHandlers[event] = handler;
    return streamMockCall;
  });
  streamMockCall = { on: mockOn };
  const mockRun = jest.fn().mockReturnValue(streamMockCall);

  const triggerStreamEvents = async () => {
    if (!streamEventsSequence) return;
    await waitFor(() => mockRun.mock.calls.length > 0 && Boolean(streamHandlers.data) && Boolean(streamHandlers.end));
    for (const evt of streamEventsSequence) {
      if (streamHandlers.data) {
        streamHandlers.data(evt);
        await settleAsyncHandlers();
      }
    }
    if (streamHandlers.end) {
      streamHandlers.end();
      await settleAsyncHandlers();
    }
  };

  const configService = {
    get: jest.fn((key: string, fallback: unknown) => fallback),
    ...overrides?.configService,
  };
  const runtimeClient = {
    init: jest.fn(),
    isAvailable: jest.fn().mockReturnValue(true),
    run: jest.fn(),
    runFromCheckpoint: jest.fn(),
    cancel: jest.fn(),
    resumeApproval: jest.fn(),
    resumeFromStep: jest.fn(),
  };
  const queueService = {
    admit: jest.fn().mockResolvedValue(1),
    release: jest.fn()
      .mockResolvedValueOnce({ id: 'exec-e2e', flowId: 'flow-1', ownerId: 'owner-1', inputContext: {} })
      .mockResolvedValueOnce(null),
    refreshPositions: jest.fn().mockResolvedValue([]),
    getRunningCount: jest.fn().mockResolvedValue(0),
    ...overrides?.queueService,
  };
  const idempotencyService = {
    reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
    confirmLink: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    ...overrides?.idempotencyService,
  };
  const flowService = {
    findOne: jest.fn().mockResolvedValue({
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
    }),
    ...overrides?.flowService,
  };
  const buildSnapshot = { settings: { recursionLimit: 25, maxParallelism: 5 }, nodes: [], controlEdges: [], dataBindings: [] };
  const builderService = {
    buildSnapshot: jest.fn().mockReturnValue(buildSnapshot),
    ...overrides?.builderService,
  };
  const agentService = {
    buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([]),
  };
  const validatorService = {
    validate: jest.fn(),
  };
  const streamEvents = {
    emitExecutionComplete: jest.fn(),
    emitExecutionCancelled: jest.fn(),
    emitExecutionStart: jest.fn(),
    emitRouterDecision: jest.fn(),
    emitQueuePositionUpdate: jest.fn(),
    emitStepComplete: jest.fn(),
    emitStepStart: jest.fn(),
    emitStepUpdate: jest.fn(),
    emitInterrupt: jest.fn(),
    emitHitlInterruptResolved: jest.fn(),
    emitHitlMemorySaved: jest.fn(),
    cacheOwner: jest.fn(),
    emitExecutionQueued: jest.fn(),
  };
  const replayReportService = { findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null) };
  const outputContractService = new PlaybookFlowOutputContractService();
  const replayDriftService = new PlaybookFlowReplayDriftService(
    ExecutionModel as any,
    replayReportService as any,
    outputContractService,
    new PlaybookFlowReplayPlanService(),
    { setContext: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any,
  );

  const service = new PlaybookFlowExecutionService(
    ExecutionModel,
    taskResultModel as any,
    routerDecisionModel as any,
    configService as any,
    runtimeClient as any,
    queueService as any,
    idempotencyService as any,
    flowService as any,
    builderService as any,
    validatorService as any,
    agentService as any,
    streamEvents as any,
    new PlaybookFlowObservabilityService(
      new PlaybookFlowTraceRedactionService(),
      new PlaybookFlowPublicReasoningParserService(),
    ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      replayReportService as any,
      outputContractService as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
      undefined as any,
      new PlaybookFlowReplayPlanService() as any,
      replayDriftService as any,
    );

  (service as any).isGrpcAvailable = true;
  (service as any).playbookFlowClient = { Run: mockRun };
  // Drive queue drains synchronously instead of through the real 1s dispatch
  // timer so the test can observe runtime dispatch within microtask flushes.
  (service as any).executionDispatcherService = {
    schedule: (ownerId: string, drain: (id: string) => Promise<void>) => {
      void drain(ownerId);
    },
    cancel: jest.fn(),
  };

  return {
    service,
    executionModel: ExecutionModel,
    taskResultModel,
    queueService,
    flowService,
    streamEvents,
    routerDecisionModel,
    mockRun,
    triggerStreamEvents,
    buildSnapshot,
  };
}

function flushPromises(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

describe('E2E: Linear Flow — 3 steps with ExecutionCompleted', () => {
  it('start → drainQueue → callGrpcRun → stream events → completion', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'step-a', iteration: 0, payload: {} },
      { event_type: 'NodeCompleted', node_id: 'step-a', iteration: 0, payload: { output: 'result-a' } },
      { event_type: 'NodeStarted', node_id: 'step-b', iteration: 0, payload: {} },
      { event_type: 'NodeCompleted', node_id: 'step-b', iteration: 0, payload: { output: 'result-b' } },
      { event_type: 'NodeStarted', node_id: 'step-c', iteration: 0, payload: {} },
      { event_type: 'NodeCompleted', node_id: 'step-c', iteration: 0, payload: { output: 'result-c' } },
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);

    await ctx.service.start('flow-1', 'owner-1', { input: 'data' });
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.mockRun).toHaveBeenCalledTimes(1);
    const runArgs = ctx.mockRun.mock.calls[0][0];
    expect(runArgs.execution_id).toBe('exec-e2e');
    expect(runArgs.flow_id).toBe('flow-1');
    expect(runArgs.owner_id).toBe('owner-1');
    expect(runArgs.snapshot).toBeDefined();
    expect(runArgs.input_context).toBeDefined();

    expect(ctx.streamEvents.emitExecutionStart).toHaveBeenCalledWith('exec-e2e', 'flow-1', 'owner-1', expect.objectContaining({ executionMode: 'live' }));
    expect(ctx.streamEvents.emitStepStart).toHaveBeenCalledTimes(3);
    expect(ctx.streamEvents.emitStepComplete).toHaveBeenCalledTimes(3);
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'completed');
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledTimes(1);
    expect(ctx.executionModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'exec-e2e' }),
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('passes input_context as a gRPC Struct to the runtime', async () => {
    const ctx = await createE2EService([
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);
    ctx.buildSnapshot.workspaces = ['workspace-1'];

    await ctx.service.start('flow-1', 'owner-1', { items: [1, 2, 3], nested: { key: 'val' } });
    await ctx.triggerStreamEvents();
    await flushPromises();

    const inputContext = ctx.mockRun.mock.calls[0][0].input_context;
    expect(inputContext).toHaveProperty('fields');
    expect(typeof inputContext.fields).toBe('object');
    expect(inputContext.fields.__playbook_workspace_ids).toEqual({
      kind: 'listValue',
      listValue: { values: [{ kind: 'stringValue', stringValue: 'workspace-1' }] },
    });
  });

  it('preserves node description in runtime metadata for Python prompt construction', async () => {
    const ctx = await createE2EService([
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);
    ctx.buildSnapshot.nodes = [{
      id: 'step-1',
      kind: 'step',
      label: 'Write summary',
      description: 'Summarize the uploaded documents for leadership.',
      taskTemplateId: 'template-1',
      metadata: { assignedAgentId: 'agent-1' },
    }];

    await ctx.service.start('flow-1', 'owner-1', { source: 'upload' });
    await ctx.triggerStreamEvents();
    await flushPromises();

    const runtimeNode = ctx.mockRun.mock.calls[0][0].snapshot.nodes[0];
    expect(runtimeNode.metadata.fields.description.stringValue).toBe('Summarize the uploaded documents for leadership.');
  });

  it('emits step start, token update, and step complete for streamed tokens', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 0, payload: {} },
      { event_type: 'NodeToken', node_id: 'step-1', iteration: 0, payload: { token: 'Hel' } },
      { event_type: 'NodeToken', node_id: 'step-1', iteration: 0, payload: { token: 'lo' } },
      { event_type: 'NodeCompleted', node_id: 'step-1', iteration: 0, payload: { output: 'Hello' } },
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitStepStart).toHaveBeenCalledWith('exec-e2e', 'step-1');
    expect(ctx.streamEvents.emitStepUpdate).toHaveBeenCalledTimes(2);
    expect(ctx.streamEvents.emitStepComplete).toHaveBeenCalledWith('exec-e2e', 'step-1', 'Hello', undefined, 0, undefined, undefined, expect.any(Object));
  });

  it('handles NodeToken when token is empty string without emitting', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 0, payload: {} },
      { event_type: 'NodeToken', node_id: 'step-1', iteration: 0, payload: { token: '' } },
      { event_type: 'NodeCompleted', node_id: 'step-1', iteration: 0, payload: { output: 'done' } },
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitStepUpdate).not.toHaveBeenCalled();
    expect(ctx.streamEvents.emitStepComplete).toHaveBeenCalledWith('exec-e2e', 'step-1', 'done', undefined, 0, undefined, undefined, expect.any(Object));
  });
});

describe('E2E: Router Loop — multiple iterations', () => {
  it('handles 3 router loop iterations before completing', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 0, payload: {} },
      { event_type: 'NodeCompleted', node_id: 'step-1', iteration: 0, payload: { output: 'loop-1' } },
      { event_type: 'RouterDecision', node_id: 'router-1', iteration: 0, payload: { label: 'continue' } },
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 1, payload: {} },
      { event_type: 'NodeCompleted', node_id: 'step-1', iteration: 1, payload: { output: 'loop-2' } },
      { event_type: 'RouterDecision', node_id: 'router-1', iteration: 1, payload: { label: 'continue' } },
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 2, payload: {} },
      { event_type: 'NodeCompleted', node_id: 'step-1', iteration: 2, payload: { output: 'loop-3' } },
      { event_type: 'RouterDecision', node_id: 'router-1', iteration: 2, payload: { label: 'exit' } },
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitRouterDecision).toHaveBeenCalledTimes(3);
    expect(ctx.streamEvents.emitRouterDecision).toHaveBeenNthCalledWith(1, 'exec-e2e', 'router-1', 'continue', 0);
    expect(ctx.streamEvents.emitRouterDecision).toHaveBeenNthCalledWith(2, 'exec-e2e', 'router-1', 'continue', 1);
    expect(ctx.streamEvents.emitRouterDecision).toHaveBeenNthCalledWith(3, 'exec-e2e', 'router-1', 'exit', 2);
    expect(ctx.routerDecisionModel.create).toHaveBeenCalledTimes(3);
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'completed');
    expect(ctx.streamEvents.emitStepStart).toHaveBeenCalledTimes(3);
  });
});

describe('E2E: Error Recovery via __error__ routing', () => {
  it('NodeFailed → RouterDecision(__error__) → execution failed', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 0, payload: {} },
      { event_type: 'NodeFailed', node_id: 'step-1', iteration: 0, payload: { error: 'Something broke' } },
      { event_type: 'RouterDecision', node_id: 'router-1', iteration: 0, payload: { label: '__error__' } },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitStepComplete).toHaveBeenCalledWith('exec-e2e', 'step-1', undefined, 'Something broke', 0);
    expect(ctx.streamEvents.emitRouterDecision).toHaveBeenCalledWith('exec-e2e', 'router-1', '__error__', 0);
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'failed', 'Router router-1 returned __error__');
    expect(ctx.executionModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'exec-e2e' }),
      expect.objectContaining({ status: 'failed', error: 'Router router-1 returned __error__' }),
    );
  });

  it('NodeFailed stores error without marking execution failed', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 0, payload: {} },
      { event_type: 'NodeFailed', node_id: 'step-1', iteration: 0, payload: { error: 'Retryable' } },
      { event_type: 'NodeStarted', node_id: 'step-2', iteration: 0, payload: {} },
      { event_type: 'NodeCompleted', node_id: 'step-2', iteration: 0, payload: { output: 'recovered' } },
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'completed');
    expect(ctx.executionModel.updateOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ _id: 'exec-e2e' }),
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('handles ExecutionFailed event and marks execution as failed', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 0, payload: {} },
      { event_type: 'ExecutionFailed', node_id: '', iteration: 0, payload: { error: 'Unrecoverable failure' } },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'failed', 'Unrecoverable failure');
    expect(ctx.executionModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'exec-e2e' }),
      expect.objectContaining({ status: 'failed', error: 'Unrecoverable failure' }),
    );
  });
});

describe('E2E: Human-in-the-Loop — approval and resume', () => {
  it('enters pending_approval when ApprovalRequested received', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'approval-1', iteration: 0, payload: {} },
      { event_type: 'ApprovalRequested', node_id: 'approval-1', iteration: 0, payload: { prompt: 'Approve this?' } },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.executionModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'exec-e2e' }),
      expect.objectContaining({ status: 'pending_approval' }),
    );
    expect(ctx.streamEvents.emitInterrupt).toHaveBeenCalledWith(
      'exec-e2e', 'approval-1', 'Approve this?', 0, 'exec-e2e',
      { interruptType: 'approval_request', resumableActions: ['approve', 'reject'] },
    );
  });

  it('persists clarification metadata when NodeSuspended is received', async () => {
    const ctx = await createE2EService([
      {
        event_type: 'NodeSuspended',
        node_id: 'task-1',
        iteration: 1,
        payload: {
          type: 'clarification',
          message: 'Which country should I analyze?',
          interrupt_id: 'task-1:clarification:1',
          task_title: 'GDP Analysis',
          task_description: 'Analyze GDP for a country and year',
          result: '',
          conversation_json: '[]',
          resumable_actions: ['reply', 'skip'],
          blocker_rule_id: 'rule-1',
          blocker_kind: 'missing_required_input',
          reason_code: 'missing_required_input',
          risk_level: 'medium',
          confidence: 1,
          downstream_node_ids: ['task-2'],
          feedback_scope_default: 'downstream_run',
        },
      },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.executionModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'exec-e2e' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'pending_approval',
          pendingApproval: expect.objectContaining({
            nodeId: 'task-1',
            iteration: 1,
            prompt: 'Which country should I analyze?',
            interruptType: 'clarification',
            interruptId: 'task-1:clarification:1',
            taskTitle: 'GDP Analysis',
            taskDescription: 'Analyze GDP for a country and year',
            payloadJson: '[]',
            resumableActions: ['reply', 'skip'],
            blockerRuleId: 'rule-1',
            blockerKind: 'missing_required_input',
            reasonCode: 'missing_required_input',
            riskLevel: 'medium',
            confidence: 1,
            downstreamNodeIds: ['task-2'],
            feedbackScopeDefault: 'downstream_run',
            interruptPayload: expect.objectContaining({ reason_code: 'missing_required_input' }),
          }),
        }),
      }),
    );
  });

  it('resumeApproval clears pendingApproval only after gRPC ResumeApproval succeeds', async () => {
    const execDoc = {
      id: 'exec-hum-1',
      _id: 'exec-hum-1',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'approval-1', iteration: 0, prompt: 'Approve?' },
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-hum-1', status: 'running' }),
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const mockResumeApproval = jest.fn((_req, cb) => cb(null, { resumed: true }));

    const ctx = await createE2EService(undefined, { executionModel });
    (ctx.service as any).playbookFlowClient.ResumeApproval = mockResumeApproval;

    const result = await ctx.service.resumeApproval('exec-hum-1', 'owner-1', { decision: 'approved' });

    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-hum-1', status: 'pending_approval' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'running', pendingApproval: null }),
      }),
      expect.objectContaining({ arrayFilters: expect.any(Array) }),
    );
    expect(mockResumeApproval).toHaveBeenCalled();
    const grpcArgs = mockResumeApproval.mock.calls[0];
    expect(grpcArgs[0].execution_id).toBe('exec-hum-1');
    expect(grpcArgs[0].decision).toBe('approved');
    expect(result.status).toBe('running');
  });

  it('keeps pendingApproval when the runtime reports resume=false', async () => {
    const execDoc = {
      id: 'exec-hum-2',
      _id: 'exec-hum-2',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'approval-1', iteration: 0, prompt: 'Approve?' },
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-hum-2', status: 'pending_approval' }),
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const mockResumeApproval = jest.fn((_req, cb) => cb(null, { resumed: false }));

    const ctx = await createE2EService(undefined, { executionModel });
    (ctx.service as any).playbookFlowClient.ResumeApproval = mockResumeApproval;

    await expect(
      ctx.service.resumeApproval('exec-hum-2', 'owner-1', { decision: 'approved' }),
    ).rejects.toThrow('could not be resumed');

    expect(execDoc.pendingApproval).toEqual({ nodeId: 'approval-1', iteration: 0, prompt: 'Approve?' });
    expect(execDoc.status).toBe('pending_approval');
    expect(execDoc.save).not.toHaveBeenCalled();
  });

  it('returns the latest terminal execution state if resume loses the race to completion', async () => {
    const execDoc = {
      id: 'exec-hum-3',
      _id: 'exec-hum-3',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'approval-1', iteration: 0, prompt: 'Approve?' },
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-hum-3', status: 'running' }),
    };
    const latestExecDoc = {
      id: 'exec-hum-3',
      _id: 'exec-hum-3',
      ownerId: 'owner-1',
      status: 'completed',
      toJSON: jest.fn().mockReturnValue({ id: 'exec-hum-3', status: 'completed' }),
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn()
        .mockResolvedValueOnce(execDoc)
        .mockResolvedValueOnce(latestExecDoc),
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
    };
    const mockResumeApproval = jest.fn((_req, cb) => cb(null, { resumed: true }));

    const ctx = await createE2EService(undefined, { executionModel });
    (ctx.service as any).playbookFlowClient.ResumeApproval = mockResumeApproval;

    const result = await ctx.service.resumeApproval('exec-hum-3', 'owner-1', { decision: 'approved' });

    expect(result.status).toBe('completed');
    expect(execDoc.save).not.toHaveBeenCalled();
  });

  it('resumeFromStep clears pendingApproval only after gRPC ResumeFromStep succeeds', async () => {
    const execDoc = {
      id: 'exec-step-1',
      _id: 'exec-step-1',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'task-1', iteration: 2, prompt: 'Approve?' },
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-step-1', status: 'running' }),
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const mockResumeFromStep = jest.fn((_req, cb) => cb(null, { resumed: true }));

    const ctx = await createE2EService(undefined, { executionModel });
    (ctx.service as any).playbookFlowClient.ResumeFromStep = mockResumeFromStep;

    const result = await ctx.service.resumeFromStep('exec-step-1', 'owner-1', { taskId: 'task-1', action: 'approve' });

    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-step-1', status: 'pending_approval' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'running', pendingApproval: null }),
      }),
      expect.objectContaining({ arrayFilters: expect.any(Array) }),
    );
    expect(mockResumeFromStep).toHaveBeenCalled();
    const grpcArgs = mockResumeFromStep.mock.calls[0];
    expect(grpcArgs[0]).toMatchObject({
      execution_id: 'exec-step-1',
      node_id: 'task-1',
      iteration: 2,
      interrupt_id: '',
      action: 'approve',
    });
    expect(result.status).toBe('running');
  });

  it('resumeFromStep rejects when the pending step does not match', async () => {
    const execDoc = {
      id: 'exec-step-2',
      _id: 'exec-step-2',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'task-1', iteration: 0, prompt: 'Approve?' },
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-step-2', status: 'pending_approval' }),
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(execDoc),
    };

    const ctx = await createE2EService(undefined, { executionModel });

    await expect(
      ctx.service.resumeFromStep('exec-step-2', 'owner-1', { taskId: 'task-2', action: 'approve' }),
    ).rejects.toThrow('different step interrupt');
  });

  it('throws if resuming an execution that is not pending_approval', async () => {
    const execDoc = {
      id: 'exec-nope',
      _id: 'exec-nope',
      ownerId: 'owner-1',
      status: 'running',
      save: jest.fn(),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-nope', status: 'running' }),
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const ctx = await createE2EService(undefined, { executionModel });

    await expect(
      ctx.service.resumeApproval('exec-nope', 'owner-1', { decision: 'approved' }),
    ).rejects.toThrow('No pending approval');
  });
});

describe('E2E: Cancel', () => {
  it('cancels a running execution and waits for the runtime to release the slot', async () => {
    const execDoc: Record<string, any> = {
      id: 'exec-run-1',
      _id: 'exec-run-1',
      ownerId: 'owner-1',
      status: 'running',
      pendingApproval: { nodeId: 'step-1', interruptId: 'int-1', prompt: 'Clarify?' },
      hitlEvents: [{ interruptId: 'int-1', status: 'pending' }],
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-run-1', status: 'cancelled' }),
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const mockCancel = jest.fn();
    const queueService = {
      admit: jest.fn().mockResolvedValue(1),
      release: jest.fn(),
      refreshPositions: jest.fn().mockResolvedValue([]),
      getRunningCount: jest.fn().mockResolvedValue(0),
    };
    const ctx = await createE2EService(undefined, { executionModel, queueService });
    (ctx.service as any).playbookFlowClient.Cancel = mockCancel;

    const result = await ctx.service.cancel('exec-run-1', 'owner-1');

    expect(execDoc.status).toBe('cancelled');
    expect(execDoc.pendingApproval).toBeNull();
    expect(execDoc.hitlEvents[0]).toEqual(expect.objectContaining({
      interruptId: 'int-1',
      status: 'cancelled',
      respondedAt: expect.any(Date),
    }));
    expect(execDoc.endedAt).toBeInstanceOf(Date);
    expect(execDoc.save).toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalledWith(
      { execution_id: 'exec-run-1' },
      expect.any(Function),
    );
    expect(queueService.release).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });

  it('rejects cancel for already completed execution', async () => {
    const execDoc = {
      id: 'exec-done',
      _id: 'exec-done',
      ownerId: 'owner-1',
      status: 'completed',
      save: jest.fn(),
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const ctx = await createE2EService(undefined, { executionModel });

    await expect(ctx.service.cancel('exec-done', 'owner-1')).rejects.toThrow('already finished');
  });

  it('rejects cancel for non-existent execution', async () => {
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(null),
    };
    const ctx = await createE2EService(undefined, { executionModel });

    await expect(ctx.service.cancel('exec-none', 'owner-1')).rejects.toThrow('not found');
  });

  it('rejects cancel for wrong owner', async () => {
    const execDoc = {
      id: 'exec-other',
      _id: 'exec-other',
      ownerId: 'owner-2',
      status: 'running',
    };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const ctx = await createE2EService(undefined, { executionModel });

    await expect(ctx.service.cancel('exec-other', 'owner-1')).rejects.toThrow('not found');
  });
});

describe('E2E: Delete', () => {
  it('deletes execution with associated records', async () => {
    const ctx = await createE2EService();
    const taskResultModel = { deleteMany: jest.fn() };
    const routerDecisionModel = { deleteMany: jest.fn() };
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
        ownerId: 'owner-1',
        status: 'completed',
      })),
    };
    (ctx.service as any).executionModel = executionModel;
    (ctx.service as any).taskResultModel = taskResultModel;
    (ctx.service as any).routerDecisionModel = routerDecisionModel;

    await ctx.service.delete('exec-to-delete', 'owner-1');

    expect(taskResultModel.deleteMany).toHaveBeenCalledWith({ executionId: 'exec-to-delete' });
    expect(routerDecisionModel.deleteMany).toHaveBeenCalledWith({ executionId: 'exec-to-delete' });
    expect(executionModel.findByIdAndDelete).toHaveBeenCalledWith('exec-to-delete');
  });

  it('rejects delete for running execution', async () => {
    const executionModel = {
      ...mockExecutionModel(),
      findById: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
        ownerId: 'owner-1',
        status: 'running',
      })),
    };
    const ctx = await createE2EService(undefined, { executionModel });

    await expect(ctx.service.delete('exec-running', 'owner-1')).rejects.toThrow('Cancel it first');
  });
});

describe('E2E: Queue maintenance after terminal events', () => {
  it('drains queue after __cancelled__ router decision emits drainQueue', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeStarted', node_id: 'step-1', iteration: 0, payload: {} },
      { event_type: 'RouterDecision', node_id: 'router-1', iteration: 0, payload: { label: '__cancelled__' } },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith(
      'exec-e2e', 'cancelled', 'Router router-1 returned __cancelled__',
    );
  });

  it('drains queue after ExecutionFailed', async () => {
    const ctx = await createE2EService([
      { event_type: 'ExecutionFailed', node_id: '', iteration: 0, payload: { error: 'Fatal' } },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'failed', 'Fatal');
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledTimes(1);
  });

  it('starts the next queued execution after the current one reaches a terminal state', async () => {
    const queueService = {
      admit: jest.fn().mockResolvedValue(1),
      release: jest.fn()
        .mockResolvedValueOnce({ id: 'exec-e2e', flowId: 'flow-1', ownerId: 'owner-1', inputContext: {}, snapshot: { nodes: [], controlEdges: [], dataBindings: [], settings: { recursionLimit: 25, maxParallelism: 5 } } })
        .mockResolvedValueOnce({ id: 'exec-next', flowId: 'flow-2', ownerId: 'owner-1', inputContext: {}, snapshot: { nodes: [], controlEdges: [], dataBindings: [], settings: { recursionLimit: 25, maxParallelism: 5 } } })
        .mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([]),
      getRunningCount: jest.fn().mockResolvedValue(0),
    };
    const ctx = await createE2EService([
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ], { queueService });

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.mockRun).toHaveBeenCalledTimes(2);
  });
});

describe('E2E: Edge cases', () => {
  it('handles gRPC stream error by failing the execution', async () => {
    const errHandlers: Record<string, (data?: unknown) => void> = {};
    let errMockCall: { on: jest.Mock };
    const errMockOn = jest.fn((event: string, handler: (data?: unknown) => void) => {
      errHandlers[event] = handler;
      return errMockCall;
    });
    errMockCall = { on: errMockOn };
    const mockRun = jest.fn().mockReturnValue(errMockCall);

    const ctx = await createE2EService(undefined, {});
    (ctx.service as any).playbookFlowClient = { Run: mockRun };

    await ctx.service.start('flow-1', 'owner-1', {});
    await flushPromises();

    errHandlers.error(new Error('gRPC connection lost'));
    await flushPromises();

    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'failed', 'gRPC connection lost');
  });

  it('handles empty event payload gracefully', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeCompleted', node_id: 'step-1', iteration: 0, payload: {} },
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitStepComplete).toHaveBeenCalledWith(
      'exec-e2e',
      'step-1',
      expect.any(String),
      undefined,
      0,
      undefined,
      undefined,
      expect.any(Object),
    );
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'completed');
  });

  it('marks execution failed when a node fails and the runtime ends without recovery', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeFailed', node_id: 'step-1', iteration: 0, payload: { error: 'Unrecoverable' } },
    ]);
    ctx.taskResultModel.findOne = jest.fn(() => ({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ error: 'Unrecoverable' }),
    }));
    (ctx.service as any).taskResultModel = ctx.taskResultModel;

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'failed', 'Unrecoverable');
    expect(ctx.executionModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'exec-e2e' }),
      expect.objectContaining({ status: 'failed', error: 'Unrecoverable' }),
    );
  });

  it('handles RouterDecision with missing payload label', async () => {
    const ctx = await createE2EService([
      { event_type: 'RouterDecision', node_id: 'router-1', iteration: 0, payload: {} },
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.routerDecisionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ routerNodeId: 'router-1', label: '' }),
    );
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'completed');
  });
});
