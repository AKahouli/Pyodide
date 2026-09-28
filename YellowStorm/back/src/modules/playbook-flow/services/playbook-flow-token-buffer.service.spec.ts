import { PlaybookFlowTokenBufferService } from './playbook-flow-token-buffer.service';
import { DEFAULT_ADMIN_PLAYBOOK_SETTINGS } from '@modules/system/interfaces/playbook-settings.interface';

function createService(config: Record<string, unknown> = {}) {
  const taskResultRepository = {
    appendOutput: jest.fn().mockResolvedValue(true),
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
    taskResultRepository as any,
    configService as any,
    systemService as any,
    streamEvents as any,
  );

  return { service, taskResultRepository, streamEvents };
}

describe('PlaybookFlowTokenBufferService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits token updates immediately but delays persistence until flush', async () => {
    const { service, taskResultRepository, streamEvents } = createService();

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'Hel');
    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'lo');

    expect(streamEvents.emitStepUpdate).not.toHaveBeenCalled();
    expect(taskResultRepository.appendOutput).not.toHaveBeenCalled();

    await service.flushTask({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 });

    expect(streamEvents.emitStepUpdate).toHaveBeenCalledWith('exec-1', 'step-1', 'Hello');
    expect(taskResultRepository.appendOutput).toHaveBeenCalledTimes(1);
    expect(taskResultRepository.appendOutput).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      'Hello',
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
    const { service, taskResultRepository } = createService({
      'playbook-flow.tokenBufferMaxBytes': 5,
    });

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'Hello');

    expect(taskResultRepository.appendOutput).toHaveBeenCalledTimes(1);
  });

  it('flushes all task buffers for an execution before terminal handling', async () => {
    const { service, taskResultRepository } = createService();

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'A');
    await service.appendToken({ executionId: 'exec-1', taskId: 'step-2', iteration: 0 }, 'B');
    await service.appendToken({ executionId: 'exec-2', taskId: 'step-1', iteration: 0 }, 'C');

    await service.flushExecution('exec-1');

    expect(taskResultRepository.appendOutput).toHaveBeenCalledTimes(2);
    await service.flushExecution('exec-2');
    expect(taskResultRepository.appendOutput).toHaveBeenCalledTimes(3);
  });

  it('flushes automatically after the configured interval', async () => {
    jest.useFakeTimers();
    const { service, taskResultRepository } = createService({
      'playbook-flow.tokenBufferFlushIntervalMs': 500,
    });

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'A');
    jest.advanceTimersByTime(500);
    await Promise.resolve();

    expect(taskResultRepository.appendOutput).toHaveBeenCalledTimes(1);
  });

  it('writes a token at the per-task size limit straight through', async () => {
    const { service, taskResultRepository } = createService({
      'playbook-flow.tokenBufferMaxTaskBytes': 4,
    });

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 2 }, 'Large');

    expect(taskResultRepository.appendOutput).toHaveBeenCalledWith({ executionId: 'exec-1', taskId: 'step-1', iteration: 2 }, 'Large');
  });

  it('flushes remaining buffers during shutdown', async () => {
    const { service, taskResultRepository } = createService();

    await service.appendToken({ executionId: 'exec-1', taskId: 'step-1', iteration: 0 }, 'A');
    await service.onModuleDestroy();

    expect(taskResultRepository.appendOutput).toHaveBeenCalledTimes(1);
  });
});
