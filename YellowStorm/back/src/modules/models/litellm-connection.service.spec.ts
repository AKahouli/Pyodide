import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { LoggerService } from '../logger';
import { LiteLLMConnectionService } from './litellm-connection.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn() },
  AxiosError: class AxiosError extends Error {},
}));

@Controller()
class ProbeController {
  @Get('probe')
  probe(): string { return 'ready'; }
}

describe('LiteLLM startup', () => {
  const logger = {
    setContext: jest.fn(), log: jest.fn(), warn: jest.fn(),
    error: jest.fn(), debug: jest.fn(),
  };
  const config = new ConfigService({ litellm: {
    apiUrl: 'http://proxy.invalid',
    healthCheck: { enabled: false },
    reconnect: { initialDelayMs: 60000 },
  } });

  it('serves HTTP while proxy health is pending, then reports connected', async () => {
    let resolveHealth!: () => void;
    const health = new Promise<void>((resolve) => { resolveHealth = resolve; });
    jest.mocked(axios.create).mockReturnValue({ get: jest.fn(() => health) } as unknown as ReturnType<typeof axios.create>);
    const module = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [LiteLLMConnectionService,
        { provide: ConfigService, useValue: config },
        { provide: LoggerService, useValue: logger }],
    }).compile();
    const app = module.createNestApplication();
    const service = app.get(LiteLLMConnectionService);
    try {
      await app.listen(0, '127.0.0.1');
      expect(service.isConnectedNow()).toBe(false);
      expect(service.getHttpClient()).not.toBeNull();
      const response = await fetch(`${await app.getUrl()}/probe`);
      expect(await response.text()).toBe('ready');
      resolveHealth();
      await health;
      expect(service.isConnectedNow()).toBe(true);
    } finally {
      resolveHealth();
      await app.close();
    }
  });

  it('retains retries on failure and clears them at shutdown', async () => {
    jest.mocked(axios.create).mockReturnValue({ get: jest.fn().mockRejectedValue(new Error('offline')) } as unknown as ReturnType<typeof axios.create>);
    const service = new LiteLLMConnectionService(config, logger as unknown as LoggerService);
    await service.connect();
    expect(service.getHealthStatus()).toMatchObject({ connected: false, error: 'offline', isReconnecting: true });
    service.onModuleDestroy();
    expect(service.getHealthStatus().isReconnecting).toBe(false);
  });

  it('does not schedule retries when a pending request fails after shutdown', async () => {
    let rejectHealth!: (error: Error) => void;
    const health = new Promise<void>((_, reject) => { rejectHealth = reject; });
    jest.mocked(axios.create).mockReturnValue({ get: jest.fn(() => health) } as unknown as ReturnType<typeof axios.create>);
    const service = new LiteLLMConnectionService(config, logger as unknown as LoggerService);
    const pending = service.connect();
    service.onModuleDestroy();
    rejectHealth(new Error('offline'));
    await pending;
    expect(service.getHealthStatus().isReconnecting).toBe(false);
  });
});
