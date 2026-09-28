import { PlaybookExecutionEventHandlerService } from './playbook-execution-event-handler.service';

const EXECUTION_ID = '64b000000000000000000001';
const OWNER_ID = '64b000000000000000000003';
const OPEN = ['queued', 'running', 'pending_approval'];
const OPEN_TASKS = ['pending', 'running', 'interrupted'];

function createHandler() {
  const executionRepository = {
    findById: jest.fn().mockResolvedValue({ id: EXECUTION_ID, ownerId: OWNER_ID }),
    transition: jest.fn().mockResolvedValue(true),
    setPendingApproval: jest.fn().mockResolvedValue(true),
  };
  const taskResultRepository = {
    findLatestFailed: jest.fn().mockResolvedValue(null),
    updateManyForExecution: jest.fn().mockResolvedValue(2),
  };
  const routerDecisionRepository = { create: jest.fn().mockResolvedValue({ id: 'rd-1' }) };
  const streamEvents = {
    emitRouterDecision: jest.fn(),
    emitExecutionComplete: jest.fn(),
    emitInterrupt: jest.fn(),
  };
  const nodeEventHandler = { discardExecutionTokens: jest.fn(), handleStarted: jest.fn() };
  const tokenBufferService = { flushExecution: jest.fn().mockResolvedValue(undefined) };
  const dynamicReasoningHandler = { supports: jest.fn().mockReturnValue(false), handle: jest.fn() };
  const handler = new PlaybookExecutionEventHandlerService(
    executionRepository as never,
    taskResultRepository as never,
    routerDecisionRepository as never,
    streamEvents as never,
    {} as never,
    {} as never,
    {} as never,
    nodeEventHandler as never,
    tokenBufferService as never,
    dynamicReasoningHandler as never,
  );
  const context = {
    executionId: EXECUTION_ID,
    releaseExecutionLease: jest.fn().mockResolvedValue(undefined),
    scheduleQueueDrain: jest.fn(),
  };
  const run = (eventType: string, payload: Record<string, unknown> = {}, nodeId = 'router-1', iteration = 2) =>
    handler.handleRunEvent({ ...context, event: { event_type: eventType, node_id: nodeId, iteration, payload } });
  return { run, context, executionRepository, taskResultRepository, routerDecisionRepository, streamEvents, dynamicReasoningHandler };
}

describe('PlaybookExecutionEventHandlerService', () => {
  it('records a router decision and streams it', async () => {
    const { run, routerDecisionRepository, streamEvents, executionRepository } = createHandler();

    await run('RouterDecision', { label: 'approved' });

    expect(routerDecisionRepository.create).toHaveBeenCalledWith({
      executionId: EXECUTION_ID, routerNodeId: 'router-1', iteration: 2, label: 'approved', decidedAt: expect.any(Date),
    });
    expect(streamEvents.emitRouterDecision).toHaveBeenCalledWith(EXECUTION_ID, 'router-1', 'approved', 2);
    expect(executionRepository.transition).not.toHaveBeenCalled();
  });

  it('ends the run on a reserved router label and drains the owner queue', async () => {
    const { run, context, executionRepository, streamEvents } = createHandler();

    await run('RouterDecision', { label: '__error__' });

    expect(executionRepository.transition).toHaveBeenCalledWith(EXECUTION_ID, {
      from: OPEN,
      patch: { status: 'failed', error: 'Router router-1 returned __error__', endedAt: expect.any(Date) },
    });
    expect(context.releaseExecutionLease).toHaveBeenCalled();
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith(EXECUTION_ID, 'failed', 'Router router-1 returned __error__');
    expect(context.scheduleQueueDrain).toHaveBeenCalledWith(OWNER_ID);
  });

  it('does nothing more when a reserved label arrives after the run already ended', async () => {
    const { run, context, executionRepository, streamEvents } = createHandler();
    executionRepository.transition.mockResolvedValue(false);

    await run('RouterDecision', { label: '__cancelled__' });

    expect(executionRepository.transition).toHaveBeenCalledWith(EXECUTION_ID, expect.objectContaining({ patch: expect.objectContaining({ status: 'cancelled' }) }));
    expect(context.releaseExecutionLease).not.toHaveBeenCalled();
    expect(streamEvents.emitExecutionComplete).not.toHaveBeenCalled();
    expect(context.scheduleQueueDrain).not.toHaveBeenCalled();
  });

  it('pauses an open run on an approval request', async () => {
    const { run, executionRepository, streamEvents } = createHandler();

    await run('ApprovalRequested', { prompt: 'Ship it?' }, 'gate');

    expect(executionRepository.setPendingApproval).toHaveBeenCalledWith(EXECUTION_ID, {
      nodeId: 'gate', iteration: 2, prompt: 'Ship it?', requestedAt: expect.any(Date), interruptType: 'approval_request', resumableActions: ['approve', 'reject'],
    });
    expect(streamEvents.emitInterrupt).toHaveBeenCalledWith(EXECUTION_ID, 'gate', 'Ship it?', 2, EXECUTION_ID, { interruptType: 'approval_request', resumableActions: ['approve', 'reject'] });

    executionRepository.setPendingApproval.mockResolvedValue(false);
    streamEvents.emitInterrupt.mockClear();
    await run('ApprovalRequested', { prompt: 'Again?' }, 'gate');
    expect(streamEvents.emitInterrupt).not.toHaveBeenCalled();
  });

  it('completes the run and settles its open tasks', async () => {
    const { run, context, executionRepository, taskResultRepository, streamEvents } = createHandler();

    await run('ExecutionCompleted');

    expect(taskResultRepository.findLatestFailed).toHaveBeenCalledWith(EXECUTION_ID);
    expect(executionRepository.transition).toHaveBeenCalledWith(EXECUTION_ID, { from: OPEN, patch: { status: 'completed', endedAt: expect.any(Date) } });
    expect(taskResultRepository.updateManyForExecution).toHaveBeenCalledWith(EXECUTION_ID, { statuses: OPEN_TASKS }, { status: 'completed' });
    expect(context.releaseExecutionLease).toHaveBeenCalled();
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith(EXECUTION_ID, 'completed');
  });

  it('turns a completion with a failed task into a failure carrying that task error', async () => {
    const { run, executionRepository, taskResultRepository, streamEvents } = createHandler();
    taskResultRepository.findLatestFailed.mockResolvedValue({ error: 'step 3 exploded' });

    await run('ExecutionCompleted');

    expect(executionRepository.transition).toHaveBeenCalledTimes(1);
    expect(executionRepository.transition).toHaveBeenCalledWith(EXECUTION_ID, { from: OPEN, patch: { status: 'failed', error: 'step 3 exploded', endedAt: expect.any(Date) } });
    expect(taskResultRepository.updateManyForExecution).toHaveBeenCalledWith(EXECUTION_ID, { statuses: OPEN_TASKS }, { status: 'failed' });
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith(EXECUTION_ID, 'failed', 'step 3 exploded');
  });

  it('still settles the tasks but stays quiet when the run was already terminal', async () => {
    const { run, context, executionRepository, taskResultRepository, streamEvents } = createHandler();
    executionRepository.transition.mockResolvedValue(false);

    await run('ExecutionFailed', { error: 'boom' });

    expect(taskResultRepository.updateManyForExecution).toHaveBeenCalledWith(EXECUTION_ID, { statuses: OPEN_TASKS }, { status: 'failed' });
    expect(context.releaseExecutionLease).not.toHaveBeenCalled();
    expect(streamEvents.emitExecutionComplete).not.toHaveBeenCalled();
  });

  it('hands dynamic reasoning events to their handler', async () => {
    const { run, dynamicReasoningHandler } = createHandler();
    dynamicReasoningHandler.supports.mockReturnValue(true);

    await run('DynamicPlanProposed', { revision: 1 }, 'planner', 0);

    expect(dynamicReasoningHandler.handle).toHaveBeenCalledWith(EXECUTION_ID, 'DynamicPlanProposed', 'planner', 0, { revision: 1 });
  });
});
