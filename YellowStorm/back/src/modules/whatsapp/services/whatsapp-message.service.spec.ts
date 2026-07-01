import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { User } from '@modules/user/schemas/user.schema';
import { UserStatus } from '@modules/user/schemas/user.schema';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { AgentService } from '@modules/agent/agent.service';
import { LoggerService } from '@modules/logger';
import { WorkyWhatsAppIntegrationService } from '@modules/worky/services/worky-whatsapp-integration.service';
import { WhatsAppChatBinding } from '../schemas/whatsapp-chat-binding.schema';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';
import { toAgentIntegrationRef } from '../interfaces/whatsapp-integration-ref.interface';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppMessageService } from './whatsapp-message.service';
import { WhatsAppStreamService } from './whatsapp-stream.service';

function buildAgentIntegration(overrides: Record<string, unknown> = {}) {
  return toAgentIntegrationRef({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    agentId: new Types.ObjectId(),
    enabled: true,
    status: WhatsAppIntegrationStatus.CONNECTED,
    ...overrides,
  } as never);
}

function buildBinding(overrides: Record<string, unknown> = {}) {
  const binding = {
    _id: new Types.ObjectId(),
    agentId: new Types.ObjectId(),
    conversationId: new Types.ObjectId(),
    save: jest.fn(),
    ...overrides,
  };
  binding.save.mockResolvedValue(binding);
  return binding;
}

describe('WhatsAppMessageService', () => {
  let service: WhatsAppMessageService;

  const mockBindingModel = {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };

  const mockUserModel = {
    findById: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.processingTimeoutMs') return 180000;
      if (key === 'whatsapp.fallbackReply') return 'Fallback reply';
      if (key === 'whatsapp.maxReplyLength') return 4000;
      return defaultValue;
    }),
  };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockAgentService = { findUserAgentById: jest.fn() };
  const mockConversationService = { findById: jest.fn(), create: jest.fn() };
  const mockMessageService = {
    createUserMessage: jest.fn(),
    createAIPlaceholder: jest.fn(),
    findById: jest.fn(),
  };
  const mockStreamService = { runStream: jest.fn() };
  const mockAgentIntegrationService = {
    getDocumentById: jest.fn(),
    updateStatus: jest.fn(),
  };
  const mockWorkyIntegrationService = {
    getDocumentById: jest.fn(),
    updateStatus: jest.fn(),
  };

  const sendReply = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppMessageService,
        { provide: getModelToken(WhatsAppChatBinding.name), useValue: mockBindingModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: AgentService, useValue: mockAgentService },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: MessageService, useValue: mockMessageService },
        { provide: WhatsAppStreamService, useValue: mockStreamService },
        { provide: WhatsAppIntegrationService, useValue: mockAgentIntegrationService },
        { provide: WorkyWhatsAppIntegrationService, useValue: mockWorkyIntegrationService },
      ],
    }).compile();

    service = module.get(WhatsAppMessageService);
  });

  const flushAsyncRouting = () => new Promise((resolve) => setImmediate(resolve));

  const mockActiveUser = () => {
    mockUserModel.findById.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: async () => ({ status: UserStatus.ACTIVE, email: 'user@example.com' }),
        }),
      }),
    });
  };

  it('drops messages when owner user is inactive', async () => {
    const integrationRef = buildAgentIntegration();
    mockUserModel.findById.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: async () => ({ status: UserStatus.INACTIVE, email: 'inactive@example.com' }),
        }),
      }),
    });

    await service.handleIncomingMessages(integrationRef, [], sendReply);

    expect(mockLoggerService.warn).toHaveBeenCalledWith(
      'WhatsApp message dropped: owner inactive',
      expect.objectContaining({ integrationId: integrationRef.integrationId.toString() }),
    );
  });

  it('routes valid agent messages and sends extracted reply', async () => {
    const integrationRef = buildAgentIntegration();
    const binding = buildBinding();
    const conversationId = binding.conversationId!.toString();
    const integrationDoc = {
      _id: integrationRef.integrationId,
      userId: integrationRef.userId,
      agentId: integrationRef.agentId,
    };

    mockActiveUser();
    mockAgentIntegrationService.getDocumentById.mockResolvedValue(integrationDoc);
    mockBindingModel.findOneAndUpdate.mockReturnValue({ exec: async () => binding });
    mockConversationService.findById.mockResolvedValue({ id: conversationId });
    mockMessageService.createUserMessage.mockResolvedValue({ id: 'user-msg-1' });
    mockMessageService.createAIPlaceholder.mockResolvedValue({ id: 'ai-msg-1' });
    mockStreamService.runStream.mockResolvedValue(undefined);
    mockMessageService.findById.mockResolvedValue({
      components: [{ type: 'text', data: { content: 'Agent reply' } }],
    });
    mockBindingModel.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });

    await service.handleIncomingMessages(
      integrationRef,
      [
        {
          key: { remoteJid: '123@s.whatsapp.net' },
          message: { extendedTextMessage: { text: '  Hello there  ' } },
        },
      ] as never[],
      sendReply,
    );
    await flushAsyncRouting();

    expect(mockStreamService.runStream).toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith('123@s.whatsapp.net', 'Agent reply');
  });
});
