import { newObjectId } from '@common/postgres';
import { WorkyBudgetService } from './worky-budget.service';
import type { WorkyStreamBudget, WorkyStreamRecord, WorkyTaskBudget, WorkyTaskRecord } from '../worky.types';

const fkViolation = () => Object.assign(new Error('insert violates foreign key constraint'), { code: '23503' });

const buildStream = (budget: Partial<WorkyStreamBudget> = {}): WorkyStreamRecord => ({
  id: newObjectId(),
  ownerUserId: newObjectId(),
  shares: [],
  workspaceId: newObjectId(),
  artifactWorkspaceId: null,
  managerAgentId: null,
  managerModelId: null,
  workerModelId: null,
  voicePrompt: null,
  aiSessionId: null,
  governancePolicyRef: null,
  title: 'Test stream',
  status: 'active',
  controlState: 'active',
  schedulerEnabled: false,
  currentPlanVersion: 0,
  executionPlanVersion: null,
  budget: { limitUsd: 1, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop', ...budget },
  startedAt: null,
  completedAt: null,
  activeDurationMinutes: 0,
  lastActivityAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
});

const buildTask = (streamId: string, budget: Partial<WorkyTaskBudget> = {}): WorkyTaskRecord =>
  ({
    id: newObjectId(),
    streamId,
    title: 'A task',
    actionCategory: 'internal_analysis',
    budget: { estimateUsd: 0.1, actualUsd: 0, tokensEstimate: 100, tokensActual: 0, ...budget },
  }) as WorkyTaskRecord;

const makeService = (budget: Partial<WorkyStreamBudget> = {}) => {
  const stream = buildStream(budget);
  const db = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const streams = {
    findById: jest.fn().mockResolvedValue(stream),
    reserveBudget: jest.fn().mockResolvedValue(true),
    releaseBudget: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(stream),
    setBudgetLimits: jest.fn().mockResolvedValue(undefined),
  };
  const tasks = { addActualCost: jest.fn().mockResolvedValue(null) };
  const budgets = {
    createReservation: jest.fn().mockImplementation(async (input: Record<string, unknown>) => ({ id: newObjectId(), ...input })),
    transitionReservation: jest.fn().mockResolvedValue(null),
    consumeOpenReservations: jest.fn().mockResolvedValue(1),
    insertCostEvent: jest.fn().mockImplementation(async (input: Record<string, unknown>) => ({ id: newObjectId(), ...input })),
    costTotals: jest.fn().mockResolvedValue({ totalCostUsd: 0.05, totalInputTokens: 30, totalOutputTokens: 20, eventCount: 2 }),
  };
  const interactions = {
    create: jest.fn().mockImplementation(async (input: Record<string, unknown>) => ({ id: newObjectId(), ...input })),
  };
  const emitted: Array<{ userId: string; streamId: string; type: string; payload: Record<string, unknown> }> = [];
  const events = {
    emit: jest.fn((userId: string, streamId: string, e: { type: string; payload: Record<string, unknown> }) => {
      emitted.push({ userId, streamId, type: e.type, payload: e.payload });
    }),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new WorkyBudgetService(
    db as never,
    streams as never,
    tasks as never,
    budgets as never,
    interactions as never,
    events as never,
    audit as never,
    logger as never,
  );
  return { service, stream, db, streams, tasks, budgets, interactions, events, emitted, audit, logger };
};

describe('WorkyBudgetService.estimate', () => {
  it('returns the task estimate when present', () => {
    const { service } = makeService();
    const result = service.estimate({
      actionCategory: 'research',
      budget: { estimateUsd: 0.5, tokensEstimate: 200 },
    });
    expect(result.amountUsd).toBe(0.5);
    expect(result.tokens).toBe(200);
  });
  it('falls back to the per-category default when estimate is 0', () => {
    const { service } = makeService();
    const result = service.estimate({
      actionCategory: 'research',
      budget: { estimateUsd: 0, tokensEstimate: 0 },
    });
    expect(result.amountUsd).toBe(0.25);
  });
});

describe('WorkyBudgetService.reserve', () => {
  it('reserves against the stream counters also when the stream has no limits', async () => {
    // A limit of 0 is unlimited inside the SQL guard; the counters still move so that
    // release() (which always gives the amounts back) stays symmetric.
    const { service, stream, streams, budgets, emitted, audit, db } = makeService({ limitUsd: 0, limitTokens: 0 });
    const taskId = newObjectId();
    const result = await service.reserve({ streamId: stream.id, taskId, amountUsd: 0.5, tokens: 100 });

    expect(streams.reserveBudget).toHaveBeenCalledWith(stream.id, 0.5, 100);
    expect(budgets.createReservation).toHaveBeenCalledWith({
      streamId: stream.id,
      taskId,
      amountUsd: 0.5,
      tokens: 100,
      status: 'reserved',
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'reserved', amountUsd: 0.5, tokens: 100 });
    expect(result.reservationId).toEqual(expect.any(String));
    expect(emitted).toEqual([
      expect.objectContaining({ userId: stream.ownerUserId, streamId: stream.id, type: 'budget.reserved' }),
    ]);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: stream.id, action: 'budget.reserved', targetId: result.reservationId }),
    );
  });

  it('lets the atomic guard decide, not the stream read beforehand', async () => {
    // The stream read says the amount would not fit, but the conditional UPDATE is the
    // linearisation point: it accepted, so the reservation stands.
    const { service, stream, streams, budgets } = makeService({ limitUsd: 1, spendUsd: 0.95 });
    streams.reserveBudget.mockResolvedValueOnce(true);
    const result = await service.reserve({ streamId: stream.id, taskId: newObjectId(), amountUsd: 0.1, tokens: 0 });

    expect(result.status).toBe('reserved');
    expect(budgets.createReservation).toHaveBeenCalledWith(expect.objectContaining({ status: 'reserved' }));
  });

  it('denies reservation when it would exceed the limit and creates a budget_decision interaction under hard_stop', async () => {
    const { service, stream, streams, budgets, interactions, emitted, audit } = makeService();
    streams.reserveBudget.mockResolvedValueOnce(false);
    const taskId = newObjectId();
    const result = await service.reserve({ streamId: stream.id, taskId, amountUsd: 0.5, tokens: 0 });

    expect(result).toEqual({ status: 'denied', amountUsd: 0.5, tokens: 0, reason: 'budget_exhausted' });
    expect(budgets.createReservation).toHaveBeenCalledWith(expect.objectContaining({ status: 'denied', taskId }));
    expect(streams.update).toHaveBeenCalledWith(stream.id, { status: 'waiting_for_budget_decision' });
    expect(interactions.create).toHaveBeenCalledWith({
      streamId: stream.id,
      taskId,
      type: 'budget_decision',
      targetUserId: stream.ownerUserId,
      question: 'Budget exhausted on stream "Test stream". Increase limit, switch to notify, generate report, or stop?',
      options: ['increase', 'cheaper_mode', 'report_now', 'stop'],
      blockingScope: 'stream',
      blocksTaskIds: [],
    });
    expect(emitted.find((e) => e.type === 'budget.exhausted')?.payload).toMatchObject({ limitUsd: 1, limitTokens: 0 });
    expect(emitted.find((e) => e.type === 'budget_decision.requested')?.payload).toEqual({ taskId });
    expect(emitted.find((e) => e.type === 'budget.reserved')).toBeUndefined();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('denies reservation under notify enforcement but does not raise an interaction', async () => {
    const { service, stream, streams, interactions, emitted } = makeService({ limitUsd: 1, spendUsd: 0.5, enforcement: 'notify' });
    streams.reserveBudget.mockResolvedValueOnce(false);
    const result = await service.reserve({ streamId: stream.id, taskId: newObjectId(), amountUsd: 0.6, tokens: 0 });

    expect(result.status).toBe('denied');
    expect(interactions.create).not.toHaveBeenCalled();
    expect(streams.update).not.toHaveBeenCalled();
    expect(emitted.find((e) => e.type === 'budget.exhausted')).toBeDefined();
  });

  it('reports a task that does not exist as a clear error and emits nothing', async () => {
    const { service, stream, budgets, emitted } = makeService();
    budgets.createReservation.mockRejectedValueOnce(fkViolation());
    const taskId = newObjectId();

    await expect(service.reserve({ streamId: stream.id, taskId, amountUsd: 0.1, tokens: 0 })).rejects.toThrow(
      `WorkyBudgetService.reserve: task ${taskId} not found`,
    );
    expect(emitted).toHaveLength(0);
  });

  it('throws when the stream does not exist, before touching the counters', async () => {
    const { service, streams } = makeService();
    streams.findById.mockResolvedValueOnce(null);
    const streamId = newObjectId();

    await expect(service.reserve({ streamId, taskId: newObjectId(), amountUsd: 0.1, tokens: 0 })).rejects.toThrow(
      `WorkyBudgetService.reserve: stream ${streamId} not found`,
    );
    expect(streams.reserveBudget).not.toHaveBeenCalled();
  });

  it('rejects malformed ids', async () => {
    const { service, streams } = makeService();
    await expect(service.reserve({ streamId: 'nope', taskId: newObjectId(), amountUsd: 0.1, tokens: 0 })).rejects.toThrow(/invalid streamId/);
    await expect(service.reserve({ streamId: newObjectId(), taskId: 'nope', amountUsd: 0.1, tokens: 0 })).rejects.toThrow(/invalid taskId/);
    expect(streams.findById).not.toHaveBeenCalled();
  });
});

describe('WorkyBudgetService.release', () => {
  it('marks the reservation released and gives its amounts back to the stream', async () => {
    const { service, budgets, streams, db } = makeService();
    const reservationId = newObjectId();
    const streamId = newObjectId();
    budgets.transitionReservation.mockResolvedValueOnce({ id: reservationId, streamId, amountUsd: 0.1, tokens: 20, status: 'released' });

    await service.release(reservationId);

    expect(budgets.transitionReservation).toHaveBeenCalledWith(reservationId, 'reserved', 'released');
    expect(streams.releaseBudget).toHaveBeenCalledWith(streamId, 0.1, 20);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a reservation that is no longer reserved changes nothing', async () => {
    const { service, budgets, streams } = makeService();
    budgets.transitionReservation.mockResolvedValueOnce(null);

    await service.release(newObjectId());

    expect(streams.releaseBudget).not.toHaveBeenCalled();
  });

  it('is a no-op for a malformed reservation id', async () => {
    const { service, budgets, streams } = makeService();
    await service.release('not-a-valid-id');
    expect(budgets.transitionReservation).not.toHaveBeenCalled();
    expect(streams.releaseBudget).not.toHaveBeenCalled();
  });
});

describe('WorkyBudgetService.recordCost', () => {
  const costInput = (streamId: string, taskId: string | null, costUsd = 0.02) => ({
    streamId,
    taskId,
    type: 'llm' as const,
    provider: 'openai',
    modelId: 'gpt-4o',
    inputTokens: 100,
    outputTokens: 50,
    costUsd,
  });

  it('persists a cost event and increments the task budget', async () => {
    const { service, stream, tasks, budgets, events } = makeService();
    const task = buildTask(stream.id, { estimateUsd: 0.1, actualUsd: 0.02 });
    tasks.addActualCost.mockResolvedValueOnce(task);

    const result = await service.recordCost(costInput(stream.id, task.id));

    expect(tasks.addActualCost).toHaveBeenCalledWith(task.id, 0.02, 150);
    expect(budgets.insertCostEvent).toHaveBeenCalledWith(expect.objectContaining({ streamId: stream.id, taskId: task.id, costUsd: 0.02 }));
    expect(budgets.costTotals).toHaveBeenCalledWith(stream.id);
    expect(result).toEqual({ costEventId: expect.any(String), totalCostUsd: 0.05, totalTokens: 50, overspend: false });
    expect(budgets.consumeOpenReservations).not.toHaveBeenCalled();
    // No overspend → no event emitted by the service (the controller
    // emits `cost.recorded` separately).
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('flags overspend on the post-increment actual (no double-count) and consumes the open reservations', async () => {
    // estimateUsd=0.1, OVERSPEND_BAND=0.1 → ceiling=0.11. addActualCost returns the row after the
    // increment, so actualUsd=0.15 already includes this cost of 0.05.
    const { service, stream, tasks, budgets, emitted } = makeService();
    const task = buildTask(stream.id, { estimateUsd: 0.1, actualUsd: 0.15 });
    tasks.addActualCost.mockResolvedValueOnce(task);

    const result = await service.recordCost(costInput(stream.id, task.id, 0.05));

    expect(result.overspend).toBe(true);
    expect(budgets.consumeOpenReservations).toHaveBeenCalledWith(task.id);
    expect(emitted).toEqual([
      {
        userId: stream.ownerUserId,
        streamId: stream.id,
        type: 'budget.exhausted',
        payload: { taskId: task.id, actualUsd: 0.15, estimateUsd: 0.1 },
      },
    ]);
  });

  it('does not flag overspend within the band', async () => {
    const { service, stream, tasks, budgets } = makeService();
    tasks.addActualCost.mockResolvedValueOnce(buildTask(stream.id, { estimateUsd: 0.1, actualUsd: 0.105 }));

    const result = await service.recordCost(costInput(stream.id, newObjectId(), 0.005));

    expect(result.overspend).toBe(false);
    expect(budgets.consumeOpenReservations).not.toHaveBeenCalled();
  });

  it('keeps the cost of a task that no longer exists, unattributed', async () => {
    const { service, stream, tasks, budgets } = makeService();
    tasks.addActualCost.mockResolvedValueOnce(null);

    const result = await service.recordCost(costInput(stream.id, newObjectId()));

    expect(budgets.insertCostEvent).toHaveBeenCalledWith(expect.objectContaining({ taskId: null }));
    expect(result.overspend).toBe(false);
  });

  it('records a stream-level cost without touching any task', async () => {
    const { service, stream, tasks, budgets } = makeService();

    await service.recordCost(costInput(stream.id, null));

    expect(tasks.addActualCost).not.toHaveBeenCalled();
    expect(budgets.insertCostEvent).toHaveBeenCalledWith(expect.objectContaining({ taskId: null }));
  });

  it('reports a stream that does not exist as a clear error', async () => {
    const { service, budgets } = makeService();
    budgets.insertCostEvent.mockRejectedValueOnce(fkViolation());
    const streamId = newObjectId();

    await expect(service.recordCost(costInput(streamId, null))).rejects.toThrow(
      `WorkyBudgetService.recordCost: stream ${streamId} not found`,
    );
  });
});

describe('WorkyBudgetService.getSnapshot', () => {
  it('returns the live budget with remainingUsd/tokens + exhausted flag', async () => {
    const { service, stream } = makeService({ limitUsd: 1, limitTokens: 1000, spendUsd: 0.7, tokensUsed: 500 });
    const snap = await service.getSnapshot(stream.id);
    expect(snap.remainingUsd).toBeCloseTo(0.3);
    expect(snap.remainingTokens).toBe(500);
    expect(snap.exhausted).toBe(false);
  });
  it('reports exhausted when spend >= limit', async () => {
    const { service, stream } = makeService({ limitUsd: 1, limitTokens: 0, spendUsd: 1, tokensUsed: 0 });
    const snap = await service.getSnapshot(stream.id);
    expect(snap.exhausted).toBe(true);
    expect(snap.remainingTokens).toBe(Number.POSITIVE_INFINITY);
  });
  it('throws when the stream does not exist', async () => {
    const { service, streams } = makeService();
    streams.findById.mockResolvedValueOnce(null);
    await expect(service.getSnapshot(newObjectId())).rejects.toThrow(/not found/);
  });
});

describe('WorkyBudgetService.setLimits', () => {
  it('updates the limits, emits budget.updated, and returns the snapshot', async () => {
    const { service, stream, streams, events } = makeService();
    const limits = { limitUsd: 5, limitTokens: 1000, enforcement: 'notify' as const };
    const result = await service.setLimits(stream.id, limits);

    expect(streams.setBudgetLimits).toHaveBeenCalledWith(stream.id, limits);
    expect(events.emit).toHaveBeenCalledWith(
      stream.ownerUserId,
      stream.id,
      expect.objectContaining({ type: 'budget.updated', payload: limits }),
    );
    expect(result.streamId).toBe(stream.id);
  });
});
