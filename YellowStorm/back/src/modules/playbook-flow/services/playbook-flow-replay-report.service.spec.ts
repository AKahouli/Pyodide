import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';

function makeRepository(overrides: Record<string, jest.Mock> = {}) {
  return {
    create: jest.fn().mockResolvedValue({ id: 'report-1' }),
    update: jest.fn().mockResolvedValue(true),
    findLatest: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    latestScoresForReplays: jest.fn().mockResolvedValue(new Map()),
    ...overrides,
  };
}

describe('PlaybookFlowReplayReportService', () => {
  it('creates a replay report', async () => {
    const repository = makeRepository();
    const service = new PlaybookFlowReplayReportService(repository as any);

    const report = await service.createReport({ executionId: 'exec-1', taskId: 'task-1' } as any);

    expect(repository.create).toHaveBeenCalledWith({ executionId: 'exec-1', taskId: 'task-1' });
    expect(report).toEqual({ id: 'report-1' });
  });

  it('updates report fields by id', async () => {
    const repository = makeRepository();
    const service = new PlaybookFlowReplayReportService(repository as any);

    await service.updateReport('report-1', { verdict: 'pass' });

    expect(repository.update).toHaveBeenCalledWith('report-1', { verdict: 'pass' });
  });

  it('finds the latest report record matching the filter', async () => {
    const repository = makeRepository({ findLatest: jest.fn().mockResolvedValue({ id: 'report-1', taskId: 'task-1' }) });
    const service = new PlaybookFlowReplayReportService(repository as any);

    await expect(service.findLatestReportRecord({ executionId: 'exec-1', taskId: 'task-1' })).resolves.toEqual({ id: 'report-1', taskId: 'task-1' });
    expect(repository.findLatest).toHaveBeenCalledWith({ executionId: 'exec-1', taskId: 'task-1' });
  });

  it('strips legacy eligibility fields from the latest report record without touching the stored record object', async () => {
    const stored = { id: 'report-1', applied: true, confidenceScore: 40, verdict: 'skipped', verdictReasons: ['replay_not_applied', 'x'] };
    const repository = makeRepository({ findLatest: jest.fn().mockResolvedValue(stored) });
    const service = new PlaybookFlowReplayReportService(repository as any);

    await expect(service.findLatestReportRecord({ executionId: 'exec-1', taskId: 'task-1', iteration: 2 })).resolves.toEqual({
      id: 'report-1',
      verdict: 'unknown',
      verdictReasons: ['x'],
    });
    expect(stored.applied).toBe(true);
  });

  it('returns null when no report matches', async () => {
    const service = new PlaybookFlowReplayReportService(makeRepository() as any);

    await expect(service.findLatestReportRecord({ executionId: 'exec-1', taskId: 'task-1' })).resolves.toBeNull();
  });

  it('lists reports filtered by flowId and taskId, newest first, with the hydrated defaults', async () => {
    const repository = makeRepository({
      list: jest.fn().mockResolvedValue([
        { id: 'r2', createdAt: new Date('2026-01-02') },
        { id: 'r1', createdAt: new Date('2026-01-01'), verdictReasons: ['kept'] },
      ]),
    });
    const service = new PlaybookFlowReplayReportService(repository as any);

    const result = await service.listReports({
      flowId: 'flow-1',
      taskId: 'task-1',
      limit: 10,
      offset: 0,
    });

    expect(repository.list).toHaveBeenCalledWith({ flowId: 'flow-1', taskId: 'task-1', executionId: undefined, iteration: undefined, offset: 0, limit: 10 });
    expect(result.map((report) => report.id)).toEqual(['r2', 'r1']);
    expect(result[0]).toMatchObject({
      verdictReasons: [],
      driftFindings: [],
      semanticStatus: { status: 'not_evaluated', reason: 'evaluation_pending' },
      postRunEvaluation: null,
      hitlSummary: null,
    });
    expect(result[1].verdictReasons).toEqual(['kept']);
  });

  it('caps the page at 50 and defaults it to 20', async () => {
    const repository = makeRepository();
    const service = new PlaybookFlowReplayReportService(repository as any);

    await service.listReports({ flowId: 'flow-1', taskId: 'task-1', limit: 500, offset: 5 });
    await service.listReports({ flowId: 'flow-1', taskId: 'task-1' });

    expect(repository.list.mock.calls[0][0]).toMatchObject({ limit: 50, offset: 5 });
    expect(repository.list.mock.calls[1][0]).toMatchObject({ limit: 20, offset: 0 });
  });

  it('sanitizes legacy eligibility fields and verdicts from listed reports', async () => {
    const repository = makeRepository({
      list: jest.fn().mockResolvedValue([{
        id: 'r1',
        applied: false,
        confidenceScore: 45,
        confidenceFactors: { nodeSnapshotHash: 0 },
        invalidationReasons: ['confidence_below_threshold'],
        appliedSections: [],
        skippedSections: ['tool_policy'],
        verdict: 'skipped',
        verdictReasons: ['replay_not_applied'],
        blockedBy: ['confidence_below_threshold'],
      }]),
    });
    const service = new PlaybookFlowReplayReportService(repository as any);

    const [report] = await service.listReports({ flowId: 'flow-1', taskId: 'task-1' });

    expect(report).toMatchObject({ id: 'r1', verdict: 'unknown', verdictReasons: [], blockedBy: [] });
    for (const legacy of ['applied', 'confidenceScore', 'confidenceFactors', 'invalidationReasons', 'appliedSections', 'skippedSections']) {
      expect(report).not.toHaveProperty(legacy);
    }
  });

  it('lists reports with optional executionId and iteration filters', async () => {
    const repository = makeRepository();
    const service = new PlaybookFlowReplayReportService(repository as any);

    await service.listReports({
      flowId: 'flow-1',
      taskId: 'task-1',
      executionId: 'exec-1',
      iteration: 2,
    });

    expect(repository.list).toHaveBeenCalledWith({
      flowId: 'flow-1',
      taskId: 'task-1',
      executionId: 'exec-1',
      iteration: 2,
      offset: 0,
      limit: 20,
    });
  });

  it('reads the latest scores of the given replays, and skips the query for none', async () => {
    const scores = new Map([['replay-1', 88]]);
    const repository = makeRepository({ latestScoresForReplays: jest.fn().mockResolvedValue(scores) });
    const service = new PlaybookFlowReplayReportService(repository as any);

    await expect(service.findLatestScoresForReplays(['replay-1', 'replay-2'])).resolves.toBe(scores);
    expect(repository.latestScoresForReplays).toHaveBeenCalledWith(['replay-1', 'replay-2']);
    await expect(service.findLatestScoresForReplays([])).resolves.toEqual(new Map());
    expect(repository.latestScoresForReplays).toHaveBeenCalledTimes(1);
  });

  it('finds the latest replay report lookup for an execution task', async () => {
    const repository = makeRepository({
      findLatest: jest.fn().mockResolvedValue({
        id: 'report-1',
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'task-1',
        iteration: 0,
        replayId: 'replay-1',
        validationVersion: 2,
        applied: true,
        confidenceScore: 42,
        invalidationReasons: ['node_snapshot_mismatch'],
        verdict: 'unknown',
      }),
    });
    const service = new PlaybookFlowReplayReportService(repository as any);

    await expect(service.findLatestReportForExecutionTask('exec-1', 'task-1')).resolves.toEqual({
      _id: 'report-1',
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      iteration: 0,
      replayId: 'replay-1',
      validationVersion: 2,
    });
    expect(repository.findLatest).toHaveBeenCalledWith({ executionId: 'exec-1', taskId: 'task-1' });

    await service.findLatestReportForExecutionTask('exec-1', 'task-1', 3);
    expect(repository.findLatest).toHaveBeenLastCalledWith({ executionId: 'exec-1', taskId: 'task-1', iteration: 3 });
  });

  it('returns null lookup when the execution task has no report', async () => {
    const service = new PlaybookFlowReplayReportService(makeRepository() as any);

    await expect(service.findLatestReportForExecutionTask('exec-1', 'task-1', 0)).resolves.toBeNull();
  });
});
