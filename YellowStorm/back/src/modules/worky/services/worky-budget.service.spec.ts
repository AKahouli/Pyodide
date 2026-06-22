import { Types } from 'mongoose';
import { WorkyBudgetService } from './worky-budget.service';

interface MakeOptions {
  streamBudget?: {
    limitUsd: number;
    limitTokens: number;
    spendUsd: number;
    tokensUsed: number;
    enforcement: 'hard_stop' | 'notify';
  };
  updateOneNull?: boolean;
  costEvents?: Array<unknown>;
}

const makeService = (options: MakeOptions = {}) => {
  const streamObjectId = new Types.ObjectId();
  const ownerObjectId = new Types.ObjectId();
  const taskObjectId = new Types.ObjectId();
  const budget = options.streamBudget ?? {
    limitUsd: 1.0,
    limitTokens: 0,
    spendUsd: 0,
    tokensUsed: 0,
    enforcement: 'hard_stop' as 'hard_stop' | 'notify',
  };
  const stream = {
    _id: streamObjectId,
    ownerUserId: ownerObjectId,
    title: 'Test stream',
    budget: { ...budget },
  };
  const streams = {
    findById: jest.fn().mockImplementation(() => ({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...stream, budget: { ...stream.budget } }),
      }),
      exec: jest.fn().mockResolvedValue({ ...stream, budget: { ...stream.budget } }),
    })),
    findOneAndUpdate: jest.fn().mockImplementation((filter) => ({
      exec: jest.fn().mockResolvedValue(
        options.updateOneNull
          ? null
          : { ...stream, budget: { ...stream.budget, spendUsd: stream.budget.spendUsd + (filter?.$inc?.['budget.spendUsd'] ?? 0) } },
      ),
    })),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) }),
  };
  const tasks = {
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) }),
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: taskObjectId,
            streamId: streamObjectId,
            budget: { estimateUsd: 0.1, actualUsd: 0, tokensEstimate: 100, tokensActual: 0 },
          }),
        }),
      }),
    }),
  };
  const reservations = {
    create: jest.fn().mockImplementation((doc) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    ),
    findById: jest.fn().mockImplementation((id) => ({
      exec: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(id),
        streamId: streamObjectId,
        amountUsd: 0.1,
        tokens: 0,
        status: 'reserved',
      }),
    })),
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ status: 'released' }) }),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) }),
  };
  const costEvents = {
    create: jest.fn().mockImplementation((doc) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    ),
    aggregate: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        options.costEvents ?? [
          { _id: null, totalCostUsd: 0.05, totalTokens: 50 },
        ],
      ),
    }),
  };
  const interactions = {
    create: jest.fn().mockImplementation((doc) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    ),
  };
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const events = {
    emit: jest.fn((_userId: string, _streamId: string, e: { type: string; payload: unknown }) => {
      emitted.push({ type: e.type, payload: e.payload });
    }),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const service = new WorkyBudgetService(
    streams as any,
    tasks as any,
    reservations as any,
    costEvents as any,
    interactions as any,
    events as any,
    audit as any,
    logger as any,
  );
  return {
    service,
    stream,
    streams,
    reservations,
    costEvents,
    events,
    audit,
    emitted,
    taskObjectId,
    streamObjectId,
    interactions,
    tasks,
  };
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
  it('accepts the reservation when stream has no limits', async () => {
    const { service, reservations, emitted } = makeService({
      streamBudget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
    });
    const result = await service.reserve({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      amountUsd: 0.5,
      tokens: 100,
    });
    expect(result.status).toBe('reserved');
    expect(reservations.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'reserved' }),
    );
    expect(emitted.find((e) => e.type === 'budget.reserved')).toBeDefined();
  });

  it('denies reservation when it would exceed the limit and creates a budget_decision interaction under hard_stop', async () => {
    const { service, interactions, emitted } = makeService({ updateOneNull: true });
    const result = await service.reserve({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      amountUsd: 0.5,
      tokens: 0,
    });
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('budget_exhausted');
    expect(interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'budget_decision', blockingScope: 'stream' }),
    );
    expect(emitted.find((e) => e.type === 'budget.exhausted')).toBeDefined();
    expect(emitted.find((e) => e.type === 'budget_decision.requested')).toBeDefined();
  });

  it('denies reservation under notify enforcement but does not raise an interaction', async () => {
    const { service, interactions, emitted } = makeService({
      streamBudget: { limitUsd: 1, limitTokens: 0, spendUsd: 0.5, tokensUsed: 0, enforcement: 'notify' },
      updateOneNull: true,
    });
    const result = await service.reserve({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      amountUsd: 0.6,
      tokens: 0,
    });
    expect(result.status).toBe('denied');
    expect(interactions.create).not.toHaveBeenCalled();
    expect(emitted.find((e) => e.type === 'budget.exhausted')).toBeDefined();
  });
});

describe('WorkyBudgetService.release', () => {
  it('decrements the stream spend when releasing a reserved reservation', async () => {
    const { service, streams } = makeService();
    await service.release(new Types.ObjectId().toString());
    expect(streams.updateOne).toHaveBeenCalled();
  });
  it('is a no-op for an unknown reservation id', async () => {
    const { service, streams } = makeService();
    await service.release('not-a-valid-id');
    expect(streams.updateOne).not.toHaveBeenCalled();
  });
});

describe('WorkyBudgetService.recordCost', () => {
  it('persists a cost event and increments the task budget', async () => {
    const { service, costEvents, tasks, events } = makeService();
    const result = await service.recordCost({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      type: 'llm',
      provider: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.02,
    });
    expect(costEvents.create).toHaveBeenCalled();
    expect(tasks.updateOne).toHaveBeenCalled();
    expect(result.totalCostUsd).toBe(0.05);
    // No overspend → no event emitted by the service (the controller
    // emits `cost.recorded` separately).
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('WorkyBudgetService.getSnapshot', () => {
  it('returns the live budget with remainingUsd/tokens + exhausted flag', async () => {
    const { service } = makeService({
      streamBudget: { limitUsd: 1, limitTokens: 1000, spendUsd: 0.7, tokensUsed: 500, enforcement: 'hard_stop' },
    });
    const snap = await service.getSnapshot(new Types.ObjectId().toString());
    expect(snap.remainingUsd).toBeCloseTo(0.3);
    expect(snap.remainingTokens).toBe(500);
    expect(snap.exhausted).toBe(false);
  });
  it('reports exhausted when spend >= limit', async () => {
    const { service } = makeService({
      streamBudget: { limitUsd: 1, limitTokens: 0, spendUsd: 1, tokensUsed: 0, enforcement: 'hard_stop' },
    });
    const snap = await service.getSnapshot(new Types.ObjectId().toString());
    expect(snap.exhausted).toBe(true);
  });
});

describe('WorkyBudgetService.setLimits', () => {
  it('updates the limits, emits budget.updated, and returns the snapshot', async () => {
    const { service, streams, events } = makeService();
    const result = await service.setLimits(new Types.ObjectId().toString(), {
      limitUsd: 5,
      limitTokens: 1000,
      enforcement: 'notify',
    });
    expect(streams.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({
        $set: expect.objectContaining({
          'budget.limitUsd': 5,
          'budget.limitTokens': 1000,
          'budget.enforcement': 'notify',
        }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'budget.updated' }),
    );
    // Snapshot reflects the mock's static state.
    expect(result).toBeDefined();
  });
});

describe('WorkyBudgetService concurrent reservations (race)', () => {
  it('the conditional guard filter references the limit and the new amount', async () => {
    // Faithfully exercise the conditional `$expr` guard by passing a
    // mock that captures the filter shape. This proves the service
    // builds an atomic conditional update, not a read-then-write.
    const calls: Array<Record<string, unknown>> = [];
    const stream = {
      _id: new Types.ObjectId(),
      ownerUserId: new Types.ObjectId(),
      title: 'Race stream',
      budget: { limitUsd: 1.0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
    };
    const streams = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...stream, budget: { ...stream.budget } }),
      }),
      findOneAndUpdate: jest.fn().mockImplementation((filter: Record<string, unknown>) => {
        calls.push(filter);
        return { exec: jest.fn().mockResolvedValue({ ...stream, budget: { ...stream.budget, spendUsd: 0.1 } }) };
      }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) }),
    };
    const tasks = { updateOne: jest.fn(), findById: jest.fn() };
    const reservations = {
      create: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc })),
    };
    const costEvents = { create: jest.fn(), aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };
    const interactions = { create: jest.fn() };
    const events = { emit: jest.fn() };
    const audit = { append: jest.fn() };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const service = new WorkyBudgetService(
      streams as any,
      tasks as any,
      reservations as any,
      costEvents as any,
      interactions as any,
      events as any,
      audit as any,
      logger as any,
    );
    await service.reserve({
      streamId: stream._id.toString(),
      taskId: new Types.ObjectId().toString(),
      amountUsd: 0.1,
      tokens: 0,
    });
    expect(calls).toHaveLength(1);
    const filter = calls[0]!;
    expect(filter).toHaveProperty('$expr');
    // The guard references the limit (`$budget.limitUsd`) — proves the
    // service performs an atomic conditional update.
    const expr = filter.$expr as { $lte: Array<unknown> };
    const serialized = JSON.stringify(expr);
    expect(serialized).toContain('budget.limitUsd');
    expect(serialized).toContain('budget.spendUsd');
  });

  it('recordCost uses post-increment actualUsd directly (no double-count)', async () => {
    // Regression: previously `actualUsd + input.costUsd > ceiling`
    // double-counted the cost. Now we compare `actualUsd > ceiling`
    // (actualUsd already includes the new cost).
    const streamObjectId = new Types.ObjectId();
    const taskObjectId = new Types.ObjectId();
    const stream = {
      _id: streamObjectId,
      ownerUserId: new Types.ObjectId(),
      budget: { limitUsd: 1.0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
    };
    const streams = {
      findById: jest.fn().mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ ...stream, budget: { ...stream.budget } }),
          }),
        }),
        exec: jest.fn().mockResolvedValue({ ...stream, budget: { ...stream.budget } }),
      })),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    const tasks = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            // estimateUsd=0.1, OVERSPEND_BAND=0.1 → ceiling=0.11.
            // actualUsd=0.15 is already above ceiling (simulating
            // post-increment state). We must flag overspend=true
            // and NOT require actualUsd+costUsd > ceiling.
            exec: jest.fn().mockResolvedValue({
              _id: taskObjectId,
              streamId: streamObjectId,
              budget: { estimateUsd: 0.1, actualUsd: 0.15, tokensEstimate: 100, tokensActual: 0 },
            }),
          }),
        }),
      }),
    };
    const reservations = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    const costEvents = {
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      aggregate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ totalCostUsd: 0.15, totalTokens: 0 }]),
      }),
    };
    const events = { emit: jest.fn() };
    const service = new WorkyBudgetService(
      streams as any,
      tasks as any,
      reservations as any,
      costEvents as any,
      {} as any,
      events as any,
      {} as any,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    );
    const result = await service.recordCost({
      streamId: streamObjectId.toString(),
      taskId: taskObjectId.toString(),
      type: 'tool',
      provider: 'p',
      modelId: 'm',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.05,
    });
    expect(result.overspend).toBe(true);
  });
});
