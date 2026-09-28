import { PlaybookFlowScheduleService } from './playbook-flow-schedule.service';

describe('PlaybookFlowScheduleService', () => {
  const NOW = new Date('2026-09-25T10:15:30.000Z');
  const due = { kind: 'schedule', params: { enabled: true, scheduleType: 'daily', timezone: 'UTC', daily: { timesLocal: ['10:15'] } } };

  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  const build = (flowList: Array<{ id: string; ownerId: string; triggerConfig: unknown }>, active: string[] = []) => {
    const flows = {
      listByTrigger: jest.fn().mockResolvedValue(flowList.map((flow) => ({ ...flow, workspaces: [] }))),
      setTriggerParam: jest.fn().mockResolvedValue(true),
    };
    const executions = { hasActiveForFlow: jest.fn(async (flowId: string) => active.includes(flowId)) };
    const executionService = { start: jest.fn().mockResolvedValue({ id: 'exec-1' }) };
    const logger = { setContext: jest.fn(), debug: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const service = new PlaybookFlowScheduleService(flows as any, executions as any, executionService as any, logger as any);
    return { service, flows, executions, executionService, logger };
  };

  it('starts a due flow with a per-minute idempotency key and stamps the run on its trigger', async () => {
    const { service, flows, executionService } = build([{ id: 'flow-1', ownerId: 'user-1', triggerConfig: due }]);

    await service.runDueSchedules();

    expect(flows.listByTrigger).toHaveBeenCalledWith('schedule');
    expect(executionService.start).toHaveBeenCalledWith('flow-1', 'user-1', undefined, 'schedule:flow-1:2026-09-25T10:15');
    expect(flows.setTriggerParam).toHaveBeenCalledWith('flow-1', 'lastScheduledRunAt', NOW);
  });

  it('skips a flow that already has a running or paused execution, and one that is not due', async () => {
    const { service, flows, executions, executionService } = build([
      { id: 'busy', ownerId: 'user-1', triggerConfig: due },
      { id: 'disabled', ownerId: 'user-1', triggerConfig: { kind: 'schedule', params: { enabled: false } } },
      { id: 'ran', ownerId: 'user-1', triggerConfig: { kind: 'schedule', params: { ...due.params, lastScheduledRunAt: '2026-09-25T10:15:05.000Z' } } },
    ], ['busy']);

    await service.runDueSchedules();

    expect(executions.hasActiveForFlow).toHaveBeenCalledWith('busy');
    expect(executionService.start).not.toHaveBeenCalled();
    expect(flows.setTriggerParam).not.toHaveBeenCalled();
  });

  it('logs a failed start and carries on without stamping the run', async () => {
    const { service, flows, executionService, logger } = build([{ id: 'flow-1', ownerId: 'user-1', triggerConfig: due }]);
    executionService.start.mockRejectedValueOnce(new Error('quota'));

    await service.runDueSchedules();

    expect(flows.setTriggerParam).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Scheduled flow run failed', { flowId: 'flow-1', error: 'quota' });
  });
});
