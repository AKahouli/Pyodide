import { PlaybookFlowTokenBufferService } from './playbook-flow-token-buffer.service';
import { DEFAULT_ADMIN_PLAYBOOK_SETTINGS } from '@modules/system/interfaces/playbook-settings.interface';

function createService(config: Record<string, unknown> = {}) {
  const taskResultModel = {
    updateOne: jest.fn().mockResolvedValue(undefined),
  };
  const configService = {
    get: jest.fn((key: string, fallback: unknown) => config[key] ?? fallback),
  };
  const streamEvents = {
    emitStepUpdate: jest.fn(),
  };
  const systemService = {
    getPlaybookSettings: jest.fn().mockResolvedValue({
      playbookExecution: { ...DEFAULT_ADMIN_PLAYBOOK_SETTINGS.playbookExecution, tokenBufferEnabled: false },
    }),
  };
  const service = new PlaybookFlowTokenBufferService(
    taskResultModel as any,
    configService as any,
    systemService as any,
    streamEvents as any,
  );

  return { service, taskResultModel, streamEvents };
}

describe('PlaybookFlowTokenBufferService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits token updates immediately but delays Mongo persistence until flush', async () => {
    const { service, taskResultModel, streamEvents } = createService();

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'Hel');
    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'lo');

    expect(streamEvents.emitStepUpdate).not.toHaveBeenCalled();
    expect(taskResultModel.updateOne).not.toHaveBeenCalled();

    await service.flushTask({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 });

    expect(streamEvents.emitStepUpdate).toHaveBeenCalledWith('exec-1', 'step-1', 'Hello');
    expect(taskResultModel.updateOne).toHaveBeenCalledTimes(1);
    expect(taskResultModel.updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      [expect.objectContaining({
        $set: expect.objectContaining({
          output: { $concat: [{ $ifNull: ['$output', ''] }, 'Hello'] },
        }),
      })],
      { upsert: true },
    );
  });

  it('redacts private paths split across token chunks before SSE emission', async () => {
    const { service, streamEvents } = createService();
    const key = { executionId: 'exec-1', taskId: 'step-1', iteration: 0 };

    await service.appendToken(key, 'Saved at /mnt/work');
    await service.appendToken(key, 'space/private/report.pdf');
    await service.appendToken(key, ' done');
    await service.flushTask(key);

    const emitted = streamEvents.emitStepUpdate.mock.calls.map((call) => call[2]).join('');
    expect(emitted).toBe('Saved at [REDACTED] done');
    expect(emitted).not.toContain('/mnt/workspace');
  });

  it('flushes when buffered bytes reach the configured threshold', async () => {
    const { service, taskResultModel } = createService({
      'playbook-flow.tokenBufferMaxBytes': 5,
    });

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'Hello');

    expect(taskResultModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('flushes all task buffers for an execution before terminal handling', async () => {
    const { service, taskResultModel } = createService();

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'A');
    await service.appendToken({ executionId: 'exec-1', taskId: 'step-2', iteration: 0 }, 'B');
    await service.appendToken({ executionId: 'exec-2', taskId: 'step-1', iteration: 0 }, 'C');

    await service.flushExecution('exec-1');

    expect(taskResultModel.updateOne).toHaveBeenCalledTimes(2);
    await service.flushExecution('exec-2');
    expect(taskResultModel.updateOne).toHaveBeenCalledTimes(3);
  });

  it('flushes automatically after the configured interval', async () => {
    jest.useFakeTimers();
    const { service, taskResultModel } = createService({
      'playbook-flow.tokenBufferFlushIntervalMs': 500,
    });

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'A');
    jest.advanceTimersByTime(500);
    await Promise.resolve();

    expect(taskResultModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('flushes remaining buffers during shutdown', async () => {
    const { service, taskResultModel } = createService();

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'A');
    await service.onModuleDestroy();

    expect(taskResultModel.updateOne).toHaveBeenCalledTimes(1);
  });
});
