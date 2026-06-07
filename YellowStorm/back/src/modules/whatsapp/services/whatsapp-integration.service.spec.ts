import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AgentService } from '@modules/agent/agent.service';
import { LoggerService } from '@modules/logger';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { AgentWhatsAppIntegration } from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppChatBinding } from '../schemas/whatsapp-chat-binding.schema';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';

describe('WhatsAppIntegrationService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const agentId = '507f1f77bcf86cd799439012';
  let service: WhatsAppIntegrationService;

  const integrationModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    find: jest.fn(),
  };

  const bindingModel = {
    deleteMany: jest.fn(),
  };

  const agentService = {
    findUserAgentById: jest.fn(),
  };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppIntegrationService,
        { provide: getModelToken(AgentWhatsAppIntegration.name), useValue: integrationModel },
        { provide: getModelToken(WhatsAppChatBinding.name), useValue: bindingModel },
        { provide: AgentService, useValue: agentService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get(WhatsAppIntegrationService);
    jest.clearAllMocks();
    agentService.findUserAgentById.mockResolvedValue({ id: agentId, name: 'Agent' });
  });

  it('returns null when no integration exists', async () => {
    integrationModel.findOne.mockReturnValue({
      lean: () => ({ exec: async () => null }),
    });

    const result = await service.getByAgentForUser(userId, agentId);

    expect(result).toBeNull();
    expect(agentService.findUserAgentById).toHaveBeenCalledWith(userId, agentId);
  });

  it('maps integration document to response DTO', async () => {
    const updatedAt = new Date('2026-06-04T10:00:00.000Z');
    integrationModel.findOne.mockReturnValue({
      lean: () => ({
        exec: async () => ({
          status: WhatsAppIntegrationStatus.CONNECTED,
          sessionId: 'sess-1',
          phoneNumber: '+123',
          displayName: 'Test',
          updatedAt,
        }),
      }),
    });

    const result = await service.getByAgentForUser(userId, agentId);

    expect(result).toEqual({
      status: 'CONNECTED',
      sessionId: 'sess-1',
      phoneNumber: '+123',
      displayName: 'Test',
      errorMessage: undefined,
      lastActivityAt: undefined,
      updatedAt: updatedAt.toISOString(),
    });
  });

  it('upserts integration shell for pairing', async () => {
    const doc = {
      _id: new Types.ObjectId(),
      status: WhatsAppIntegrationStatus.PAIRING,
      sessionId: 'sess-2',
    };
    integrationModel.findOneAndUpdate.mockReturnValue({ exec: async () => doc });

    const result = await service.upsertIntegrationShell(userId, agentId, 'sess-2');

    expect(result).toBe(doc);
    expect(integrationModel.findOneAndUpdate).toHaveBeenCalled();
  });
});
