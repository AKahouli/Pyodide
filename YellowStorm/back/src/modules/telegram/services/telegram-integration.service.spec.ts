import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { CryptoService } from '@common/services/crypto.service';
import { AgentService } from '@modules/agent/agent.service';
import { LoggerService } from '@modules/logger';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { TelegramIntegrationService } from './telegram-integration.service';
import { TelegramApiService } from './telegram-api.service';
import { TelegramLinkCodeService } from './telegram-link-code.service';
import { AgentTelegramIntegration } from '../schemas/agent-telegram-integration.schema';
import { TelegramChatBinding } from '../schemas/telegram-chat-binding.schema';
import { TelegramLinkCode } from '../schemas/telegram-link-code.schema';
import { TelegramIntegrationStatus } from '../schemas/agent-telegram-integration.schema';

function buildIntegrationDoc(overrides: Record<string, unknown> = {}) {
  const integrationId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const agentId = new Types.ObjectId();

  const doc = {
    _id: integrationId,
    userId,
    agentId,
    enabled: true,
    encryptedBotToken: 'encrypted:123456789:token',
    botUsername: 'my_agent_bot',
    webhookSecret: 'webhook-secret',
    status: TelegramIntegrationStatus.PENDING,
    errorMessage: undefined as string | undefined,
    save: jest.fn(),
    toObject: jest.fn(),
    ...overrides,
  };

  doc.save.mockImplementation(async () => doc);
  doc.toObject.mockImplementation(() => ({
    enabled: doc.enabled,
    encryptedBotToken: doc.encryptedBotToken,
    botUsername: doc.botUsername,
    status: doc.status,
    errorMessage: doc.errorMessage,
    updatedAt: new Date('2026-05-26T10:00:00.000Z'),
  }));

  return doc;
}

describe('TelegramIntegrationService', () => {
  let service: TelegramIntegrationService;

  const mockIntegrationModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  };

  const mockFindOneExec = (value: unknown) => {
    mockIntegrationModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(value),
    });
  };

  const mockBindingModel = {
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };

  const mockLinkCodeModel = {
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };

  const mockCryptoService = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn((value: string) => value.replace('encrypted:', '')),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'app.backendUrl') return 'https://api.example.com';
      return defaultValue;
    }),
  };

  const mockAgentService = {
    findUserAgentById: jest.fn().mockResolvedValue({ id: 'agent-id' }),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramIntegrationService,
        { provide: getModelToken(AgentTelegramIntegration.name), useValue: mockIntegrationModel },
        { provide: getModelToken(TelegramChatBinding.name), useValue: mockBindingModel },
        { provide: getModelToken(TelegramLinkCode.name), useValue: mockLinkCodeModel },
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

  it('auto-registers webhook and returns link code when enabling integration', async () => {
    const doc = buildIntegrationDoc();
    mockFindOneExec(doc);

    const result = await service.upsertForAgent(
      doc.userId.toString(),
      doc.agentId.toString(),
      { enabled: true, botToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' },
    );

    expect(mockTelegramApiService.setWebhook).toHaveBeenCalledWith(
      '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
      `https://api.example.com/api/v1/integrations/telegram/webhook/${doc._id.toString()}`,
      'webhook-secret',
    );
    expect(mockLinkCodeService.generateForIntegration).toHaveBeenCalledWith(doc);
    expect(result.webhookRegistered).toBe(true);
    expect(result.messageKey).toBe('webhook_success');
    expect(result.linkCode).toBe('AB12CD34');
    expect(result.botUsername).toBe('my_agent_bot');
  });

  it('returns webhook_failed when auto-registration fails but keeps saved token', async () => {
    const doc = buildIntegrationDoc();
    mockFindOneExec(doc);
    mockTelegramApiService.setWebhook.mockRejectedValueOnce(
      new BadRequestException(ErrorCode.TELEGRAM_SEND_FAILED, 'HTTPS required'),
    );

    const result = await service.upsertForAgent(
      doc.userId.toString(),
      doc.agentId.toString(),
      { enabled: true },
    );

    expect(result.webhookRegistered).toBe(false);
    expect(result.messageKey).toBe('webhook_failed');
    expect(result.errorMessage).toContain('HTTPS required');
    expect(mockLinkCodeService.generateForIntegration).not.toHaveBeenCalled();
    expect(doc.status).toBe(TelegramIntegrationStatus.ERROR);
  });

  it('clears webhook and returns disabled message when integration is turned off', async () => {
    const doc = buildIntegrationDoc({ enabled: false, status: TelegramIntegrationStatus.ACTIVE });
    mockFindOneExec(doc);

    const result = await service.upsertForAgent(
      doc.userId.toString(),
      doc.agentId.toString(),
      { enabled: false },
    );

    expect(mockTelegramApiService.deleteWebhook).toHaveBeenCalledWith('123456789:token');
    expect(mockTelegramApiService.setWebhook).not.toHaveBeenCalled();
    expect(result.messageKey).toBe('disabled');
  });
});
