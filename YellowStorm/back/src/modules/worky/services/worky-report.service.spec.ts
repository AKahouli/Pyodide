import { Types } from 'mongoose';
import { WorkyReportService } from './worky-report.service';

interface MakeOptions {
  streamStatus?: string;
  budget?: {
    limitUsd: number;
    limitTokens: number;
    spendUsd: number;
    tokensUsed: number;
    enforcement: 'hard_stop' | 'notify';
  };
  tasks?: Array<Record<string, unknown>>;
  auditCount?: number;
  costAgg?: Array<unknown>;
  existingReport?: unknown;
}

const makeService = (options: MakeOptions = {}) => {
  const streamObjectId = new Types.ObjectId();
  const ownerObjectId = new Types.ObjectId();
  const budget = options.budget ?? { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' };
  const stream = {
    _id: streamObjectId,
    ownerUserId: ownerObjectId,
    title: 'Test stream',
    status: options.streamStatus ?? 'completed',
    budget: { ...budget },
  };
  const streams = {
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ...stream, budget: { ...stream.budget } }) }),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) }),
  };
  const tasks = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(options.tasks ?? []),
        }),
      }),
    }),
  };
  const costEvents = {
    aggregate: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        options.costAgg ?? [{ _id: null, totalCostUsd: 0.1, totalInputTokens: 100, totalOutputTokens: 50, eventCount: 2 }],
      ),
    }),
  };
  const auditEvents = Array.from({ length: options.auditCount ?? 0 }, (_, i) => ({
    action: `audit.action.${i}`,
    createdAt: new Date(Date.now() - (options.auditCount! - i) * 1000),
  }));
  const audits = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(auditEvents),
        }),
      }),
    }),
  };
  const workers = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
  const interactions = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
  const reports: any = {
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(options.existingReport ?? null) }),
    create: jest.fn().mockImplementation((doc) =>
      Promise.resolve({
        _id: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...doc,
        save: jest.fn().mockResolvedValue(undefined),
      }),
    ),
  };
  // If `existingReport` is provided, simulate findOne returning it.
  if (options.existingReport) {
    const existingDoc: any = { ...(options.existingReport as object) };
    existingDoc.save = jest.fn().mockResolvedValue(existingDoc);
    reports.findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(existingDoc),
    });
  }
  const events = { emit: jest.fn() };
  const memory = { propose: jest.fn().mockResolvedValue({}) };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const service = new WorkyReportService(
    streams as any,
    tasks as any,
    reports as any,
    costEvents as any,
    audits as any,
    workers as any,
    interactions as any,
    events as any,
    memory as any,
    logger as any,
  );
  return { service, stream, streams, tasks, costEvents, audits, workers, interactions, reports, events, logger, memory };
};

describe('WorkyReportService.generate', () => {
  it('produces a rich report when budget is not exhausted', async () => {
    const { service, reports, events } = makeService({
      streamStatus: 'completed',
      budget: { limitUsd: 1, limitTokens: 0, spendUsd: 0.3, tokensUsed: 0, enforcement: 'hard_stop' },
      tasks: [
        { _id: new Types.ObjectId(), title: 'A', lane: 'done', executionState: 'done', actionCategory: 'internal_analysis' },
        { _id: new Types.ObjectId(), title: 'B', lane: 'backlog', executionState: 'not_started', actionCategory: 'drafting' },
      ],
    });
    const result = await service.generate(new Types.ObjectId().toString());
    expect(result.type).toBe('rich');
    expect(result.markdown).toContain('rich');
    expect(result.markdown).toContain('## Tasks');
    expect(result.markdown).toContain('## Cost');
    expect(reports.create).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'report.generated' }),
    );
  });

  it('produces a lightweight report when budget is exhausted', async () => {
    const { service, reports } = makeService({
      streamStatus: 'stopped',
      budget: { limitUsd: 1, limitTokens: 0, spendUsd: 1, tokensUsed: 0, enforcement: 'hard_stop' },
    });
    const result = await service.generate(new Types.ObjectId().toString());
    expect(result.type).toBe('lightweight');
    expect(result.markdown).toContain('lightweight');
    expect(result.markdown).toContain('Budget exhausted');
    expect(reports.create).toHaveBeenCalled();
  });

  it('overwrites the existing report instead of creating a duplicate', async () => {
    const existingId = new Types.ObjectId();
    const { service, reports } = makeService({
      streamStatus: 'completed',
      existingReport: {
        _id: existingId,
        streamId: new Types.ObjectId(),
        type: 'rich',
        status: 'ready',
        summary: 'old',
        markdown: 'old',
        metadata: {},
        generatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const result = await service.generate(new Types.ObjectId().toString());
    expect(reports.create).not.toHaveBeenCalled();
    expect(result.id).toBe(existingId.toString());
    expect(result.summary).not.toBe('old');
  });

  it('warns when the stream is not terminal but still generates', async () => {
    const { service, logger } = makeService({ streamStatus: 'active' });
    const result = await service.generate(new Types.ObjectId().toString());
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stream not terminal'),
      expect.objectContaining({ status: 'active' }),
    );
    expect(result).toBeDefined();
  });

  it('returns null from findForStream when no report exists', async () => {
    const { service } = makeService();
    expect(await service.findForStream(new Types.ObjectId().toString())).toBeNull();
  });

  it('auto-proposes a stream_summary memory after a rich report is generated', async () => {
    const { service, memory } = makeService({ streamStatus: 'completed' });
    await service.generate(new Types.ObjectId().toString());
    expect(memory.propose).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'stream_summary' }),
    );
  });

  it('does NOT mutate stream.status as a side effect of generate()', async () => {
    // Regression: previously the service called
    // `streams.updateOne({$set:{status: 'completed'|'stopped'}})`,
    // destroying the truthful terminal status. Status transitions
    // are owned by the lifecycle service, not the report service.
    const { service, streams } = makeService({ streamStatus: 'stopped' });
    await service.generate(new Types.ObjectId().toString());
    expect(streams.updateOne).not.toHaveBeenCalled();
  });
});
