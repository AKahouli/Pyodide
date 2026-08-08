import { PlaybookDynamicReasoningEventHandlerService } from './playbook-dynamic-reasoning-event-handler.service';

describe('PlaybookDynamicReasoningEventHandlerService', () => {
  it('persists the repaired direct decision with fallback status', async () => {
    const updateOne = jest.fn().mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });
    const attemptModel = { updateOne };
    const executionModel = {
      findById: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ({ flowId: 'flow-1' }) }) }),
    };
    const streamEvents = { emitDynamicReasoningUpdate: jest.fn() };
    const handler = new PlaybookDynamicReasoningEventHandlerService(
      attemptModel as never,
      executionModel as never,
      streamEvents as never,
    );
    const decision = {
      mode: 'direct',
      reasonSummary: 'The repaired decision is safe to execute directly.',
      confidence: 0.9,
      directSafe: true,
    };

    await handler.handle('exec-1', 'DynamicDirectFallback', 'parent-1', 0, { decision });

    expect(updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', parentTaskId: 'parent-1', parentIteration: 0, attempt: 0 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'direct',
          fallbackReason: 'invalid_plan_safe_direct',
          decision,
        }),
      }),
      { upsert: true },
    );
  });

  it('marks a planner contract failure as terminal', async () => {
    const updateOne = jest.fn().mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });
    const attemptModel = { updateOne };
    const executionModel = {
      findById: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ({ flowId: 'flow-1' }) }) }),
    };
    const streamEvents = { emitDynamicReasoningUpdate: jest.fn() };
    const handler = new PlaybookDynamicReasoningEventHandlerService(
      attemptModel as never,
      executionModel as never,
      streamEvents as never,
    );

    await handler.handle('exec-1', 'DynamicPlanningFailed', 'parent-1', 0, {
      error: 'Playbook Planner returned an invalid decision',
    });

    expect(updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', parentTaskId: 'parent-1', parentIteration: 0, attempt: 0 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          error: { message: 'Playbook Planner returned an invalid decision' },
          completedAt: expect.any(Date),
        }),
      }),
      { upsert: true },
    );
  });

  it('uses a stable attempt identity and idempotent revision update', async () => {
    const revisions: Array<{ revision: number; kind: string }> = [];
    const updateOne = jest.fn((
      filter: { revisions?: { $not?: { $elemMatch?: { revision: number; kind: string } } } },
      update: { $push?: { revisions?: { revision: number; kind: string } } },
    ) => ({
      exec: async () => {
        const candidate = update.$push?.revisions;
        const stableKey = filter.revisions?.$not?.$elemMatch;
        if (candidate && stableKey && !revisions.some((entry) => (
          entry.revision === stableKey.revision && entry.kind === stableKey.kind
        ))) {
          revisions.push(candidate);
        }
        return { modifiedCount: candidate ? 1 : 0 };
      },
    }));
    const attemptModel = { updateOne };
    const executionModel = {
      findById: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ({ flowId: 'flow-1' }) }) }),
    };
    const streamEvents = { emitDynamicReasoningUpdate: jest.fn() };
    const handler = new PlaybookDynamicReasoningEventHandlerService(
      attemptModel as never,
      executionModel as never,
      streamEvents as never,
    );
    const payload = { revision: 0, plan: { schemaVersion: '1' } };

    await handler.handle('exec-1', 'DynamicPlanProposed', 'parent-1', 2, payload);
    await handler.handle('exec-1', 'DynamicPlanProposed', 'parent-1', 2, payload);

    expect(updateOne).toHaveBeenCalledTimes(4);
    expect(updateOne.mock.calls[0][0]).toEqual({ executionId: 'exec-1', parentTaskId: 'parent-1', parentIteration: 2, attempt: 0 });
    expect(updateOne.mock.calls[1][0]).toEqual(expect.objectContaining({
      revisions: { $not: { $elemMatch: { revision: 0, kind: 'proposal' } } },
    }));
    expect(revisions).toHaveLength(1);
  });
});
