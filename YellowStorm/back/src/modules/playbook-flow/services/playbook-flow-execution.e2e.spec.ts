import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { PlaybookExecutionHitlResumeService } from '../execution/runtime/playbook-execution-hitl-resume.service';
import { PlaybookExecutionSingleStepPrepService } from '../execution/runtime/playbook-execution-single-step-prep.service';
import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowReplayDriftService } from './playbook-flow-replay-drift.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';
import {
  createExecutionRepositoryMock,
  createRouterDecisionRepositoryMock,
  createTaskResultRepositoryMock,
} from './playbook-flow-execution.test-support';

const OPEN_STATUSES = ['queued', 'running', 'pending_approval'];

/** The run the E2E flows start: inserted as exec-e2e, read back without a snapshot (the drain loads the flow). */
function mockExecutionRepository(overrides?: Record<string, any>) {
  return createExecutionRepositoryMock({
    insert: jest.fn(async (input: Record<string, unknown>) => ({
      id: 'exec-e2e',
      status: 'queued',
      queuePosition: 0,
      pendingApproval: null,
      hitlEvents: [],
      ...input,
    })),
    findById: jest.fn().mockResolvedValue({ id: 'exec-e2e', ownerId: 'owner-1', inputContext: {} }),
    ...overrides,
  });
}

interface E2EContext {
  service: PlaybookFlowExecutionService;
  executionRepository: Record<string, any>;
  taskResultRepository: Record<string, any>;
  queueService: Record<string, any>;
  flowService: Record<string, any>;
  streamEvents: Record<string, any>;
  routerDecisionRepository: Record<string, any>;
  mockRun: jest.Mock;
  triggerStreamEvents: () => Promise<void>;
  buildSnapshot: Record<string, any>;
}

async function createE2EService(
  streamEventsSequence?: { event_type: string; node_id?: string; iteration?: number; payload?: Record<string, unknown> }[],
  overrides?: {
    executionRepository?: Record<string, any>;
    taskResultRepository?: Record<string, any>;
    queueService?: Record<string, any>;
    flowService?: Record<string, any>;
    configService?: Record<string, any>;
    idempotencyService?: Record<string, any>;
    builderService?: Record<string, any>;
    accessService?: Record<string, any>;
  },
): Promise<E2EContext> {
  const settleAsyncHandlers = async (cycles = 4) => {
    for (let i = 0; i < cycles; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
  };

  const waitFor = async (predicate: () => boolean, maxCycles = 40) => {
    for (let i = 0; i < maxCycles; i += 1) {
      if (predicate()) {
        return;
      }
      await new Promise((r) => setImmediate(r));
    }
  };

  const executionRepository = mockExecutionRepository(overrides?.executionRepository);
  const taskResultRepository = createTaskResultRepositoryMock(overrides?.taskResultRepository);
  const routerDecisionRepository = createRouterDecisionRepositoryMock();

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
    findOneForExecutionStart: jest.fn().mockResolvedValue({
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
    collectValidationErrors: jest.fn().mockReturnValue([]),
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
    executionRepository as any,
    replayReportService as any,
    outputContractService,
    new PlaybookFlowReplayPlanService(),
    { setContext: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any,
  );
  const accessService = {
    assertExecutionAccess: jest.fn().mockRejectedValue(
      new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow'),
    ),
    ...overrides?.accessService,
  };

  const hitlResumeService = new PlaybookExecutionHitlResumeService(
    executionRepository as any,
    streamEvents as any,
    undefined,
    accessService as any,
  );

  const singleStepPrepService = new PlaybookExecutionSingleStepPrepService(
    executionRepository as any,
    taskResultRepository as any,
  );

  const service = new PlaybookFlowExecutionService(
    executionRepository as any,
    taskResultRepository as any,
    routerDecisionRepository as any,
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
      replayReportService as any,
      outputContractService as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
      undefined as any,
      new PlaybookFlowReplayPlanService() as any,
      replayDriftService as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      accessService as any,
      hitlResumeService,
      singleStepPrepService,
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
    executionRepository,
    taskResultRepository,
    queueService,
    flowService,
    streamEvents,
    routerDecisionRepository,
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
    expect(ctx.executionRepository.insert).toHaveBeenCalledWith(expect.objectContaining({
      flowId: 'flow-1', ownerId: 'owner-1', status: 'queued', inputContext: { input: 'data' }, executionMode: 'live',
    }));
    expect(ctx.executionRepository.markStarted).toHaveBeenCalledWith('exec-e2e', {});
    expect(ctx.executionRepository.transition).toHaveBeenCalledWith('exec-e2e', {
      from: OPEN_STATUSES,
      patch: expect.objectContaining({ status: 'completed' }),
    });
    expect(ctx.taskResultRepository.updateManyForExecution).toHaveBeenCalledWith(
      'exec-e2e', { statuses: ['pending', 'running', 'interrupted'] }, { status: 'completed' },
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
    expect(ctx.streamEvents.emitStepUpdate).toHaveBeenCalledTimes(1);
    expect(ctx.streamEvents.emitStepUpdate).toHaveBeenCalledWith('exec-e2e', 'step-1', 'Hello');
    expect(ctx.streamEvents.emitStepComplete).toHaveBeenCalledWith('exec-e2e', 'step-1', 'Hello', undefined, 0, [], [], expect.any(Object));
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
    expect(ctx.streamEvents.emitStepComplete).toHaveBeenCalledWith('exec-e2e', 'step-1', 'done', undefined, 0, [], [], expect.any(Object));
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
    expect(ctx.routerDecisionRepository.create).toHaveBeenCalledTimes(3);
    expect(ctx.routerDecisionRepository.create).toHaveBeenNthCalledWith(3, expect.objectContaining({
      executionId: 'exec-e2e', routerNodeId: 'router-1', iteration: 2, label: 'exit',
    }));
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
    expect(ctx.executionRepository.transition).toHaveBeenCalledWith('exec-e2e', {
      from: OPEN_STATUSES,
      patch: expect.objectContaining({ status: 'failed', error: 'Router router-1 returned __error__' }),
    });
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
    expect(ctx.executionRepository.transition).toHaveBeenLastCalledWith('exec-e2e', {
      from: OPEN_STATUSES,
      patch: expect.objectContaining({ status: 'completed' }),
    });
    expect(ctx.taskResultRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-e2e', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({ status: 'failed', error: 'Retryable' }),
      expect.any(Object),
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
    expect(ctx.executionRepository.transition).toHaveBeenCalledWith('exec-e2e', {
      from: OPEN_STATUSES,
      patch: expect.objectContaining({ status: 'failed', error: 'Unrecoverable failure' }),
    });
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

    expect(ctx.executionRepository.setPendingApproval).toHaveBeenCalledWith('exec-e2e', expect.objectContaining({
      nodeId: 'approval-1', iteration: 0, prompt: 'Approve this?', interruptType: 'approval_request',
    }));
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

    expect(ctx.executionRepository.isInterruptStale).toHaveBeenCalledWith('exec-e2e', 'task-1:clarification:1');
    expect(ctx.taskResultRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-e2e', taskId: 'task-1', iteration: 1 },
      { status: 'interrupted' },
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );
    expect(ctx.executionRepository.setPendingApproval).toHaveBeenCalledWith(
      'exec-e2e',
      expect.objectContaining({
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
      expect.objectContaining({
        nodeId: 'task-1',
        iteration: 1,
        interruptId: 'task-1:clarification:1',
        type: 'clarification',
        reasonCode: 'missing_required_input',
        status: 'pending',
        downstreamNodeIds: ['task-2'],
      }),
    );
  });

  it('resumeApproval clears pendingApproval only after gRPC ResumeApproval succeeds', async () => {
    const execDoc = {
      id: 'exec-hum-1',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'approval-1', iteration: 0, prompt: 'Approve?' },
      hitlEvents: [],
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const mockResumeApproval = jest.fn((_req, cb) => cb(null, { resumed: true }));

    const ctx = await createE2EService(undefined, { executionRepository });
    (ctx.service as any).playbookFlowClient.ResumeApproval = mockResumeApproval;

    const result = await ctx.service.resumeApproval('exec-hum-1', 'owner-1', { decision: 'approved' });

    expect(ctx.executionRepository.transition).toHaveBeenCalledWith('exec-hum-1', {
      from: ['pending_approval'],
      pendingApproval: { nodeId: 'approval-1', iteration: 0 },
      patch: { status: 'running' },
    });
    expect(ctx.executionRepository.answerHitlEvent).toHaveBeenCalledWith('exec-hum-1', {
      from: ['running'],
      pendingApproval: { nodeId: 'approval-1', iteration: 0 },
      interruptId: '',
      response: { action: 'approved' },
      patch: { status: 'running', pendingApproval: null },
    });
    expect(ctx.executionRepository.transition.mock.invocationCallOrder[0]).toBeLessThan(mockResumeApproval.mock.invocationCallOrder[0]);
    expect(mockResumeApproval.mock.invocationCallOrder[0]).toBeLessThan(ctx.executionRepository.answerHitlEvent.mock.invocationCallOrder[0]);
    expect(mockResumeApproval).toHaveBeenCalled();
    const grpcArgs = mockResumeApproval.mock.calls[0];
    expect(grpcArgs[0].execution_id).toBe('exec-hum-1');
    expect(grpcArgs[0].decision).toBe('approved');
    expect(result.status).toBe('running');
  });

  it.each([
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ])('routes a human approval %s action through ResumeApproval', async (action, decision) => {
    const execDoc = {
      id: 'exec-approval-node', flowId: 'flow-1', ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'approval-1', iteration: 0, interruptId: 'interrupt-1', prompt: 'Approve?' },
      hitlEvents: [],
      snapshot: { nodes: [{ id: 'approval-1', kind: 'human_approval' }] },
    };
    const executionRepository = { findById: jest.fn().mockResolvedValue(execDoc) };
    const ctx = await createE2EService(undefined, { executionRepository });
    const resumeApproval = jest.fn((_req, cb) => cb(null, { resumed: true }));
    const resumeFromStep = jest.fn();
    (ctx.service as any).playbookFlowClient.ResumeApproval = resumeApproval;
    (ctx.service as any).playbookFlowClient.ResumeFromStep = resumeFromStep;

    await ctx.service.resumeFromStep('exec-approval-node', 'owner-1', {
      taskId: 'approval-1', interruptId: 'interrupt-1', action, scope: 'step_only',
    });

    expect(resumeApproval).toHaveBeenCalledWith(expect.objectContaining({
      decision, payload: expect.any(Object),
    }), expect.any(Function));
    expect(resumeFromStep).not.toHaveBeenCalled();
  });

  it('rejects a non-decision action for a human approval node', async () => {
    const execDoc = {
      id: 'exec-approval-node', ownerId: 'owner-1', status: 'pending_approval',
      pendingApproval: { nodeId: 'approval-1', iteration: 0 },
      snapshot: { nodes: [{ id: 'approval-1', kind: 'human_approval' }] },
    };
    const ctx = await createE2EService(undefined, {
      executionRepository: { findById: jest.fn().mockResolvedValue(execDoc) },
    });
    const resumeFromStep = jest.fn();
    (ctx.service as any).playbookFlowClient.ResumeFromStep = resumeFromStep;

    await expect(ctx.service.resumeFromStep('exec-approval-node', 'owner-1', {
      taskId: 'approval-1', action: 'skip', approved: true,
    })).rejects.toThrow('Approval decision must be approved or rejected');
    expect(resumeFromStep).not.toHaveBeenCalled();
  });

  it('keeps pendingApproval when the runtime reports resume=false', async () => {
    const execDoc = {
      id: 'exec-hum-2',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'approval-1', iteration: 0, prompt: 'Approve?' },
      hitlEvents: [],
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const mockResumeApproval = jest.fn((_req, cb) => cb(null, { resumed: false }));

    const ctx = await createE2EService(undefined, { executionRepository });
    (ctx.service as any).playbookFlowClient.ResumeApproval = mockResumeApproval;

    await expect(
      ctx.service.resumeApproval('exec-hum-2', 'owner-1', { decision: 'approved' }),
    ).rejects.toThrow('could not be resumed');

    expect(execDoc.pendingApproval).toEqual({ nodeId: 'approval-1', iteration: 0, prompt: 'Approve?' });
    expect(execDoc.status).toBe('pending_approval');
    expect(ctx.executionRepository.answerHitlEvent).not.toHaveBeenCalled();
    // The claim is given back: the run waits on the same approval again.
    expect(ctx.executionRepository.transition).toHaveBeenLastCalledWith('exec-hum-2', {
      from: ['running'],
      pendingApproval: { nodeId: 'approval-1', iteration: 0 },
      patch: { status: 'pending_approval' },
    });
  });

  it('returns the latest terminal execution state if resume loses the race to completion', async () => {
    const execDoc = {
      id: 'exec-hum-3',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'approval-1', iteration: 0, prompt: 'Approve?' },
      hitlEvents: [],
    };
    const latestExecDoc = {
      id: 'exec-hum-3',
      ownerId: 'owner-1',
      status: 'completed',
      pendingApproval: null,
      hitlEvents: [],
    };
    const executionRepository = {
      findById: jest.fn()
        .mockResolvedValueOnce(execDoc)
        .mockResolvedValueOnce(latestExecDoc),
      transition: jest.fn().mockResolvedValue(false),
      answerHitlEvent: jest.fn().mockResolvedValue(false),
    };
    const mockResumeApproval = jest.fn((_req, cb) => cb(null, { resumed: true }));

    const ctx = await createE2EService(undefined, { executionRepository });
    (ctx.service as any).playbookFlowClient.ResumeApproval = mockResumeApproval;

    const result = await ctx.service.resumeApproval('exec-hum-3', 'owner-1', { decision: 'approved' });

    expect(result.status).toBe('completed');
    expect(mockResumeApproval).not.toHaveBeenCalled();
    expect(ctx.executionRepository.answerHitlEvent).not.toHaveBeenCalled();
  });

  it('allows only one concurrent approval request to call the runtime', async () => {
    const execDoc = {
      id: 'exec-hum-race',
      flowId: 'flow-1',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: {
        nodeId: 'approval-1',
        iteration: 0,
        interruptId: 'approval-race-1',
        prompt: 'Approve?',
      },
      hitlEvents: [],
    };
    let claimed = false;
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
      // The conditional claim (pending_approval -> running on this approval) holds for one caller only.
      transition: jest.fn(async (_id: string, change: { from?: string[]; patch: { status?: string } }) => {
        const isClaim = change.from?.includes('pending_approval') && change.patch.status === 'running';
        if (!isClaim) return true;
        if (claimed) return false;
        claimed = true;
        return true;
      }),
    };
    const mockResumeApproval = jest.fn((_req, cb) => {
      setTimeout(() => cb(null, { resumed: true }), 5);
    });
    const ctx = await createE2EService(undefined, { executionRepository });
    (ctx.service as any).playbookFlowClient.ResumeApproval = mockResumeApproval;

    await Promise.all([
      ctx.service.resumeApproval('exec-hum-race', 'owner-1', { decision: 'approved' }),
      ctx.service.resumeApproval('exec-hum-race', 'owner-1', { decision: 'approved' }),
    ]);

    expect(mockResumeApproval).toHaveBeenCalledTimes(1);
  });

  it('restores pending approval when the runtime resume call fails', async () => {
    const execDoc = {
      id: 'exec-hum-error',
      flowId: 'flow-1',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: {
        nodeId: 'approval-1',
        iteration: 0,
        interruptId: 'approval-error-1',
        prompt: 'Approve?',
      },
      hitlEvents: [],
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const ctx = await createE2EService(undefined, { executionRepository });
    (ctx.service as any).playbookFlowClient.ResumeApproval = jest.fn((_req, cb) => {
      cb(new Error('runtime unavailable'));
    });

    await expect(
      ctx.service.resumeApproval('exec-hum-error', 'owner-1', { decision: 'approved' }),
    ).rejects.toThrow('runtime unavailable');

    expect(ctx.executionRepository.transition).toHaveBeenLastCalledWith('exec-hum-error', {
      from: ['running'],
      pendingApproval: { nodeId: 'approval-1', iteration: 0, interruptId: 'approval-error-1' },
      patch: { status: 'pending_approval' },
    });
    expect(ctx.executionRepository.answerHitlEvent).not.toHaveBeenCalled();
  });

  it('resumeFromStep clears pendingApproval only after gRPC ResumeFromStep succeeds', async () => {
    const execDoc = {
      id: 'exec-step-1',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: {
        nodeId: 'task-1', iteration: 2, prompt: 'Approve?',
        interruptPayload: { request_fingerprint: 'trusted-fingerprint' },
      },
      hitlEvents: [],
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const mockResumeFromStep = jest.fn((_req, cb) => cb(null, { resumed: true }));

    const ctx = await createE2EService(undefined, { executionRepository });
    (ctx.service as any).playbookFlowClient.ResumeFromStep = mockResumeFromStep;

    const result = await ctx.service.resumeFromStep('exec-step-1', 'owner-1', {
      taskId: 'task-1', action: 'approve', payload: { request_fingerprint: 'untrusted-fingerprint' },
    });

    expect(ctx.executionRepository.answerHitlEvent).toHaveBeenCalledWith('exec-step-1', expect.objectContaining({
      from: ['pending_approval'],
      interruptId: '',
      patch: { status: 'running', pendingApproval: null },
    }));
    expect(mockResumeFromStep).toHaveBeenCalled();
    const grpcArgs = mockResumeFromStep.mock.calls[0];
    expect(grpcArgs[0]).toMatchObject({
      execution_id: 'exec-step-1',
      node_id: 'task-1',
      iteration: 2,
      interrupt_id: '',
      action: 'approve',
    });
    expect(grpcArgs[0].payload.fields.request_fingerprint.stringValue).toBe('trusted-fingerprint');
    expect(result.status).toBe('running');
  });

  it('resumeFromStep rejects when the pending step does not match', async () => {
    const execDoc = {
      id: 'exec-step-2',
      ownerId: 'owner-1',
      status: 'pending_approval',
      pendingApproval: { nodeId: 'task-1', iteration: 0, prompt: 'Approve?' },
      hitlEvents: [],
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
    };

    const ctx = await createE2EService(undefined, { executionRepository });

    await expect(
      ctx.service.resumeFromStep('exec-step-2', 'owner-1', { taskId: 'task-2', action: 'approve' }),
    ).rejects.toThrow('different step interrupt');
  });

  it('throws if resuming an execution that is not pending_approval', async () => {
    const execDoc = {
      id: 'exec-nope',
      ownerId: 'owner-1',
      status: 'running',
      pendingApproval: null,
      hitlEvents: [],
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const ctx = await createE2EService(undefined, { executionRepository });

    await expect(
      ctx.service.resumeApproval('exec-nope', 'owner-1', { decision: 'approved' }),
    ).rejects.toThrow('No pending approval');
  });
});

describe('E2E: Cancel', () => {
  it('cancels a running execution and waits for the runtime to release the slot', async () => {
    const execDoc: Record<string, any> = {
      id: 'exec-run-1',
      ownerId: 'owner-1',
      status: 'running',
      pendingApproval: { nodeId: 'step-1', interruptId: 'int-1', prompt: 'Clarify?' },
      hitlEvents: [{ interruptId: 'int-1', status: 'pending' }],
    };
    // What the repository's single conditional UPDATE returns (covered by the integration spec).
    const cancelledDoc = {
      ...execDoc,
      status: 'cancelled',
      endedAt: new Date(),
      pendingApproval: null,
      hitlEvents: [{ interruptId: 'int-1', status: 'cancelled', respondedAt: new Date() }],
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
      cancelOpen: jest.fn().mockResolvedValue(cancelledDoc),
    };
    const mockCancel = jest.fn();
    const queueService = {
      admit: jest.fn().mockResolvedValue(1),
      release: jest.fn(),
      refreshPositions: jest.fn().mockResolvedValue([]),
      getRunningCount: jest.fn().mockResolvedValue(0),
    };
    const ctx = await createE2EService(undefined, { executionRepository, queueService });
    (ctx.service as any).playbookFlowClient.Cancel = mockCancel;

    const result = await ctx.service.cancel('exec-run-1', 'owner-1');

    expect(ctx.executionRepository.cancelOpen).toHaveBeenCalledWith('exec-run-1');
    expect(ctx.taskResultRepository.updateManyForExecution).toHaveBeenCalledWith(
      'exec-run-1', { statuses: ['pending', 'running', 'interrupted'] }, { status: 'cancelled' },
    );
    expect(ctx.streamEvents.emitExecutionCancelled).toHaveBeenCalledWith('exec-run-1');
    expect(result).toEqual(expect.objectContaining({
      id: 'exec-run-1',
      status: 'cancelled',
      pendingApproval: null,
      hitlEvents: [expect.objectContaining({ interruptId: 'int-1', status: 'cancelled', respondedAt: expect.any(Date) })],
      endedAt: expect.any(Date),
    }));
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
      ownerId: 'owner-1',
      status: 'completed',
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const ctx = await createE2EService(undefined, { executionRepository });

    await expect(ctx.service.cancel('exec-done', 'owner-1')).rejects.toThrow('already finished');
    expect(ctx.executionRepository.cancelOpen).not.toHaveBeenCalled();
  });

  it('rejects cancel when the run finishes between the read and the cancellation', async () => {
    const executionRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'exec-racing', ownerId: 'owner-1', status: 'running' }),
      cancelOpen: jest.fn().mockResolvedValue(null),
    };
    const ctx = await createE2EService(undefined, { executionRepository });
    const mockCancel = jest.fn();
    (ctx.service as any).playbookFlowClient.Cancel = mockCancel;

    await expect(ctx.service.cancel('exec-racing', 'owner-1')).rejects.toThrow('already finished');
    expect(ctx.taskResultRepository.updateManyForExecution).not.toHaveBeenCalled();
    expect(ctx.streamEvents.emitExecutionCancelled).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('rejects cancel for non-existent execution', async () => {
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(null),
    };
    const ctx = await createE2EService(undefined, { executionRepository });

    await expect(ctx.service.cancel('exec-none', 'owner-1')).rejects.toThrow('not found');
  });

  it('rejects cancel for wrong owner', async () => {
    const execDoc = {
      id: 'exec-other',
      ownerId: 'owner-2',
      status: 'running',
    };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execDoc),
    };
    const ctx = await createE2EService(undefined, { executionRepository });

    await expect(ctx.service.cancel('exec-other', 'owner-1')).rejects.toThrow('do not have access');
    expect(ctx.executionRepository.cancelOpen).not.toHaveBeenCalled();
  });
});

describe('E2E: Delete', () => {
  it('deletes execution with associated records', async () => {
    const executionRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'exec-to-delete', ownerId: 'owner-1', status: 'completed' }),
    };
    const ctx = await createE2EService(undefined, { executionRepository });

    await ctx.service.delete('exec-to-delete', 'owner-1');

    // Its task results and router decisions go with it through the foreign keys.
    expect(ctx.executionRepository.delete).toHaveBeenCalledWith('exec-to-delete');
  });

  it('rejects delete for running execution', async () => {
    const executionRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'exec-running', ownerId: 'owner-1', status: 'running' }),
    };
    const ctx = await createE2EService(undefined, { executionRepository });

    await expect(ctx.service.delete('exec-running', 'owner-1')).rejects.toThrow('Cancel it first');
    expect(ctx.executionRepository.delete).not.toHaveBeenCalled();
  });

  it('hides another owner\'s execution from delete', async () => {
    const executionRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'exec-other', ownerId: 'owner-2', status: 'completed' }),
    };
    const ctx = await createE2EService(undefined, { executionRepository });

    await expect(ctx.service.delete('exec-other', 'owner-1')).rejects.toThrow('Execution not found');
    expect(ctx.executionRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes all of the owner\'s runs of a flow they own', async () => {
    const executionRepository = { deleteByFlowAndOwner: jest.fn().mockResolvedValue(4) };
    const ctx = await createE2EService(undefined, {
      executionRepository,
      flowService: { findById: jest.fn().mockResolvedValue({ id: 'flow-1', ownerId: 'owner-1' }) },
    });

    await expect(ctx.service.deleteAll('flow-1', 'owner-1')).resolves.toEqual({ deleted: 4 });
    expect(ctx.executionRepository.deleteByFlowAndOwner).toHaveBeenCalledWith('flow-1', 'owner-1');
  });

  it('refuses to delete the runs of a flow owned by someone else', async () => {
    const ctx = await createE2EService(undefined, {
      flowService: { findById: jest.fn().mockResolvedValue({ id: 'flow-1', ownerId: 'owner-2' }) },
    });

    await expect(ctx.service.deleteAll('flow-1', 'owner-1')).rejects.toThrow('Execution not found');
    expect(ctx.executionRepository.deleteByFlowAndOwner).not.toHaveBeenCalled();
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
      [],
      [],
      expect.any(Object),
    );
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'completed');
  });

  it('marks execution failed when a node fails and the runtime ends without recovery', async () => {
    const ctx = await createE2EService([
      { event_type: 'NodeFailed', node_id: 'step-1', iteration: 0, payload: { error: 'Unrecoverable' } },
    ]);
    ctx.taskResultRepository.findLatestFailed.mockResolvedValue({ error: 'Unrecoverable' });

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'failed', 'Unrecoverable');
    expect(ctx.executionRepository.transition).toHaveBeenCalledWith('exec-e2e', {
      from: OPEN_STATUSES,
      patch: expect.objectContaining({ status: 'failed', error: 'Unrecoverable' }),
    });
  });

  it('handles RouterDecision with missing payload label', async () => {
    const ctx = await createE2EService([
      { event_type: 'RouterDecision', node_id: 'router-1', iteration: 0, payload: {} },
      { event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} },
    ]);

    await ctx.service.start('flow-1', 'owner-1', {});
    await ctx.triggerStreamEvents();
    await flushPromises();

    expect(ctx.routerDecisionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'exec-e2e', routerNodeId: 'router-1', iteration: 0, label: '' }),
    );
    expect(ctx.streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-e2e', 'completed');
  });
});
