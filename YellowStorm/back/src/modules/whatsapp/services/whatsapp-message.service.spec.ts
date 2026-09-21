import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { USER_LOOKUP_PORT } from '@common/ports/user-lookup.port';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { User } from '@modules/user/schemas/user.schema';
import { UserStatus } from '@modules/user/schemas/user.schema';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { ConversationSettingsService } from '@modules/system/conversation-settings.service';
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

  const mockUserLookup = {
    byId: jest.fn(),
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
  const mockConversationSettings = { shouldRedactSensitiveText: jest.fn(() => true) };

  const sendReply = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppMessageService,
        { provide: getModelToken(WhatsAppChatBinding.name), useValue: mockBindingModel },
        { provide: USER_LOOKUP_PORT, useValue: mockUserLookup },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: AgentService, useValue: mockAgentService },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: MessageService, useValue: mockMessageService },
        { provide: WhatsAppStreamService, useValue: mockStreamService },
        { provide: WhatsAppIntegrationService, useValue: mockAgentIntegrationService },
        { provide: WorkyWhatsAppIntegrationService, useValue: mockWorkyIntegrationService },
        { provide: ConversationSettingsService, useValue: mockConversationSettings },
      ],
    }).compile();

    service = module.get(WhatsAppMessageService);
  });

  const flushAsyncRouting = () => new Promise((resolve) => setImmediate(resolve));

  const mockActiveUser = () => {
    mockUserLookup.byId.mockResolvedValue({ id: 'u1', email: 'user@example.com', firstName: '', lastName: '', status: UserStatus.ACTIVE });
  };

  it('drops messages when owner user is inactive', async () => {
    const integrationRef = buildAgentIntegration();
    mockUserLookup.byId.mockResolvedValue({ id: 'u1', email: 'inactive@example.com', firstName: '', lastName: '', status: UserStatus.INACTIVE });

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

  it('routes owner self-chat messages to the agent and replies into the self-chat', async () => {
    const integrationRef = buildAgentIntegration();
    const binding = buildBinding();
    const conversationId = binding.conversationId!.toString();
    const integrationDoc = {
      _id: integrationRef.integrationId,
      userId: integrationRef.userId,
      agentId: integrationRef.agentId,
    };
    const SELF = '21654747178@s.whatsapp.net';

    mockActiveUser();
    mockAgentIntegrationService.getDocumentById.mockResolvedValue(integrationDoc);
    mockBindingModel.findOneAndUpdate.mockReturnValue({ exec: async () => binding });
    mockConversationService.findById.mockResolvedValue({ id: conversationId });
    mockMessageService.createUserMessage.mockResolvedValue({ id: 'user-msg-1' });
    mockMessageService.createAIPlaceholder.mockResolvedValue({ id: 'ai-msg-1' });
    mockStreamService.runStream.mockResolvedValue(undefined);
    mockMessageService.findById.mockResolvedValue({
      components: [{ type: 'text', data: { content: 'Agent self-chat reply' } }],
    });
    mockBindingModel.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });

    await service.handleIncomingMessages(
      integrationRef,
      [{ key: { remoteJid: SELF, fromMe: true }, message: { conversation: 'salut toi-même' } }] as never[],
      sendReply,
      [SELF],
    );
    await flushAsyncRouting();

    expect(mockStreamService.runStream).toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith(SELF, 'Agent self-chat reply');
  });

  it('routes self-chat messages when selfJids carry the device suffix but the message arrives on the bare LID', async () => {
    const integrationRef = buildAgentIntegration();
    const binding = buildBinding();
    const conversationId = binding.conversationId!.toString();
    const integrationDoc = {
      _id: integrationRef.integrationId,
      userId: integrationRef.userId,
      agentId: integrationRef.agentId,
    };
    const BARE_LID = '81673265873042@lid';

    mockActiveUser();
    mockAgentIntegrationService.getDocumentById.mockResolvedValue(integrationDoc);
    mockBindingModel.findOneAndUpdate.mockReturnValue({ exec: async () => binding });
    mockConversationService.findById.mockResolvedValue({ id: conversationId });
    mockMessageService.createUserMessage.mockResolvedValue({ id: 'user-msg-1' });
    mockMessageService.createAIPlaceholder.mockResolvedValue({ id: 'ai-msg-1' });
    mockStreamService.runStream.mockResolvedValue(undefined);
    mockMessageService.findById.mockResolvedValue({
      components: [{ type: 'text', data: { content: 'Agent self-chat reply' } }],
    });
    mockBindingModel.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });

    await service.handleIncomingMessages(
      integrationRef,
      [{ key: { remoteJid: BARE_LID, fromMe: true }, message: { conversation: 'salut' } }] as never[],
      sendReply,
      ['81673265873042:74@lid', '21654747178:74@s.whatsapp.net'],
    );
    await flushAsyncRouting();

    expect(mockStreamService.runStream).toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith(BARE_LID, 'Agent self-chat reply');
  });

  it('still ignores fromMe messages the owner sends to other contacts', async () => {
    const integrationRef = buildAgentIntegration();

    mockActiveUser();

    await service.handleIncomingMessages(
      integrationRef,
      [
        {
          key: { remoteJid: '21694968472@s.whatsapp.net', fromMe: true },
          message: { conversation: 'salut X' },
        },
      ] as never[],
      sendReply,
      ['21654747178@s.whatsapp.net'],
    );
    await flushAsyncRouting();

    expect(mockStreamService.runStream).not.toHaveBeenCalled();
    expect(sendReply).not.toHaveBeenCalled();
  });

  describe('captureSelfChatText', () => {
    const SELF_PN_JID = '21654747178@s.whatsapp.net';

    const mockUpdateOne = () => {
      mockBindingModel.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });
    };

    const selfMessage = (remoteJid: string, text: string, fromMe = true) =>
      ({ key: { remoteJid, fromMe }, message: { conversation: text } }) as never;

    it('captures owner-typed self-chat text into the PN-normalized binding', async () => {
      mockUpdateOne();
      const integrationRef = buildAgentIntegration({ phoneNumber: '+21654747178' });

      await service.captureSelfChatText(integrationRef, [selfMessage(SELF_PN_JID, 'Valide cela')], [
        SELF_PN_JID,
        '65730196316337@lid',
      ]);

      expect(mockBindingModel.updateOne).toHaveBeenCalledWith(
        { integrationId: integrationRef.integrationId, remoteJid: SELF_PN_JID },
        expect.objectContaining({
          $set: expect.objectContaining({ lastInboundText: 'Valide cela' }),
        }),
        { upsert: true },
      );
    });

    it('captures self-chat text arriving under the LID form of the own JID', async () => {
      mockUpdateOne();
      const integrationRef = buildAgentIntegration({ phoneNumber: '+21654747178' });
      const ownLid = '65730196316337@lid';

      await service.captureSelfChatText(integrationRef, [selfMessage(ownLid, 'OK demain')], [
        SELF_PN_JID,
        ownLid,
      ]);

      expect(mockBindingModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ remoteJid: SELF_PN_JID }),
        expect.objectContaining({
          $set: expect.objectContaining({ lastInboundText: 'OK demain' }),
        }),
        { upsert: true },
      );
    });

    it('ignores messages the owner sends to other contacts', async () => {
      const integrationRef = buildAgentIntegration({ phoneNumber: '+21654747178' });

      await service.captureSelfChatText(
        integrationRef,
        [selfMessage('21694968472@s.whatsapp.net', 'Salut X')],
        [SELF_PN_JID],
      );

      expect(mockBindingModel.updateOne).not.toHaveBeenCalled();
    });

    it('ignores self-chat messages without extractable text', async () => {
      const integrationRef = buildAgentIntegration({ phoneNumber: '+21654747178' });

      await service.captureSelfChatText(
        integrationRef,
        [{ key: { remoteJid: SELF_PN_JID, fromMe: true } } as never],
        [SELF_PN_JID],
      );

      expect(mockBindingModel.updateOne).not.toHaveBeenCalled();
    });

    it('ignores inbound (not fromMe) self messages', async () => {
      const integrationRef = buildAgentIntegration({ phoneNumber: '+21654747178' });

      await service.captureSelfChatText(integrationRef, [selfMessage(SELF_PN_JID, 'hi', false)], [
        SELF_PN_JID,
      ]);

      expect(mockBindingModel.updateOne).not.toHaveBeenCalled();
    });

    it('does nothing when the integration is not connected', async () => {
      const integrationRef = buildAgentIntegration({
        phoneNumber: '+21654747178',
        status: WhatsAppIntegrationStatus.PAIRING,
      });

      await service.captureSelfChatText(integrationRef, [selfMessage(SELF_PN_JID, 'hi')], [
        SELF_PN_JID,
      ]);

      expect(mockBindingModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
