import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { USER_LOOKUP_PORT } from '@common/ports/user-lookup.port';
import { LoggerService } from '@modules/logger';
import { AgentService } from '@modules/agent/agent.service';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { StreamService } from '@modules/conversation/services/stream.service';
import { ConversationSettingsService } from '@modules/system/conversation-settings.service';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramIntegrationService } from './telegram-integration.service';
import { TelegramApiService } from './telegram-api.service';
import { TelegramLinkCodeService } from './telegram-link-code.service';
import { TELEGRAM_BINDING_STORE } from '../persistence/telegram.store';
import { InMemoryTelegramBindingStore } from '../persistence/telegram.store.fake';
import type { TelegramIntegrationRow } from '../persistence/telegram.store';
import type { TelegramUpdate } from '../interfaces/telegram-update.interface';

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

/** Drains the fire-and-forget processUpdate() promise chain. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function textUpdate(updateId: number, text: string): TelegramUpdate {
  return {
    update_id: updateId,
    message: { chat: { id: 42 }, from: { id: 7 }, text },
  } as TelegramUpdate;
}

describe('TelegramWebhookService', () => {
  let service: TelegramWebhookService;
  let bindingStore: InMemoryTelegramBindingStore;

  const integrationService = {
    validateWebhookSecret: jest.fn().mockResolvedValue(INTEGRATION),
    markWebhookUpdate: jest.fn().mockResolvedValue('processed'),
    getByIntegrationId: jest.fn().mockResolvedValue(INTEGRATION),
    getDecryptedToken: jest.fn().mockReturnValue('bot-token'),
  };

  const telegramApiService = {
    sendMessage: jest.fn().mockResolvedValue({ ok: true }),
  };

  const linkCodeService = {
    consumeCodeOrThrow: jest.fn().mockResolvedValue({
      id: 'code-1',
      integrationId: 'integration-1',
      userId: 'user-1',
      agentId: 'agent-1',
      codeHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      consumed: true,
      consumedAt: new Date(),
    }),
  };

  const messageService = {
    createUserMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    createAIPlaceholder: jest.fn().mockResolvedValue({ id: 'msg-2', requestId: 'req-2' }),
    findById: jest.fn().mockResolvedValue({ components: [{ type: 'text', data: { content: 'agent reply' } }] }),
  };

  const streamService = {
    runSingleAgentStream: jest.fn().mockResolvedValue(undefined),
  };

  const conversationService = {
    findById: jest.fn().mockRejectedValue(new Error('missing')),
    create: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
  };

  const agentService = {
    findUserAgentById: jest.fn().mockResolvedValue({ id: 'agent-1', name: 'My Agent' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // clearAllMocks keeps implementations — re-arm the ones tests override.
    integrationService.markWebhookUpdate.mockResolvedValue('processed');
    integrationService.getByIntegrationId.mockResolvedValue(INTEGRATION);
    bindingStore = new InMemoryTelegramBindingStore();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramWebhookService,
        { provide: TELEGRAM_BINDING_STORE, useValue: bindingStore },
        { provide: USER_LOOKUP_PORT, useValue: { byId: jest.fn().mockResolvedValue({ status: 'active', email: 'user@test.dev' }) } },
        { provide: ConfigService, useValue: { get: jest.fn((_k: string, d: unknown) => d) } },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
        { provide: AgentService, useValue: agentService },
        { provide: ConversationService, useValue: conversationService },
        { provide: MessageService, useValue: messageService },
        { provide: StreamService, useValue: streamService },
        { provide: TelegramIntegrationService, useValue: integrationService },
        { provide: TelegramApiService, useValue: telegramApiService },
        { provide: TelegramLinkCodeService, useValue: linkCodeService },
        { provide: ConversationSettingsService, useValue: { shouldRedactSensitiveText: () => true } },
      ],
    }).compile();

    service = module.get<TelegramWebhookService>(TelegramWebhookService);
  });

  it('binds the chat via link code on /start and confirms', async () => {
    await service.validateAndDispatch('integration-1', 'webhook-secret', textUpdate(1, '/start CODE123'));
    await flushAsync();

    expect(linkCodeService.consumeCodeOrThrow).toHaveBeenCalledWith('CODE123', 'integration-1');
    const binding = await bindingStore.findByChat('integration-1', '42');
    expect(binding).toEqual(
      expect.objectContaining({
        integrationId: 'integration-1',
        userId: 'user-1',
        agentId: 'agent-1',
        telegramChatId: '42',
        telegramUserId: '7',
      }),
    );
    expect(binding!.lastMessageAt).toBeInstanceOf(Date);
    expect(telegramApiService.sendMessage).toHaveBeenCalledWith(
      'bot-token',
      '42',
      expect.stringContaining('successfully linked'),
    );
  });

  it('skips duplicate updates without processing them', async () => {
    integrationService.markWebhookUpdate.mockResolvedValue('duplicate');
    const findByChat = jest.spyOn(bindingStore, 'findByChat');

    await service.validateAndDispatch('integration-1', 'webhook-secret', textUpdate(5, 'hello'));
    await flushAsync();

    expect(findByChat).not.toHaveBeenCalled();
    expect(messageService.createUserMessage).not.toHaveBeenCalled();
    expect(telegramApiService.sendMessage).not.toHaveBeenCalled();
  });

  it('replies with the disabled message when the integration is off', async () => {
    await bindingStore.upsert({
      integrationId: 'integration-1',
      userId: 'user-1',
      agentId: 'agent-1',
      telegramChatId: '42',
      telegramUserId: '7',
      lastMessageAt: new Date(),
    });
    integrationService.getByIntegrationId.mockResolvedValue({ ...INTEGRATION, enabled: false });

    await service.validateAndDispatch('integration-1', 'webhook-secret', textUpdate(6, 'hello'));
    await flushAsync();

    expect(telegramApiService.sendMessage).toHaveBeenCalledWith(
      'bot-token',
      '42',
      'Telegram integration is disabled for this agent.',
    );
    expect(messageService.createUserMessage).not.toHaveBeenCalled();
  });

  it('tells unlinked chats how to link', async () => {
    await service.validateAndDispatch('integration-1', 'webhook-secret', textUpdate(7, 'hello'));
    await flushAsync();

    expect(telegramApiService.sendMessage).toHaveBeenCalledWith(
      'bot-token',
      '42',
      expect.stringContaining('not linked yet'),
    );
  });
});
