import { newObjectId } from '@common/postgres';
import { WorkyReportService } from './worky-report.service';
import type { WorkyReportFields } from '../persistence/worky-report.repository';
import type {
  WorkyAuditEventRecord,
  WorkyExecutionReportRecord,
  WorkyStreamBudget,
  WorkyStreamRecord,
  WorkyTaskRecord,
} from '../worky.types';

interface MakeOptions {
  streamStatus?: string;
  budget?: Partial<WorkyStreamBudget>;
  tasks?: Array<Partial<WorkyTaskRecord>>;
  auditCount?: number;
  existingReport?: WorkyExecutionReportRecord;
}

const makeService = (options: MakeOptions = {}) => {
  const stream = {
    id: newObjectId(),
    ownerUserId: newObjectId(),
    title: 'Test stream',
    status: options.streamStatus ?? 'completed',
    budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop', ...options.budget },
  } as WorkyStreamRecord;
  const auditEvents: WorkyAuditEventRecord[] = Array.from({ length: options.auditCount ?? 0 }, (_, i) => ({
    id: newObjectId(),
    streamId: stream.id,
    actorUserId: null,
    action: `audit.action.${i}`,
    targetType: null,
    targetId: null,
    details: {},
    occurredAt: new Date(Date.UTC(2026, 8, 1, 10, 0, i)),
  }));
  const streams = {
    findById: jest.fn().mockResolvedValue(stream),
    update: jest.fn(),
  };
  const tasks = { listByStream: jest.fn().mockResolvedValue((options.tasks ?? []) as WorkyTaskRecord[]) };
  const budgets = {
    costTotals: jest.fn().mockResolvedValue({ totalCostUsd: 0.1, totalInputTokens: 100, totalOutputTokens: 50, eventCount: 2 }),
  };
  const audits = {
    listForScope: jest.fn().mockResolvedValue(auditEvents),
    listWorkersByStream: jest.fn().mockResolvedValue([]),
  };
  const interactions = { listByStream: jest.fn().mockResolvedValue([]) };
  const reports = {
    findByStream: jest.fn().mockResolvedValue(options.existingReport ?? null),
    // The real upsert keeps the row of the stream (same id) and overwrites its fields.
    upsert: jest.fn().mockImplementation(async (streamId: string, fields: WorkyReportFields) => ({
      id: options.existingReport?.id ?? newObjectId(),
      streamId,
      markdownArtifactId: null,
      createdAt: options.existingReport?.createdAt ?? new Date(),
      updatedAt: new Date(),
      ...fields,
    })),
  };
  const events = { emit: jest.fn() };
  const memory = { propose: jest.fn().mockResolvedValue({}) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new WorkyReportService(
    streams as never,
    tasks as never,
    reports as never,
    budgets as never,
    audits as never,
    interactions as never,
    events as never,
    memory as never,
    logger as never,
  );
  return { service, stream, streams, tasks, budgets, audits, interactions, reports, events, logger, memory, auditEvents };
};

describe('WorkyReportService.generate', () => {
  it('produces a rich report when budget is not exhausted', async () => {
    const { service, stream, tasks, budgets, audits, interactions, reports, events } = makeService({
      streamStatus: 'completed',
      budget: { limitUsd: 1, spendUsd: 0.3 },
      tasks: [
        { id: newObjectId(), title: 'A', lane: 'done', executionState: 'done', actionCategory: 'internal_analysis' },
        { id: newObjectId(), title: 'B', lane: 'backlog', executionState: 'not_started', actionCategory: 'drafting' },
      ],
    });
    const result = await service.generate(stream.id);
    expect(tasks.listByStream).toHaveBeenCalledWith(stream.id);
    expect(budgets.costTotals).toHaveBeenCalledWith(stream.id);
    expect(audits.listForScope).toHaveBeenCalledWith(stream.id);
    expect(audits.listWorkersByStream).toHaveBeenCalledWith(stream.id);
    expect(interactions.listByStream).toHaveBeenCalledWith(stream.id);
    expect(result.type).toBe('rich');
    expect(result.status).toBe('ready');
    expect(result.markdown).toContain('rich');
    expect(result.markdown).toContain('## Tasks');
    expect(result.markdown).toContain('- done: 1');
    expect(result.markdown).toContain('## Cost');
    expect(result.markdown).toContain('- USD total: $0.1000');
    expect(result.summary).toContain('Tasks: 2 (done=1 failed=0 canceled=0)');
    expect(result.summary).toContain('(150 tokens)');
    expect(reports.upsert).toHaveBeenCalledWith(
      stream.id,
      expect.objectContaining({ type: 'rich', status: 'ready', generatedAt: expect.any(Date) }),
    );
    expect(result.metadata).toMatchObject({ taskCount: 2, costEventCount: 2, budgetExhausted: false, generatedFromStatus: 'completed' });
    expect(events.emit).toHaveBeenCalledWith(
      stream.ownerUserId,
      stream.id,
      expect.objectContaining({ type: 'report.generated', payload: { reportId: result.id, type: 'rich', budgetExhausted: false } }),
    );
  });

  it('produces a lightweight report when budget is exhausted', async () => {
    const { service, stream, reports } = makeService({
      streamStatus: 'stopped',
      budget: { limitUsd: 1, spendUsd: 1 },
    });
    const result = await service.generate(stream.id);
    expect(result.type).toBe('lightweight');
    expect(result.markdown).toContain('lightweight');
    expect(result.markdown).toContain('Budget exhausted');
    expect(reports.upsert).toHaveBeenCalledWith(stream.id, expect.objectContaining({ type: 'lightweight' }));
  });

  it('prints when each audit event occurred', async () => {
    // Audit rows carry occurredAt, never createdAt: the trail used to print '?' for every line.
    const { service, stream, auditEvents } = makeService({ auditCount: 2 });
    const result = await service.generate(stream.id);
    expect(result.markdown).toContain(`- ${auditEvents[0].occurredAt.toISOString()} audit.action.0`);
    expect(result.markdown).toContain(`- ${auditEvents[1].occurredAt.toISOString()} audit.action.1`);
    expect(result.markdown).not.toContain('- ? ');
  });

  it('truncates the audit trail of a rich report after 200 rows', async () => {
    const { service, stream } = makeService({ auditCount: 205 });
    const result = await service.generate(stream.id);
    expect(result.markdown).toContain('audit.action.199');
    expect(result.markdown).not.toContain('audit.action.200');
    expect(result.markdown).toContain('- ... 5 more audit rows truncated');
  });

  it('overwrites the existing report instead of creating a duplicate', async () => {
    const existing: WorkyExecutionReportRecord = {
      id: newObjectId(),
      streamId: newObjectId(),
      type: 'rich',
      status: 'ready',
      markdownArtifactId: null,
      summary: 'old',
      markdown: 'old',
      metadata: {},
      generatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service, stream, reports } = makeService({ streamStatus: 'completed', existingReport: existing });
    const result = await service.generate(stream.id);
    expect(reports.upsert).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(existing.id);
    expect(result.summary).not.toBe('old');
  });

  it('warns when the stream is not terminal but still generates', async () => {
    const { service, stream, logger } = makeService({ streamStatus: 'active' });
    const result = await service.generate(stream.id);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stream not terminal'),
      expect.objectContaining({ status: 'active' }),
    );
    expect(result).toBeDefined();
  });

  it('throws for a malformed or unknown stream id', async () => {
    const { service, streams, reports } = makeService();
    await expect(service.generate('nope')).rejects.toThrow(/invalid streamId/);
    streams.findById.mockResolvedValueOnce(null);
    await expect(service.generate(newObjectId())).rejects.toThrow(/not found/);
    expect(reports.upsert).not.toHaveBeenCalled();
  });

  it('returns null from findForStream when no report exists', async () => {
    const { service } = makeService();
    expect(await service.findForStream(newObjectId())).toBeNull();
    expect(await service.findForStream('nope')).toBeNull();
  });

  it('returns the stored report from findForStream', async () => {
    const existing: WorkyExecutionReportRecord = {
      id: newObjectId(),
      streamId: newObjectId(),
      type: 'lightweight',
      status: 'ready',
      markdownArtifactId: null,
      summary: 's',
      markdown: 'm',
      metadata: { taskCount: 0 },
      generatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service, reports } = makeService({ existingReport: existing });
    const result = await service.findForStream(existing.streamId);
    expect(reports.findByStream).toHaveBeenCalledWith(existing.streamId);
    expect(result).toMatchObject({ id: existing.id, streamId: existing.streamId, type: 'lightweight', generatedAt: null });
  });

  it('auto-proposes a stream_summary memory after a rich report is generated', async () => {
    const { service, stream, memory } = makeService({ streamStatus: 'completed' });
    await service.generate(stream.id);
    expect(memory.propose).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: stream.ownerUserId, sourceStreamId: stream.id, category: 'stream_summary' }),
    );
  });

  it('still returns the report when the memory proposal fails', async () => {
    const { service, stream, memory, logger } = makeService();
    memory.propose.mockRejectedValueOnce(new Error('boom'));
    const result = await service.generate(stream.id);
    expect(result.status).toBe('ready');
    expect(logger.warn).toHaveBeenCalledWith('Worky memory proposal after report failed', expect.objectContaining({ error: 'boom' }));
  });

  it('does NOT mutate stream.status as a side effect of generate()', async () => {
    // Regression: previously the service called
    // `streams.updateOne({$set:{status: 'completed'|'stopped'}})`,
    // destroying the truthful terminal status. Status transitions
    // are owned by the lifecycle service, not the report service.
    const { service, stream, streams } = makeService({ streamStatus: 'stopped' });
    await service.generate(stream.id);
    expect(streams.update).not.toHaveBeenCalled();
  });
});
