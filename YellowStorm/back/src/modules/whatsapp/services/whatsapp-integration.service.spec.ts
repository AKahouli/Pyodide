import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AgentService } from '@modules/agent/agent.service';
import { LoggerService } from '@modules/logger';
import { ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
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
          enabled: false,
          sessionId: 'sess-1',
          phoneNumber: '+123',
          displayName: 'Test',
          updatedAt,
        }),
      }),
    });

    const result = await service.getByAgentForUser(userId, agentId);

    expect(result).toEqual({
      enabled: false,
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

  it('throws ForbiddenException when agent ownership check fails', async () => {
    agentService.findUserAgentById.mockRejectedValue(new Error('not found'));

    await expect(service.getByAgentForUser(userId, agentId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns integration document for owned agent', async () => {
    const doc = { _id: new Types.ObjectId(), sessionId: 'sess-1' };
    integrationModel.findOne.mockReturnValue({ exec: async () => doc });

    const result = await service.getDocumentByAgentForUser(userId, agentId);

    expect(result).toBe(doc);
  });

  it('throws NotFoundException when integration document is missing', async () => {
    integrationModel.findOne.mockReturnValue({ exec: async () => null });

    await expect(service.getDocumentByAgentForUser(userId, agentId)).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
    });
  });

  it('throws NotFoundException when session id does not match', async () => {
    const doc = { _id: new Types.ObjectId(), sessionId: 'other-session' };
    integrationModel.findOne.mockReturnValue({ exec: async () => doc });

    await expect(
      service.getDocumentBySessionForUser(userId, agentId, 'sess-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_SESSION_NOT_FOUND,
    });
  });

  it('returns integration when session id matches', async () => {
    const doc = { _id: new Types.ObjectId(), sessionId: 'sess-1' };
    integrationModel.findOne.mockReturnValue({ exec: async () => doc });

    const result = await service.getDocumentBySessionForUser(userId, agentId, 'sess-1');

    expect(result).toBe(doc);
  });

  it('returns integration by id', async () => {
    const integrationId = new Types.ObjectId();
    const doc = { _id: integrationId };
    integrationModel.findById.mockReturnValue({ exec: async () => doc });

    const result = await service.getDocumentById(integrationId);

    expect(result).toBe(doc);
  });

  it('throws NotFoundException when integration id is unknown', async () => {
    integrationModel.findById.mockReturnValue({ exec: async () => null });

    await expect(service.getDocumentById(new Types.ObjectId())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates integration status patch', async () => {
    const integrationId = new Types.ObjectId();
    integrationModel.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });

    await service.updateStatus(integrationId, {
      status: WhatsAppIntegrationStatus.CONNECTED,
      phoneNumber: '+123',
    });

    expect(integrationModel.updateOne).toHaveBeenCalledWith(
      { _id: integrationId },
      {
        $set: {
          status: WhatsAppIntegrationStatus.CONNECTED,
          phoneNumber: '+123',
        },
      },
    );
  });

  it('deletes bindings and integration for agent', async () => {
    const integrationId = new Types.ObjectId();
    const doc = { _id: integrationId, sessionId: 'sess-1' };
    integrationModel.findOne.mockReturnValue({ exec: async () => doc });
    bindingModel.deleteMany.mockReturnValue({ exec: async () => ({ deletedCount: 1 }) });
    integrationModel.deleteOne.mockReturnValue({ exec: async () => ({ deletedCount: 1 }) });

    await service.deleteIntegrationForAgent(userId, agentId);

    expect(bindingModel.deleteMany).toHaveBeenCalledWith({ integrationId });
    expect(integrationModel.deleteOne).toHaveBeenCalledWith({ _id: integrationId });
  });

  it('finds connected enabled integrations', async () => {
    const docs = [{ status: WhatsAppIntegrationStatus.CONNECTED, enabled: true }];
    integrationModel.find.mockReturnValue({ exec: async () => docs });

    const result = await service.findConnectedIntegrations();

    expect(result).toBe(docs);
    expect(integrationModel.find).toHaveBeenCalledWith({
      status: WhatsAppIntegrationStatus.CONNECTED,
      enabled: true,
    });
  });

  it('updates enabled flag for an owned integration', async () => {
    const doc = {
      enabled: false,
      status: WhatsAppIntegrationStatus.CONNECTED,
      sessionId: 'sess-1',
    };
    integrationModel.findOneAndUpdate.mockReturnValue({ exec: async () => doc });

    const result = await service.updateEnabled(userId, agentId, false);

    expect(integrationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { agentId: new Types.ObjectId(agentId) },
      { $set: { enabled: false } },
      { new: true },
    );
    expect(result).toEqual({
      enabled: false,
      status: WhatsAppIntegrationStatus.CONNECTED,
      sessionId: 'sess-1',
      phoneNumber: undefined,
      displayName: undefined,
      errorMessage: undefined,
      lastActivityAt: undefined,
      updatedAt: undefined,
    });
  });

  it('throws NotFoundException when updating enabled without integration', async () => {
    integrationModel.findOneAndUpdate.mockReturnValue({ exec: async () => null });

    await expect(service.updateEnabled(userId, agentId, false)).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
    });
  });

  it('maps optional date fields in toResponse', () => {
    const lastActivityAt = new Date('2026-06-04T11:00:00.000Z');
    const updatedAt = new Date('2026-06-04T12:00:00.000Z');

    const result = service.toResponse({
      status: WhatsAppIntegrationStatus.FAILED,
      errorMessage: 'pairing failed',
      lastActivityAt,
      updatedAt,
    });

    expect(result).toEqual({
      enabled: true,
      status: WhatsAppIntegrationStatus.FAILED,
      sessionId: undefined,
      phoneNumber: undefined,
      displayName: undefined,
      errorMessage: 'pairing failed',
      lastActivityAt: lastActivityAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
  });
});
