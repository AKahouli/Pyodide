import { PlaybookExecutionNodeEventHandlerService } from './playbook-execution-node-event-handler.service';

const EXECUTION_ID = '64b000000000000000000001';
const OWNER_ID = '64b000000000000000000003';
const KEY = { executionId: EXECUTION_ID, taskId: 'task-1', iteration: 0 };

function createHandler(execution: Record<string, unknown> | null = { id: EXECUTION_ID, ownerId: OWNER_ID, advisorAutopilotEnabled: false, reflectionEnabled: false, advisorScoringMode: 'llm' }) {
  const executionRepository = {
    findById: jest.fn().mockResolvedValue(execution),
    isInterruptStale: jest.fn().mockResolvedValue(false),
    setPendingApproval: jest.fn().mockResolvedValue(true),
  };
  const taskResultRepository = {
    upsert: jest.fn().mockResolvedValue(true),
    appendOutput: jest.fn().mockResolvedValue(true),
    find: jest.fn().mockResolvedValue(null),
  };
  const streamEvents = {
    emitStepStart: jest.fn(),
    emitStepUpdate: jest.fn(),
    emitStepComplete: jest.fn(),
    emitInterrupt: jest.fn(),
    emitIteratorChildStepStarted: jest.fn(),
    emitIteratorChildStepCompleted: jest.fn(),
  };
  const traceUpdate = {
    toolTrace: [{ callIndex: 0, toolName: 'search', args: {} }],
    llmPromptTrace: [{ stage: 'plan', model: 'm', prompt: 'p' }],
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'm' },
    traceMetadata: { step: 1 },
  };
  const completed = {
    output: 'final answer',
    displayText: 'final answer',
    outputs: undefined,
    artifacts: [{ id: 'a1' }],
    components: undefined,
    toolTrace: traceUpdate.toolTrace,
    reasoningChain: undefined,
    llmPromptTrace: [],
    usage: null,
    semanticMatch: null,
    traceMetadata: { publicReasoning: { markerFound: false } },
    iteratorIterations: undefined,
  };
  const observabilityService = {
    shouldRedactSensitiveText: jest.fn().mockResolvedValue(false),
    extractTraceUpdatePayload: jest.fn().mockReturnValue(traceUpdate),
    extractCompletedResultPayload: jest.fn().mockReturnValue(completed),
    toStreamPayload: jest.fn().mockReturnValue({}),
  };
  const advisorService = { runTaskEvaluation: jest.fn().mockResolvedValue(undefined) };
  const replayRuntime = {
    hasTrackedTask: jest.fn().mockReturnValue(false),
    resolveArtifactsForCompletedTask: jest.fn().mockResolvedValue(null),
  };
  const handler = new PlaybookExecutionNodeEventHandlerService(
    executionRepository as never,
    taskResultRepository as never,
    streamEvents as never,
    observabilityService as never,
    advisorService as never,
    replayRuntime as never,
  );
  return { handler, executionRepository, taskResultRepository, streamEvents, advisorService, traceUpdate };
}

describe('PlaybookExecutionNodeEventHandlerService', () => {
  it('marks a started task running, creating its row', async () => {
    const { handler, taskResultRepository, streamEvents } = createHandler();

    await handler.handleStarted(EXECUTION_ID, 'task-1', 0);

    expect(taskResultRepository.upsert).toHaveBeenCalledWith(KEY, { status: 'running', startedAt: expect.any(Date) });
    expect(streamEvents.emitStepStart).toHaveBeenCalledWith(EXECUTION_ID, 'task-1');
  });

  it('appends a streamed token to the task output atomically', async () => {
    const { handler, taskResultRepository } = createHandler();

    await handler.handleToken(EXECUTION_ID, 'task-1', 0, { token: 'Hel' });
    await handler.handleToken(EXECUTION_ID, 'task-1', 0, { token: '' });

    expect(taskResultRepository.appendOutput).toHaveBeenCalledTimes(1);
    expect(taskResultRepository.appendOutput).toHaveBeenCalledWith(KEY, 'Hel');
  });

  it('writes the trace on every update and the generated-node identity only on insert', async () => {
    const { handler, taskResultRepository, traceUpdate } = createHandler();

    await handler.handleTraceUpdate(EXECUTION_ID, 'task-1', 0, {
      parent_node_id: 'planner', runtime_subgraph_id: 'sg-1', generated_local_node_id: 'n1', generated_title: 'Search',
    });

    expect(taskResultRepository.upsert).toHaveBeenCalledWith(
      KEY,
      { toolTrace: traceUpdate.toolTrace, llmPromptTrace: traceUpdate.llmPromptTrace, usage: traceUpdate.usage, traceMetadata: traceUpdate.traceMetadata },
      { startedAt: expect.any(Date), parentTaskId: 'planner', runtimeSubgraphId: 'sg-1', generatedLocalNodeId: 'n1', generatedNodeTitle: 'Search' },
    );
  });

  it('stores the completed result, clears the error and starts the advisor when the run asks for it', async () => {
    const { handler, taskResultRepository, advisorService, streamEvents } = createHandler({
      id: EXECUTION_ID, ownerId: OWNER_ID, advisorAutopilotEnabled: true, reflectionEnabled: false, advisorScoringMode: 'heuristic',
    });

    await handler.handleCompleted(EXECUTION_ID, 'task-1', 0, { parent_node_id: 'planner', runtime_subgraph_id: 'sg-1' });

    const [key, set, setOnInsert] = taskResultRepository.upsert.mock.calls[0];
    expect(key).toEqual(KEY);
    expect(set).toEqual({
      status: 'completed',
      output: 'final answer',
      displayText: 'final answer',
      outputs: undefined,
      artifacts: [{ id: 'a1' }],
      components: undefined,
      iteratorIterations: undefined,
      toolTrace: [{ callIndex: 0, toolName: 'search', args: {} }],
      reasoningChain: [],
      llmPromptTrace: [],
      usage: null,
      semanticMatch: null,
      traceMetadata: { publicReasoning: { markerFound: false } },
      error: null,
      endedAt: expect.any(Date),
      parentTaskId: 'planner',
      runtimeSubgraphId: 'sg-1',
      generatedLocalNodeId: '',
      generatedNodeTitle: '',
    });
    expect(setOnInsert).toEqual({ startedAt: expect.any(Date) });
    expect(streamEvents.emitStepComplete).toHaveBeenCalledWith(EXECUTION_ID, 'task-1', 'final answer', undefined, 0, [{ id: 'a1' }], [], {});
    expect(advisorService.runTaskEvaluation).toHaveBeenCalledWith(EXECUTION_ID, 'task-1', OWNER_ID, { iteration: 0, advisorScoringMode: 'heuristic' });
  });

  it('does not evaluate a dynamic-reasoning child or a run without the advisor', async () => {
    const { handler, advisorService } = createHandler();
    await handler.handleCompleted(EXECUTION_ID, 'task-1', 0, {});
    expect(advisorService.runTaskEvaluation).not.toHaveBeenCalled();

    const autopilot = createHandler({ id: EXECUTION_ID, ownerId: OWNER_ID, advisorAutopilotEnabled: true, reflectionEnabled: false, advisorScoringMode: 'llm' });
    await autopilot.handler.handleCompleted(EXECUTION_ID, 'planner::dynamic-reasoning::n1', 0, {});
    expect(autopilot.advisorService.runTaskEvaluation).not.toHaveBeenCalled();
  });

  it('records failed and skipped tasks with their end', async () => {
    const { handler, taskResultRepository, streamEvents } = createHandler();

    await handler.handleFailed(EXECUTION_ID, 'task-1', 0, { error: 'tool crashed' });
    await handler.handleSkipped(EXECUTION_ID, 'task-2', 3);

    expect(taskResultRepository.upsert).toHaveBeenNthCalledWith(1, KEY, { status: 'failed', error: 'tool crashed', endedAt: expect.any(Date) }, { startedAt: expect.any(Date) });
    expect(taskResultRepository.upsert).toHaveBeenNthCalledWith(2, { executionId: EXECUTION_ID, taskId: 'task-2', iteration: 3 }, { status: 'skipped', endedAt: expect.any(Date) }, { startedAt: expect.any(Date) });
    expect(streamEvents.emitStepComplete).toHaveBeenCalledWith(EXECUTION_ID, 'task-1', undefined, 'tool crashed', 0);
  });

  it('merges a streamed iterator child into the iterator task, creating it as running', async () => {
    const { handler, taskResultRepository } = createHandler();
    taskResultRepository.find.mockResolvedValue({
      iteratorIterations: [{ index: 0, status: 'running', childResults: [{ taskId: 'c1', taskTitle: 'Child', status: 'running', output: null, error: null, components: [], artifacts: [] }] }],
    });

    await handler.handleIteratorChildCompleted(EXECUTION_ID, 'iter', 0, { iterationIndex: 0, taskId: 'c1', output: 'done' });

    expect(taskResultRepository.find).toHaveBeenCalledWith({ executionId: EXECUTION_ID, taskId: 'iter', iteration: 0 }, { light: true, with: ['iteratorIterations'] });
    expect(taskResultRepository.upsert).toHaveBeenCalledWith(
      { executionId: EXECUTION_ID, taskId: 'iter', iteration: 0 },
      { iteratorIterations: [{ index: 0, status: 'completed', childResults: [expect.objectContaining({ taskId: 'c1', taskTitle: 'Child', status: 'completed', output: 'done' })] }] },
      { startedAt: expect.any(Date), status: 'running' },
    );
  });

  describe('handleSuspended', () => {
    const payload = {
      type: 'clarification',
      message: 'Which quarter?',
      interrupt_id: 'int-1',
      task_title: 'Report',
      resumable_actions: ['reply'],
      reason_code: 'missing_input',
      risk_level: 'low',
      confidence: 0.4,
    };

    it('pauses the run on the interrupt and appends its audit event in the same write', async () => {
      const { handler, executionRepository, taskResultRepository, streamEvents } = createHandler();

      await handler.handleSuspended(EXECUTION_ID, 'task-1', 0, payload);

      expect(executionRepository.isInterruptStale).toHaveBeenCalledWith(EXECUTION_ID, 'int-1');
      expect(taskResultRepository.upsert).toHaveBeenCalledWith(KEY, { status: 'interrupted' }, { startedAt: expect.any(Date) });
      expect(executionRepository.setPendingApproval).toHaveBeenCalledWith(
        EXECUTION_ID,
        {
          nodeId: 'task-1',
          iteration: 0,
          prompt: 'Which quarter?',
          requestedAt: expect.any(Date),
          interruptType: 'clarification',
          interruptId: 'int-1',
          taskTitle: 'Report',
          taskDescription: '',
          result: '',
          payloadJson: '',
          resumableActions: ['reply'],
          reasonCode: 'missing_input',
          riskLevel: 'low',
          confidence: 0.4,
          interruptPayload: payload,
        },
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          nodeId: 'task-1',
          iteration: 0,
          interruptId: 'int-1',
          type: 'clarification',
          blockerRuleId: null,
          blockerKind: null,
          reasonCode: 'missing_input',
          riskLevel: 'low',
          prompt: 'Which quarter?',
          payload,
          status: 'pending',
          response: null,
          downstreamNodeIds: [],
          createdAt: expect.any(Date),
          respondedAt: null,
        },
      );
      expect(streamEvents.emitInterrupt).toHaveBeenCalledWith(EXECUTION_ID, 'task-1', 'Which quarter?', 0, EXECUTION_ID, expect.objectContaining({ interruptId: 'int-1' }));
    });

    it('ignores an interrupt that was already answered or whose run is over', async () => {
      const { handler, executionRepository, taskResultRepository, streamEvents } = createHandler();
      executionRepository.isInterruptStale.mockResolvedValue(true);

      await handler.handleSuspended(EXECUTION_ID, 'task-1', 0, payload);

      expect(taskResultRepository.upsert).not.toHaveBeenCalled();
      expect(executionRepository.setPendingApproval).not.toHaveBeenCalled();
      expect(streamEvents.emitInterrupt).not.toHaveBeenCalled();
    });

    it('does not announce the interrupt when the run ended before the pause was written', async () => {
      const { handler, executionRepository, streamEvents } = createHandler();
      executionRepository.setPendingApproval.mockResolvedValue(false);

      await handler.handleSuspended(EXECUTION_ID, 'task-1', 0, { ...payload, type: 'review_request' });

      expect(executionRepository.setPendingApproval).toHaveBeenCalledWith(EXECUTION_ID, expect.anything(), expect.objectContaining({ type: 'review_request' }));
      expect(streamEvents.emitInterrupt).not.toHaveBeenCalled();
    });
  });
});
