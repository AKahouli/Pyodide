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
import { WhatsAppChatBinding } from '../schemas/whatsapp-chat-binding.schema';
import {
  WhatsAppIntegrationStatus,
} from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppMessageService } from './whatsapp-message.service';
import { WhatsAppStreamService } from './whatsapp-stream.service';

function buildIntegration(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    agentId: new Types.ObjectId(),
    enabled: true,
    status: WhatsAppIntegrationStatus.CONNECTED,
    ...overrides,
  };
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

  const mockAgentService = {
    findUserAgentById: jest.fn(),
  };

  const mockConversationService = {
    findById: jest.fn(),
    create: jest.fn(),
  };

  const mockMessageService = {
    createUserMessage: jest.fn(),
    createAIPlaceholder: jest.fn(),
    findById: jest.fn(),
  };

  const mockStreamService = {
    runStream: jest.fn(),
  };

  const mockIntegrationService = {
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
        { provide: WhatsAppIntegrationService, useValue: mockIntegrationService },
      ],
    }).compile();

    service = module.get(WhatsAppMessageService);
  });

  const flushAsyncRouting = () => new Promise((resolve) => setImmediate(resolve));

  it('ignores messages when integration is missing or not connected', async () => {
    mockIntegrationService.getDocumentById.mockRejectedValue(new Error('missing'));

    await service.handleIncomingMessages(new Types.ObjectId(), [], sendReply);

    expect(sendReply).not.toHaveBeenCalled();
  });

  it('drops messages when owner user is inactive', async () => {
    const integration = buildIntegration();
    mockIntegrationService.getDocumentById.mockResolvedValue(integration);
    mockUserModel.findById.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: async () => ({ status: UserStatus.INACTIVE, email: 'inactive@example.com' }),
        }),
      }),
    });

    await service.handleIncomingMessages(integration._id, [], sendReply);

    expect(mockLoggerService.warn).toHaveBeenCalledWith(
      'WhatsApp message dropped: owner inactive',
      expect.objectContaining({ integrationId: integration._id.toString() }),
    );
  });

  it('skips self, group, broadcast, and empty messages', async () => {
    const integration = buildIntegration();
    mockIntegrationService.getDocumentById.mockResolvedValue(integration);
    mockUserModel.findById.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: async () => ({ status: UserStatus.ACTIVE, email: 'user@example.com' }),
        }),
      }),
    });

    await service.handleIncomingMessages(
      integration._id,
      [
        { key: { fromMe: true, remoteJid: '123@s.whatsapp.net' }, message: { conversation: 'hi' } },
        { key: { remoteJid: 'group@g.us' }, message: { conversation: 'hi' } },
        { key: { remoteJid: 'status@broadcast' }, message: { conversation: 'hi' } },
        { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '   ' } },
      ] as never[],
      sendReply,
    );
    await flushAsyncRouting();

    expect(sendReply).not.toHaveBeenCalled();
  });

  it('routes valid direct messages and sends extracted reply', async () => {
    const integration = buildIntegration();
    const binding = buildBinding();
    const conversationId = binding.conversationId!.toString();

    mockIntegrationService.getDocumentById.mockResolvedValue(integration);
    mockUserModel.findById.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: async () => ({ status: UserStatus.ACTIVE, email: 'user@example.com' }),
        }),
      }),
    });
    mockBindingModel.findOneAndUpdate.mockReturnValue({ exec: async () => binding });
    mockConversationService.findById.mockResolvedValue({ id: conversationId });
    mockMessageService.createUserMessage.mockResolvedValue({ id: 'user-msg-1' });
    mockMessageService.createAIPlaceholder.mockResolvedValue({ id: 'ai-msg-1' });
    mockStreamService.runStream.mockResolvedValue(undefined);
    mockMessageService.findById.mockResolvedValue({
      components: [{ type: 'text', data: { content: 'Agent reply' } }],
    });
    mockBindingModel.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });
    mockIntegrationService.updateStatus.mockResolvedValue(undefined);

    await service.handleIncomingMessages(
      integration._id,
      [
        {
          key: { remoteJid: '123@s.whatsapp.net' },
          message: { extendedTextMessage: { text: '  Hello there  ' } },
        },
      ] as never[],
      sendReply,
    );
    await flushAsyncRouting();

    expect(mockStreamService.runStream).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        messageId: 'ai-msg-1',
        query: 'Hello there',
      }),
    );
    expect(sendReply).toHaveBeenCalledWith('123@s.whatsapp.net', 'Agent reply');
    expect(mockIntegrationService.updateStatus).toHaveBeenCalled();
  });

  it('sends fallback reply when stream produces no text', async () => {
    const integration = buildIntegration();
    const binding = buildBinding();
    const conversationId = binding.conversationId!.toString();

    mockIntegrationService.getDocumentById.mockResolvedValue(integration);
    mockUserModel.findById.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: async () => ({ status: UserStatus.ACTIVE, email: 'user@example.com' }),
        }),
      }),
    });
    mockBindingModel.findOneAndUpdate.mockReturnValue({ exec: async () => binding });
    mockConversationService.findById.mockResolvedValue({ id: conversationId });
    mockMessageService.createUserMessage.mockResolvedValue({ id: 'user-msg-1' });
    mockMessageService.createAIPlaceholder.mockResolvedValue({ id: 'ai-msg-1' });
    mockStreamService.runStream.mockResolvedValue(undefined);
    mockMessageService.findById.mockResolvedValue({ components: [] });
    mockBindingModel.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });
    mockIntegrationService.updateStatus.mockResolvedValue(undefined);

    await service.handleIncomingMessages(
      integration._id,
      [{ key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: 'Help' } }] as never[],
      sendReply,
    );
    await flushAsyncRouting();

    expect(sendReply).toHaveBeenCalledWith('123@s.whatsapp.net', 'Fallback reply');
    expect(mockLoggerService.warn).toHaveBeenCalledWith(
      'WhatsApp reply empty after gRPC stream',
      expect.objectContaining({ messageId: 'ai-msg-1' }),
    );
  });

  it('truncates long replies to the configured max length', async () => {
    const integration = buildIntegration();
    const binding = buildBinding();
    const conversationId = binding.conversationId!.toString();
    const longReply = 'x'.repeat(4005);

    mockIntegrationService.getDocumentById.mockResolvedValue(integration);
    mockUserModel.findById.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: async () => ({ status: UserStatus.ACTIVE, email: 'user@example.com' }),
        }),
      }),
    });
    mockBindingModel.findOneAndUpdate.mockReturnValue({ exec: async () => binding });
    mockConversationService.findById.mockResolvedValue({ id: conversationId });
    mockMessageService.createUserMessage.mockResolvedValue({ id: 'user-msg-1' });
    mockMessageService.createAIPlaceholder.mockResolvedValue({ id: 'ai-msg-1' });
    mockStreamService.runStream.mockResolvedValue(undefined);
    mockMessageService.findById.mockResolvedValue({
      components: [{ type: 'text', data: { content: longReply } }],
    });
    mockBindingModel.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });
    mockIntegrationService.updateStatus.mockResolvedValue(undefined);

    await service.handleIncomingMessages(
      integration._id,
      [{ key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: 'Long' } }] as never[],
      sendReply,
    );
    await flushAsyncRouting();

    expect(sendReply).toHaveBeenCalledWith('123@s.whatsapp.net', `${'x'.repeat(3997)}...`);
  });
});
