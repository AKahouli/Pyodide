import { PlaybookFlowReplayController } from './playbook-flow-replay.controller';

describe('PlaybookFlowReplayController', () => {
  const replayService = {
    validateTaskReplay: jest.fn(),
    updateTaskReplayFormatGuide: jest.fn(),
    listTaskReplays: jest.fn(),
  };
  const replayDriftService = {
    ensureIterationReportMaterialized: jest.fn(),
  };
  const replayReportService = {
    listReports: jest.fn(),
  };
  const flowService = {
    findOne: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    flowService.findOne.mockResolvedValue({ id: 'flow-1' });
  });

  it('forwards validate replay mode to the service', async () => {
    const controller = new PlaybookFlowReplayController(replayService as any, replayDriftService as any, replayReportService as any, flowService as any);
    replayService.validateTaskReplay.mockResolvedValue({ id: 'replay-1' });

    await controller.validateTaskReplay('user-1', 'flow-1', 'task-1', {
      executionId: 'exec-1',
      iteration: 2,
      preserveOutputFormat: true,
      mode: 'replay_flex' as any,
      replayConfig: { replayToolTrace: true },
    });

    expect(flowService.findOne).toHaveBeenCalledWith('flow-1', 'user-1');
    expect(replayService.validateTaskReplay).toHaveBeenCalledWith(
      'user-1',
      'flow-1',
      'task-1',
      2,
      'exec-1',
      {
        preserveOutputFormat: true,
        mode: 'replay_flex',
        replayConfig: { replayToolTrace: true },
      },
    );
  });

  it('forwards format guide dto to the service', async () => {
    const controller = new PlaybookFlowReplayController(replayService as any, replayDriftService as any, replayReportService as any, flowService as any);
    replayService.updateTaskReplayFormatGuide.mockResolvedValue({ id: 'replay-1' });

    const dto = {
      preserveOutputFormat: false,
      outputFormatGuide: 'Use Summary and Sources sections.',
      replayConfig: { replayOutputFormat: true },
    };

    await controller.updateTaskReplayFormatGuide('user-1', 'flow-1', 'task-1', 'replay-1', dto);

    expect(flowService.findOne).toHaveBeenCalledWith('flow-1', 'user-1');
    expect(replayService.updateTaskReplayFormatGuide).toHaveBeenCalledWith('flow-1', 'task-1', 'replay-1', dto);
  });

  it('forwards replay report query params to the report service', async () => {
    const controller = new PlaybookFlowReplayController(replayService as any, replayDriftService as any, replayReportService as any, flowService as any);
    replayReportService.listReports.mockResolvedValue([{ id: 'report-1' }]);

    await controller.listReplayReports('user-1', 'flow-1', 'task-1', {
      executionId: 'exec-1',
      limit: 5,
      offset: 2,
    } as any);

    expect(flowService.findOne).toHaveBeenCalledWith('flow-1', 'user-1');
    expect(replayReportService.listReports).toHaveBeenCalledWith({
      flowId: 'flow-1',
      taskId: 'task-1',
      executionId: 'exec-1',
      limit: 5,
      offset: 2,
    });
  });

  it('materializes iteration-scoped reports before listing them', async () => {
    const controller = new PlaybookFlowReplayController(replayService as any, replayDriftService as any, replayReportService as any, flowService as any);
    replayReportService.listReports.mockResolvedValue([{ id: 'report-1' }]);

    await controller.listReplayReports('user-1', 'flow-1', 'task-1', {
      executionId: 'exec-1',
      iteration: 2,
    } as any);

    expect(replayDriftService.ensureIterationReportMaterialized).toHaveBeenCalledWith('exec-1', 'task-1', 2);
    expect(replayReportService.listReports).toHaveBeenCalledWith({
      flowId: 'flow-1',
      taskId: 'task-1',
      executionId: 'exec-1',
      iteration: 2,
      limit: undefined,
      offset: undefined,
    });
  });

  it('checks flow ownership before listing task replays', async () => {
    const controller = new PlaybookFlowReplayController(replayService as any, replayDriftService as any, replayReportService as any, flowService as any);
    replayService.listTaskReplays.mockResolvedValue([]);

    await controller.listTaskReplays('user-1', 'flow-1', 'task-1');

    expect(flowService.findOne).toHaveBeenCalledWith('flow-1', 'user-1');
    expect(replayService.listTaskReplays).toHaveBeenCalledWith('flow-1', 'task-1');
  });
});
