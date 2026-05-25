import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';

describe('PlaybookFlowReplayReportService', () => {
  it('creates a replay report document', async () => {
    const replayRunReportModel = {
      create: jest.fn().mockResolvedValue([{ id: 'report-1' }]),
    };
    const service = new PlaybookFlowReplayReportService(replayRunReportModel as any);

    await service.createReport({ executionId: 'exec-1', taskId: 'task-1' });

    expect(replayRunReportModel.create).toHaveBeenCalledWith([{ executionId: 'exec-1', taskId: 'task-1' }]);
  });

  it('updates report fields by id', async () => {
    const exec = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const replayRunReportModel = {
      updateOne: jest.fn(() => ({ exec })),
    };
    const service = new PlaybookFlowReplayReportService(replayRunReportModel as any);

    await service.updateReport('report-1', { verdict: 'pass' });

    expect(replayRunReportModel.updateOne).toHaveBeenCalledWith(
      { _id: 'report-1' },
      { $set: { verdict: 'pass' } },
    );
    expect(exec).toHaveBeenCalled();
  });

  it('finds the latest report record with lean query', async () => {
    const replayRunReportModel = {
      findOne: jest.fn(() => ({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ _id: 'report-1', taskId: 'task-1' }),
          }),
        }),
      })),
    };
    const service = new PlaybookFlowReplayReportService(replayRunReportModel as any);

    await expect(service.findLatestReportRecord({ executionId: 'exec-1' })).resolves.toEqual({ _id: 'report-1', taskId: 'task-1' });
    expect(replayRunReportModel.findOne).toHaveBeenCalledWith({ executionId: 'exec-1' });
  });

  it('lists reports filtered by flowId and taskId sorted newest-first', async () => {
    const foundDocs = [
      { _id: 'r2', createdAt: new Date('2026-01-02'), toJSON: jest.fn().mockReturnValue({ id: 'r2', createdAt: '2026-01-02' }) },
      { _id: 'r1', createdAt: new Date('2026-01-01'), toJSON: jest.fn().mockReturnValue({ id: 'r1', createdAt: '2026-01-01' }) },
    ];
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(foundDocs),
    };
    const replayRunReportModel = {
      find: jest.fn().mockReturnValue(chain),
    };
    const service = new PlaybookFlowReplayReportService(replayRunReportModel as any);

    const result = await service.listReports({
      flowId: 'flow-1',
      taskId: 'task-1',
      limit: 10,
      offset: 0,
    });

    expect(replayRunReportModel.find).toHaveBeenCalledWith({ flowId: 'flow-1', taskId: 'task-1' });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(result).toEqual([{ id: 'r2', createdAt: '2026-01-02' }, { id: 'r1', createdAt: '2026-01-01' }]);
  });

  it('lists reports with optional executionId and iteration filters', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const replayRunReportModel = {
      find: jest.fn().mockReturnValue(chain),
    };
    const service = new PlaybookFlowReplayReportService(replayRunReportModel as any);

    await service.listReports({
      flowId: 'flow-1',
      taskId: 'task-1',
      executionId: 'exec-1',
      iteration: 2,
    });

    expect(replayRunReportModel.find).toHaveBeenCalledWith({
      flowId: 'flow-1',
      taskId: 'task-1',
      executionId: 'exec-1',
      iteration: 2,
    });
  });

  it('finds the latest replay report lookup for an execution task', async () => {
    const replayRunReportModel = {
      findOne: jest.fn(() => ({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              executionId: 'exec-1',
              flowId: 'flow-1',
              taskId: 'task-1',
              replayId: 'replay-1',
              validationVersion: 2,
              applied: true,
            }),
          }),
        }),
      })),
    };
    const service = new PlaybookFlowReplayReportService(replayRunReportModel as any);

    await expect(service.findLatestReportForExecutionTask('exec-1', 'task-1')).resolves.toEqual({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      iteration: 0,
      replayId: 'replay-1',
      validationVersion: 2,
      applied: true,
    });
    expect(replayRunReportModel.findOne).toHaveBeenCalledWith({ executionId: 'exec-1', taskId: 'task-1' });
  });
});
