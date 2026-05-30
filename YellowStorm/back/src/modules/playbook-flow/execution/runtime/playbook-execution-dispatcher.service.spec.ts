import { ConfigService } from '@nestjs/config';

import { PlaybookExecutionDispatcherService } from './playbook-execution-dispatcher.service';

describe('PlaybookExecutionDispatcherService', () => {
  const configService = {
    get: jest.fn().mockReturnValue(25),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces multiple scheduled drains for the same owner', async () => {
    const service = new PlaybookExecutionDispatcherService(configService);
    const drainQueue = jest.fn().mockResolvedValue(undefined);

    service.schedule('owner-1', drainQueue);
    service.schedule('owner-1', drainQueue);
    await jest.advanceTimersByTimeAsync(25);

    expect(drainQueue).toHaveBeenCalledTimes(1);
    expect(drainQueue).toHaveBeenCalledWith('owner-1');
  });

  it('allows a new drain after the previous drain fires', async () => {
    const service = new PlaybookExecutionDispatcherService(configService);
    const drainQueue = jest.fn().mockResolvedValue(undefined);

    service.schedule('owner-1', drainQueue);
    await jest.advanceTimersByTimeAsync(25);
    service.schedule('owner-1', drainQueue);
    await jest.advanceTimersByTimeAsync(25);

    expect(drainQueue).toHaveBeenCalledTimes(2);
  });

  it('clears all pending drains on module destroy', async () => {
    const service = new PlaybookExecutionDispatcherService(configService);
    const drainQueue = jest.fn().mockResolvedValue(undefined);

    service.schedule('owner-1', drainQueue);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(25);

    expect(drainQueue).not.toHaveBeenCalled();
  });
});
