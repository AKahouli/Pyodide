import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@modules/logger';
import {
  TELEGRAM_BINDING_STORE,
  TELEGRAM_INTEGRATION_STORE,
  TELEGRAM_VALIDATION_STORE,
  type TelegramIntegrationRow,
} from '../persistence/telegram.store';
import {
  InMemoryTelegramBindingStore,
  InMemoryTelegramIntegrationStore,
  InMemoryTelegramValidationStore,
} from '../persistence/telegram.store.fake';
import { TelegramValidationService } from './telegram-validation.service';
import { TelegramIntegrationService } from './telegram-integration.service';
import { TelegramApiService } from './telegram-api.service';

const INTEGRATION: TelegramIntegrationRow = {
  id: 'integration-1',
  userId: 'user-1',
  agentId: 'agent-1',
  encryptedBotToken: 'encrypted:bot-token',
  botUsername: 'my_agent_bot',
  webhookSecret: 'webhook-secret',
  enabled: true,
  status: 'active',
  errorMessage: null,
  lastWebhookAt: null,
  lastUpdateId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TelegramValidationService', () => {
  let service: TelegramValidationService;
  let integrationStore: InMemoryTelegramIntegrationStore;
  let bindingStore: InMemoryTelegramBindingStore;
  let validationStore: InMemoryTelegramValidationStore;

  const integrationService = {
    getByIntegrationId: jest.fn().mockResolvedValue(INTEGRATION),
    getDecryptedToken: jest.fn().mockReturnValue('bot-token'),
  };

  const telegramApiService = {
    sendMessage: jest.fn().mockResolvedValue({ ok: true, result: { message_id: 99 } }),
    sendMessageWithButtons: jest.fn().mockResolvedValue({ ok: true, result: { message_id: 99 } }),
    answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    integrationStore = new InMemoryTelegramIntegrationStore();
    integrationStore.seed({ ...INTEGRATION });
    bindingStore = new InMemoryTelegramBindingStore();
    validationStore = new InMemoryTelegramValidationStore();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramValidationService,
        { provide: TELEGRAM_INTEGRATION_STORE, useValue: integrationStore },
        { provide: TELEGRAM_BINDING_STORE, useValue: bindingStore },
        { provide: TELEGRAM_VALIDATION_STORE, useValue: validationStore },
        { provide: ConfigService, useValue: { get: jest.fn((_k: string, d: unknown) => d) } },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        { provide: TelegramIntegrationService, useValue: integrationService },
        { provide: TelegramApiService, useValue: telegramApiService },
      ],
    }).compile();

    service = module.get<TelegramValidationService>(TelegramValidationService);
  });

  it('sends the question to the owner chat and records a pending validation', async () => {
    bindingStore.seed({ integrationId: 'integration-1', userId: 'user-1', telegramChatId: 'owner-chat', bindingType: 'member' });
    bindingStore.seed({ integrationId: 'integration-1', userId: 'user-1', telegramChatId: 'guest-chat', conversationId: 'conv-1', bindingType: 'guest' });

    const result = await service.create({
      integration_id: 'integration-1',
      conversation_id: 'conv-1',
      question: 'Dispo demain 18h ?',
    });

    expect(telegramApiService.sendMessage).toHaveBeenCalledWith(
      'bot-token',
      'owner-chat',
      expect.stringContaining('Validation requested'),
    );
    expect(result.status).toBe('pending');
    const row = await validationStore.findById(result.validationId);
    expect(row).toEqual(expect.objectContaining({ conversationId: 'conv-1', guestTelegramChatId: 'guest-chat', ownerMessageId: 99 }));
  });

  it('refuses to create a validation when the owner chat is not linked', async () => {
    await expect(
      service.create({ integration_id: 'integration-1', conversation_id: 'conv-1', question: 'q' }),
    ).rejects.toThrow();
  });

  it('records an inline-button answer from the owner', async () => {
    bindingStore.seed({ integrationId: 'integration-1', userId: 'user-1', telegramChatId: 'owner-chat', telegramUserId: '7', bindingType: 'member' });
    const created = await validationStore.insert({
      integrationId: 'integration-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      guestTelegramChatId: 'guest-chat',
      guestLabel: null,
      question: 'q',
      choices: ['oui', 'non'],
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.resolveCallback('cb-1', 'integration-1', '7', `hv:${created.id}:1`);

    expect(result).toEqual(expect.objectContaining({ answer: 'non', guestChatId: 'guest-chat' }));
    expect((await validationStore.findById(created.id))!.status).toBe('answered');
    expect(telegramApiService.answerCallbackQuery).toHaveBeenCalledWith('bot-token', 'cb-1', 'Answered: non');
  });

  it('rejects a callback from a non-owner telegram user', async () => {
    bindingStore.seed({ integrationId: 'integration-1', userId: 'user-1', telegramChatId: 'owner-chat', telegramUserId: '7', bindingType: 'member' });
    const created = await validationStore.insert({
      integrationId: 'integration-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      guestTelegramChatId: 'guest-chat',
      guestLabel: null,
      question: 'q',
      choices: [],
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.resolveCallback('cb-1', 'integration-1', '999', `hv:${created.id}:refuse`);

    expect(result).toBeNull();
    expect((await validationStore.findById(created.id))!.status).toBe('pending');
    expect(telegramApiService.answerCallbackQuery).toHaveBeenCalledWith('bot-token', 'cb-1', 'Only the bot owner can answer this request', true);
  });

  it('reports a pending validation for a conversation', async () => {
    await validationStore.insert({
      integrationId: 'integration-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      guestTelegramChatId: 'guest-chat',
      guestLabel: null,
      question: 'q',
      choices: [],
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.hasPending('integration-1', 'conv-1')).resolves.toBe(true);
    await expect(service.hasPending('integration-1', 'other')).resolves.toBe(false);
  });
});
