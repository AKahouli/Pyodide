import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { MongoBaileysAuthStore } from '../baileys/mongo-auth-state';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppSessionManager } from './whatsapp-session.manager';

describe('WhatsAppConnectionService', () => {
  let service: WhatsAppConnectionService;

  const userId = '507f1f77bcf86cd799439011';
  const agentId = '507f1f77bcf86cd799439012';
  const sessionId = 'sess-123';

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.enabled') return true;
      return defaultValue;
    }),
  };

  const mockConnectivity = {
    assertReachable: jest.fn().mockResolvedValue(undefined),
  };

  const mockIntegrationService = {
    getByAgentForUser: jest.fn(),
    upsertIntegrationShell: jest.fn(),
    getDocumentBySessionForUser: jest.fn(),
    getDocumentByAgentForUser: jest.fn(),
    updateStatus: jest.fn(),
    deleteIntegrationForAgent: jest.fn(),
    toResponse: jest.fn(),
  };

  const mockSessionManager = {
    startPairing: jest.fn().mockResolvedValue(undefined),
    getPairingSnapshot: jest.fn(),
    reconnect: jest.fn().mockResolvedValue(undefined),
    stopSession: jest.fn().mockResolvedValue(undefined),
  };

  const mockAuthStore = {
    deleteAuthState: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.enabled') return true;
      return defaultValue;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppConnectionService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WhatsAppConnectivityService, useValue: mockConnectivity },
        { provide: WhatsAppIntegrationService, useValue: mockIntegrationService },
        { provide: WhatsAppSessionManager, useValue: mockSessionManager },
        { provide: MongoBaileysAuthStore, useValue: mockAuthStore },
      ],
    }).compile();

    service = module.get(WhatsAppConnectionService);
  });

  it('throws when WhatsApp integration is disabled', () => {
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.enabled') return false;
      return defaultValue;
    });

    expect(() => service.assertEnabled()).toThrow(BadRequestException);
    expect(() => service.assertEnabled()).toThrow(
      expect.objectContaining({ code: ErrorCode.WHATSAPP_DISABLED }),
    );
  });

  it('throws when agent is already connected', async () => {
    mockIntegrationService.getByAgentForUser.mockResolvedValue({ status: 'CONNECTED' });

    await expect(service.connect(userId, agentId)).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_ALREADY_CONNECTED,
    });
  });

  it('starts pairing for a new connection', async () => {
    const integration = { _id: new Types.ObjectId() };
    mockIntegrationService.getByAgentForUser.mockResolvedValue(null);
    mockIntegrationService.upsertIntegrationShell.mockResolvedValue(integration);
    mockSessionManager.getPairingSnapshot.mockReturnValue({
      qrCode: 'qr-data',
      pairingCode: 'ABCDEF',
    });

    const result = await service.connect(userId, agentId);

    expect(mockConnectivity.assertReachable).toHaveBeenCalledWith(true);
    expect(mockAuthStore.deleteAuthState).toHaveBeenCalledWith(integration._id);
    expect(mockSessionManager.startPairing).toHaveBeenCalledWith(
      integration,
      expect.any(String),
    );
    expect(result).toEqual({
      sessionId: expect.any(String),
      status: 'PAIRING',
      qrCode: 'qr-data',
      pairingCode: 'ABCDEF',
    });
  });

  it('returns pairing snapshot for an active pairing session', async () => {
    mockIntegrationService.getDocumentBySessionForUser.mockResolvedValue({
      status: WhatsAppIntegrationStatus.PAIRING,
    });
    mockSessionManager.getPairingSnapshot.mockReturnValue({ qrCode: 'qr-data' });

    const result = await service.getPairing(userId, agentId, sessionId);

    expect(result).toEqual({ qrCode: 'qr-data' });
  });

  it('throws when session is not in pairing state', async () => {
    mockIntegrationService.getDocumentBySessionForUser.mockResolvedValue({
      status: WhatsAppIntegrationStatus.CONNECTED,
    });

    await expect(service.getPairing(userId, agentId, sessionId)).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_SESSION_NOT_PAIRING,
    });
  });

  it('reconnects and returns refreshed integration response', async () => {
    const integration = { _id: new Types.ObjectId(), status: WhatsAppIntegrationStatus.DISCONNECTED };
    const refreshed = { status: WhatsAppIntegrationStatus.CONNECTED };
    const response = { status: 'CONNECTED' };

    mockIntegrationService.getDocumentBySessionForUser.mockResolvedValue(integration);
    mockIntegrationService.getDocumentByAgentForUser.mockResolvedValue(refreshed);
    mockIntegrationService.toResponse.mockReturnValue(response);

    const result = await service.reconnect(userId, agentId, sessionId);

    expect(mockSessionManager.reconnect).toHaveBeenCalledWith(integration, sessionId);
    expect(result).toBe(response);
  });

  it('disconnects session and clears auth state', async () => {
    const integration = { _id: new Types.ObjectId() };
    mockIntegrationService.getDocumentBySessionForUser.mockResolvedValue(integration);

    await service.disconnectSession(userId, agentId, sessionId);

    expect(mockSessionManager.stopSession).toHaveBeenCalledWith(sessionId, true);
    expect(mockAuthStore.deleteAuthState).toHaveBeenCalledWith(integration._id);
    expect(mockIntegrationService.updateStatus).toHaveBeenCalledWith(integration._id, {
      status: WhatsAppIntegrationStatus.DISCONNECTED,
      sessionId: undefined,
      phoneNumber: undefined,
      displayName: undefined,
      errorMessage: undefined,
    });
  });

  it('deletes integration and stops active session', async () => {
    const integration = { _id: new Types.ObjectId(), sessionId: 'active-session' };
    mockIntegrationService.getDocumentByAgentForUser.mockResolvedValue(integration);

    await service.deleteIntegration(userId, agentId);

    expect(mockSessionManager.stopSession).toHaveBeenCalledWith('active-session', true);
    expect(mockAuthStore.deleteAuthState).toHaveBeenCalledWith(integration._id);
    expect(mockIntegrationService.deleteIntegrationForAgent).toHaveBeenCalledWith(
      userId,
      agentId,
    );
  });
});
