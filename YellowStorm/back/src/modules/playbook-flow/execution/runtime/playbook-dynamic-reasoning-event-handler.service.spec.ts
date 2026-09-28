import { PlaybookDynamicReasoningEventHandlerService } from './playbook-dynamic-reasoning-event-handler.service';

const FLOW_ID = '507f1f77bcf86cd799439011';

function createHandler(execution: Record<string, unknown> | null = { id: 'exec-1', flowId: FLOW_ID }) {
  const attemptRepository = {
    upsert: jest.fn().mockResolvedValue(true),
    pushRevision: jest.fn().mockResolvedValue(true),
  };
  const executionRepository = { findById: jest.fn().mockResolvedValue(execution) };
  const streamEvents = { emitDynamicReasoningUpdate: jest.fn() };
  const handler = new PlaybookDynamicReasoningEventHandlerService(
    attemptRepository as never,
    executionRepository as never,
    streamEvents as never,
  );
  return { handler, attemptRepository, executionRepository, streamEvents };
}

describe('PlaybookDynamicReasoningEventHandlerService', () => {
  it('persists the repaired direct decision with fallback status', async () => {
    const { handler, attemptRepository } = createHandler();
    const decision = {
      mode: 'direct',
      reasonSummary: 'The repaired decision is safe to execute directly.',
      confidence: 0.9,
      directSafe: true,
    };

    await handler.handle('exec-1', 'DynamicDirectFallback', 'parent-1', 0, { decision });

    expect(attemptRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-1', parentTaskId: 'parent-1', parentIteration: 0, attempt: 0 },
      expect.objectContaining({
        status: 'direct',
        fallbackReason: 'invalid_plan_safe_direct',
        decision,
      }),
      { flowId: FLOW_ID },
    );
  });

  it('marks a planner contract failure as terminal', async () => {
    const { handler, attemptRepository } = createHandler();

    await handler.handle('exec-1', 'DynamicPlanningFailed', 'parent-1', 0, {
      error: 'Playbook Planner returned an invalid decision',
    });

    expect(attemptRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-1', parentTaskId: 'parent-1', parentIteration: 0, attempt: 0 },
      expect.objectContaining({
        status: 'failed',
        error: { message: 'Playbook Planner returned an invalid decision' },
        completedAt: expect.any(Date),
      }),
      { flowId: FLOW_ID },
    );
  });

  it('records the accepted subgraph when the runtime creates it', async () => {
    const { handler, attemptRepository } = createHandler();
    const plan = { schemaVersion: '1', nodes: [] };

    await handler.handle('exec-1', 'RuntimeSubgraphCreated', 'parent-1', 1, { subgraphId: 'sg-1', acceptedRevision: 2, plan });

    expect(attemptRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-1', parentTaskId: 'parent-1', parentIteration: 1, attempt: 0 },
      { status: 'running', subgraphId: 'sg-1', acceptedRevision: 2, acceptedPlan: plan, acceptedAt: expect.any(Date) },
      { flowId: FLOW_ID },
    );
  });

  it('uses a stable attempt identity and appends each revision through the idempotent push', async () => {
    const { handler, attemptRepository, streamEvents } = createHandler();
    const payload = { revision: 0, plan: { schemaVersion: '1' } };

    await handler.handle('exec-1', 'DynamicPlanProposed', 'parent-1', 2, payload);
    await handler.handle('exec-1', 'DynamicPlanRepaired', 'parent-1', 2, { ...payload, revision: '1' });

    const identity = { executionId: 'exec-1', parentTaskId: 'parent-1', parentIteration: 2, attempt: 0 };
    expect(attemptRepository.upsert).toHaveBeenNthCalledWith(1, identity, {}, { flowId: FLOW_ID });
    expect(attemptRepository.pushRevision).toHaveBeenNthCalledWith(1, identity, {
      revision: 0, kind: 'proposal', plan: payload.plan, validationIssues: [], createdAt: expect.any(Date),
    });
    expect(attemptRepository.pushRevision).toHaveBeenNthCalledWith(2, identity, expect.objectContaining({ revision: 1, kind: 'repair' }));
    expect(streamEvents.emitDynamicReasoningUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not push a revision for other events', async () => {
    const { handler, attemptRepository } = createHandler();

    await handler.handle('exec-1', 'DynamicPlanningStarted', 'parent-1', 0, { inputContext: { contextFingerprint: 'fp-1', a: 1 } });

    expect(attemptRepository.upsert).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'planning', planningStartedAt: expect.any(Date), inputContextSummary: { contextFingerprint: 'fp-1', a: 1 }, contextFingerprint: 'fp-1' },
      { flowId: FLOW_ID },
    );
    expect(attemptRepository.pushRevision).not.toHaveBeenCalled();
  });

  it('ignores events of a run that no longer exists', async () => {
    const { handler, attemptRepository, streamEvents } = createHandler(null);

    await handler.handle('exec-gone', 'DynamicPlanProposed', 'parent-1', 0, { revision: 0 });

    expect(attemptRepository.upsert).not.toHaveBeenCalled();
    expect(streamEvents.emitDynamicReasoningUpdate).not.toHaveBeenCalled();
  });

  it('stops quietly when the run is deleted between the read and the write', async () => {
    const { handler, attemptRepository, streamEvents } = createHandler();
    attemptRepository.upsert.mockResolvedValueOnce(false);

    await handler.handle('exec-1', 'DynamicPlanProposed', 'parent-1', 0, { revision: 0 });

    expect(attemptRepository.pushRevision).not.toHaveBeenCalled();
    expect(streamEvents.emitDynamicReasoningUpdate).not.toHaveBeenCalled();
  });
});
