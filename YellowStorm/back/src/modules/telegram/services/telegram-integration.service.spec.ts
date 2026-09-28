import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@common/services/crypto.service';
import { AgentService } from '@modules/agent/agent.service';
import { LoggerService } from '@modules/logger';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { TelegramIntegrationService } from './telegram-integration.service';
import { TelegramApiService } from './telegram-api.service';
import { TelegramLinkCodeService } from './telegram-link-code.service';
import { TelegramIntegrationStatus } from '../telegram.types';
import { TELEGRAM_INTEGRATION_STORE } from '../persistence/telegram.store';
import { InMemoryTelegramIntegrationStore } from '../persistence/telegram.store.fake';

const USER_ID = '507f191e810c19729de860ea';
const AGENT_ID = '507f1f77bcf86cd799439011';

describe('TelegramIntegrationService', () => {
  let service: TelegramIntegrationService;
  let integrationStore: InMemoryTelegramIntegrationStore;

  const mockCryptoService = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn((value: string) => value.replace('encrypted:', '')),
  };

  const defaultConfigGet = (key: string, defaultValue?: unknown) => {
    if (key === 'app.backendUrl') return 'https://api.example.com';
    return defaultValue;
  };

  const mockConfigService = {
    get: jest.fn(defaultConfigGet),
  };

  const mockAgentService = {
    findUserAgentById: jest.fn().mockResolvedValue({ id: AGENT_ID }),
  };

  const mockTelegramApiService = {
    getMe: jest.fn().mockResolvedValue({ username: 'my_agent_bot', id: 123 }),
    setWebhook: jest.fn().mockResolvedValue(undefined),
    deleteWebhook: jest.fn().mockResolvedValue(undefined),
  };

  const mockLinkCodeService = {
    generateForIntegration: jest.fn().mockResolvedValue({
      code: 'AB12CD34',
      expiresAt: '2026-05-26T10:15:00.000Z',
    }),
  };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    integrationStore = new InMemoryTelegramIntegrationStore();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramIntegrationService,
        { provide: TELEGRAM_INTEGRATION_STORE, useValue: integrationStore },
        { provide: CryptoService, useValue: mockCryptoService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AgentService, useValue: mockAgentService },
        { provide: TelegramApiService, useValue: mockTelegramApiService },
        { provide: TelegramLinkCodeService, useValue: mockLinkCodeService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<TelegramIntegrationService>(TelegramIntegrationService);
  });

  afterEach(() => {
    mockConfigService.get.mockImplementation(defaultConfigGet);
  });

  it('auto-registers webhook and returns link code when enabling integration', async () => {
    const result = await service.upsertForAgent(USER_ID, AGENT_ID, {
      enabled: true,
      botToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
    });

    const integration = await integrationStore.findByAgent(AGENT_ID);
    expect(integration).not.toBeNull();
    expect(mockTelegramApiService.setWebhook).toHaveBeenCalledWith(
      '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
      `https://api.example.com/api/v1/integrations/telegram/webhook/${integration!.id}`,
      integration!.webhookSecret,
    );
    // Fresh integrations get a generated secret; assert a sane length.
    expect(integration!.webhookSecret.length).toBeGreaterThanOrEqual(32);
    expect(mockLinkCodeService.generateForIntegration).toHaveBeenCalledWith(integration);
    expect(result.webhookRegistered).toBe(true);
    expect(result.messageKey).toBe('webhook_success');
    expect(result.linkCode).toBe('AB12CD34');
    expect(result.botUsername).toBe('my_agent_bot');
    expect(integration!.status).toBe(TelegramIntegrationStatus.ACTIVE);
  });

  it('returns webhook_failed when auto-registration fails but keeps saved token', async () => {
    integrationStore.seed({ agentId: AGENT_ID, encryptedBotToken: 'encrypted:123456789:token' });
    mockTelegramApiService.setWebhook.mockRejectedValueOnce(
      new BadRequestException(ErrorCode.TELEGRAM_SEND_FAILED, 'HTTPS required'),
    );

    const result = await service.upsertForAgent(USER_ID, AGENT_ID, { enabled: true });

    expect(result.webhookRegistered).toBe(false);
    expect(result.messageKey).toBe('webhook_failed');
    expect(result.errorMessage).toContain('HTTPS required');
    expect(mockLinkCodeService.generateForIntegration).not.toHaveBeenCalled();
    const integration = await integrationStore.findByAgent(AGENT_ID);
    expect(integration!.status).toBe(TelegramIntegrationStatus.ERROR);
    expect(integration!.encryptedBotToken).toBe('encrypted:123456789:token');
  });

  it('clears webhook and returns disabled message when integration is turned off', async () => {
    integrationStore.seed({
      agentId: AGENT_ID,
      encryptedBotToken: 'encrypted:123456789:token',
      enabled: true,
      status: TelegramIntegrationStatus.ACTIVE,
    });

    const result = await service.upsertForAgent(USER_ID, AGENT_ID, { enabled: false });

    expect(mockTelegramApiService.deleteWebhook).toHaveBeenCalledWith('123456789:token');
    expect(mockTelegramApiService.setWebhook).not.toHaveBeenCalled();
    expect(result.messageKey).toBe('disabled');
  });

  it('deletes the integration row after clearing the webhook (deleteForAgent)', async () => {
    const integration = integrationStore.seed({ agentId: AGENT_ID });

    await service.deleteForAgent(USER_ID, AGENT_ID);

    expect(mockTelegramApiService.deleteWebhook).toHaveBeenCalledWith('bot-token');
    expect(await integrationStore.findById(integration.id)).toBeNull();
  });

  it('skips duplicate webhook updates via markWebhookUpdate', async () => {
    const integration = integrationStore.seed({});

    expect(await service.markWebhookUpdate(integration.id, 10)).toBe('processed');
    expect(await service.markWebhookUpdate(integration.id, 10)).toBe('duplicate');
    expect(await service.markWebhookUpdate(integration.id, 11)).toBe('processed');
  });

  it('re-registers webhooks for enabled integrations on boot in webhook mode', async () => {
    const first = integrationStore.seed({ agentId: AGENT_ID });
    const second = integrationStore.seed({ agentId: '507f1f77bcf86cd799439012' });

    await service.syncWebhooksOnBoot();

    expect(mockTelegramApiService.setWebhook).toHaveBeenCalledTimes(2);
    expect(mockTelegramApiService.setWebhook).toHaveBeenCalledWith(
      'bot-token',
      `https://api.example.com/api/v1/integrations/telegram/webhook/${first.id}`,
      first.webhookSecret,
    );
  });

  it('skips webhook boot sync when polling mode is enabled', async () => {
    integrationStore.seed({ agentId: AGENT_ID });
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'telegram.pollingEnabled') return true;
      if (key === 'app.backendUrl') return 'https://api.example.com';
      return defaultValue;
    });

    await service.syncWebhooksOnBoot();

    expect(mockTelegramApiService.setWebhook).not.toHaveBeenCalled();
  });

  it('skips webhook boot sync when BACKEND_URL points to loopback', async () => {
    integrationStore.seed({ agentId: AGENT_ID });
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'app.backendUrl') return 'http://localhost:3000';
      return defaultValue;
    });

    await service.syncWebhooksOnBoot();

    expect(mockTelegramApiService.setWebhook).not.toHaveBeenCalled();
  });
});
