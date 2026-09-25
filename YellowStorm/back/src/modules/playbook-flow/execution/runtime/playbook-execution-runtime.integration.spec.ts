import { eq, inArray } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { DynamicReasoningAttemptRepository } from '../../persistence/dynamic-reasoning-attempt.repository';
import { ExecutionRepository } from '../../persistence/execution.repository';
import { RouterDecisionRepository } from '../../persistence/router-decision.repository';
import { TaskResultRepository } from '../../persistence/task-result.repository';
import { PlaybookDynamicReasoningEventHandlerService } from './playbook-dynamic-reasoning-event-handler.service';
import { PlaybookExecutionEventHandlerService } from './playbook-execution-event-handler.service';
import { PlaybookExecutionHitlResumeService, type PlaybookExecutionHitlResumeHost } from './playbook-execution-hitl-resume.service';
import { PlaybookExecutionNodeEventHandlerService } from './playbook-execution-node-event-handler.service';

/**
 * The runtime handlers against the real tables: the approval claim under concurrency, the task
 * result upsert shapes across a task's events, and the stale-interrupt path.
 */
describeIntegration('playbook runtime handlers (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const executions = new ExecutionRepository(db as never);
  const taskResults = new TaskResultRepository(db as never);
  const attempts = new DynamicReasoningAttemptRepository(db as never);

  const ownerId = oid();
  let flowId: string;

  const streamEvents = {
    emitStepStart: jest.fn(),
    emitStepUpdate: jest.fn(),
    emitStepComplete: jest.fn(),
    emitInterrupt: jest.fn(),
    emitHitlInterruptResolved: jest.fn(),
    emitHitlMemorySaved: jest.fn(),
    emitDynamicReasoningUpdate: jest.fn(),
    emitExecutionComplete: jest.fn(),
    emitRouterDecision: jest.fn(),
  };
  const observabilityService = {
    shouldRedactSensitiveText: jest.fn().mockResolvedValue(false),
    extractTraceUpdatePayload: jest.fn().mockReturnValue({
      toolTrace: [{ callIndex: 0, toolName: 'search', args: { q: 'x\u0000' } }], llmPromptTrace: [], usage: { totalTokens: 5 }, traceMetadata: { phase: 'tools' },
    }),
    extractCompletedResultPayload: jest.fn().mockReturnValue({
      output: '42', displayText: 'The answer is 42', toolTrace: [], reasoningChain: [], llmPromptTrace: [], usage: null, semanticMatch: null, traceMetadata: { done: true },
    }),
    toStreamPayload: jest.fn().mockReturnValue({}),
  };
  const replayRuntime = { hasTrackedTask: jest.fn().mockReturnValue(false), resolveArtifactsForCompletedTask: jest.fn().mockResolvedValue(null) };
  const nodeHandler = new PlaybookExecutionNodeEventHandlerService(
    executions, taskResults, streamEvents as never, observabilityService as never, { runTaskEvaluation: jest.fn() } as never, replayRuntime as never,
  );
  const eventHandler = new PlaybookExecutionEventHandlerService(
    executions, taskResults, new RouterDecisionRepository(db as never), streamEvents as never, {} as never, {} as never, {} as never, nodeHandler,
  );
  const dynamicHandler = new PlaybookDynamicReasoningEventHandlerService(attempts, executions, streamEvents as never);

  const newExecution = (status: 'running' | 'pending_approval' = 'running') =>
    executions.insert({ flowId, ownerId, recursionLimit: 25, maxParallelism: 5, status, snapshot: { nodes: [{ id: 'review', kind: 'step' }] } });
  const taskRow = async (executionId: string, taskId: string) =>
    (await db.select().from(schema.playbookTaskResults).where(eq(schema.playbookTaskResults.executionId, executionId)))
      .filter((row) => row.taskId === taskId);

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `pbrt-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    flowId = oid();
    await db.insert(schema.playbookFlows).values({ id: flowId, ownerId, name: `flow ${flowId}` });
  });

  afterAll(async () => {
    await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.ownerId, ownerId));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId]));
    await close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('keeps the first start time and the insert-only identity across a task\'s events', async () => {
    const execution = await newExecution();
    await nodeHandler.handleTraceUpdate(execution.id, 'gen-1', 0, { parent_node_id: 'planner', runtime_subgraph_id: 'sg-1', generated_title: 'Search' });
    const [afterTrace] = await taskRow(execution.id, 'gen-1');
    expect(afterTrace).toMatchObject({
      status: 'pending', parentTaskId: 'planner', runtimeSubgraphId: 'sg-1', generatedLocalNodeId: '', generatedNodeTitle: 'Search',
      toolTrace: [{ callIndex: 0, toolName: 'search', args: { q: 'x' } }], usage: { totalTokens: 5 }, traceMetadata: { phase: 'tools' },
    });

    await nodeHandler.handleFailed(execution.id, 'gen-1', 0, { error: 'first try failed' });
    await nodeHandler.handleCompleted(execution.id, 'gen-1', 0, {});
    const rows = await taskRow(execution.id, 'gen-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'completed', error: null, displayText: 'The answer is 42', parentTaskId: 'planner', traceMetadata: { done: true } });
    expect(rows[0].startedAt).toEqual(afterTrace.startedAt);
    expect(rows[0].endedAt).toBeInstanceOf(Date);
    const stored = await taskResults.find({ executionId: execution.id, taskId: 'gen-1', iteration: 0 });
    expect(stored?.output).toBe('42');
  });

  it('pauses on an interrupt, and ignores the same interrupt once a human answered it', async () => {
    const execution = await newExecution();
    const payload = { type: 'clarification', message: 'Which quarter?', interrupt_id: 'int-1' };
    await nodeHandler.handleSuspended(execution.id, 'review', 0, payload);

    const paused = (await executions.findById(execution.id))!;
    expect(paused).toMatchObject({ status: 'pending_approval', pendingApproval: { nodeId: 'review', interruptId: 'int-1', prompt: 'Which quarter?' } });
    expect(paused.hitlEvents).toEqual([expect.objectContaining({ interruptId: 'int-1', type: 'clarification', status: 'pending', reasonCode: 'runtime_interrupt' })]);
    expect((await taskRow(execution.id, 'review'))[0].status).toBe('interrupted');
    expect(streamEvents.emitInterrupt).toHaveBeenCalledTimes(1);

    expect(await executions.answerHitlEvent(execution.id, {
      from: ['pending_approval'], interruptId: 'int-1', response: { action: 'reply', message: 'Q3' }, patch: { status: 'running', pendingApproval: null },
    })).toBe(true);

    await nodeHandler.handleSuspended(execution.id, 'review', 0, payload);
    const after = (await executions.findById(execution.id))!;
    expect(after.status).toBe('running');
    expect(after.pendingApproval).toBeNull();
    expect(after.hitlEvents).toHaveLength(1);
    expect(streamEvents.emitInterrupt).toHaveBeenCalledTimes(1);
  });

  it('lets exactly one of two concurrent approvals claim the pause', async () => {
    const execution = await newExecution();
    await executions.setPendingApproval(
      execution.id,
      { nodeId: 'review', iteration: 0, prompt: 'Ship?', interruptType: 'approval_request', interruptId: 'int-9' },
      { nodeId: 'review', iteration: 0, interruptId: 'int-9', type: 'approval_request', reasonCode: 'approval', prompt: 'Ship?' },
    );
    const host: PlaybookExecutionHitlResumeHost = {
      isRuntimeAvailable: () => true,
      resumeApprovalRuntime: jest.fn((_request, callback) => setTimeout(() => callback(null, { resumed: true }), 20)),
      resumeFromStepRuntime: jest.fn(),
      scheduleDurableResume: jest.fn(),
    };
    const service = new PlaybookExecutionHitlResumeService(executions, streamEvents as never);
    service.bindExecutionHost(host);
    // Both requests read the paused run before either claims it, so the race is decided by the claim itself.
    const read = executions.findById.bind(executions);
    let arrived = 0;
    let bothRead: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { bothRead = resolve; });
    const findById = jest.spyOn(executions, 'findById').mockImplementation(async (id, options) => {
      const record = await read(id, options);
      if (options?.withSnapshot) {
        arrived += 1;
        if (arrived === 2) bothRead();
        await barrier;
      }
      return record;
    });

    const responses = await Promise.all([
      service.resumeApproval(execution.id, ownerId, { decision: 'approved' }),
      service.resumeApproval(execution.id, ownerId, { decision: 'rejected' }),
    ]).finally(() => findById.mockRestore());

    expect(host.resumeApprovalRuntime).toHaveBeenCalledTimes(1);
    expect(responses.map((response) => response.status)).toEqual(['running', 'running']);
    const final = (await executions.findById(execution.id))!;
    expect(final.status).toBe('running');
    expect(final.pendingApproval).toBeNull();
    expect(final.hitlEvents).toEqual([expect.objectContaining({ interruptId: 'int-9', status: 'answered', response: expect.objectContaining({ action: expect.stringMatching(/approved|rejected/) }) })]);
    expect(streamEvents.emitHitlInterruptResolved).toHaveBeenCalledTimes(1);
  });

  it('settles the open tasks when the run completes, once', async () => {
    const execution = await newExecution();
    await nodeHandler.handleStarted(execution.id, 'a', 0);
    await nodeHandler.handleSkipped(execution.id, 'b', 0);
    const context = { executionId: execution.id, releaseExecutionLease: jest.fn().mockResolvedValue(undefined), scheduleQueueDrain: jest.fn() };

    await Promise.all([
      eventHandler.handleRunEvent({ ...context, event: { event_type: 'ExecutionCompleted', payload: {} } }),
      eventHandler.handleRunEvent({ ...context, event: { event_type: 'ExecutionCompleted', payload: {} } }),
    ]);

    expect((await executions.findById(execution.id))?.status).toBe('completed');
    expect((await taskRow(execution.id, 'a'))[0].status).toBe('completed');
    expect((await taskRow(execution.id, 'b'))[0].status).toBe('skipped');
    expect(context.releaseExecutionLease).toHaveBeenCalledTimes(1);
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledTimes(1);
  });

  it('records dynamic reasoning attempts and ignores those of a run that is gone', async () => {
    const execution = await newExecution();
    await dynamicHandler.handle(execution.id, 'DynamicPlanProposed', 'planner', 0, { revision: 0, plan: { steps: [] } });
    await dynamicHandler.handle(execution.id, 'DynamicPlanProposed', 'planner', 0, { revision: 0, plan: { steps: [] } });
    expect(await attempts.listForExecution(execution.id)).toEqual([
      expect.objectContaining({ flowId, status: 'planning', revisions: [expect.objectContaining({ revision: 0, kind: 'proposal' })] }),
    ]);

    await db.delete(schema.playbookExecutions).where(eq(schema.playbookExecutions.id, execution.id));
    streamEvents.emitDynamicReasoningUpdate.mockClear();
    await expect(dynamicHandler.handle(execution.id, 'RuntimeSubgraphCompleted', 'planner', 0, {})).resolves.toBeUndefined();
    expect(await attempts.listForExecution(execution.id)).toEqual([]);
    expect(streamEvents.emitDynamicReasoningUpdate).not.toHaveBeenCalled();
  });
});
