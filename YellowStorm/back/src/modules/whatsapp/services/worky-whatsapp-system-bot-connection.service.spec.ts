import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  WorkyWhatsAppSystemBot,
  WORKY_WHATSAPP_SYSTEM_BOT_KEY,
} from '@modules/worky/schemas/worky-whatsapp-system-bot.schema';
import { WorkyWhatsAppSystemBotService } from '@modules/worky/services/worky-whatsapp-system-bot.service';
import { MongoBaileysAuthStore } from '../baileys/mongo-auth-state';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppSessionManager } from './whatsapp-session.manager';
import { WorkyWhatsAppSystemBotConnectionService } from './worky-whatsapp-system-bot-connection.service';

describe('WorkyWhatsAppSystemBotConnectionService', () => {
  let service: WorkyWhatsAppSystemBotConnectionService;
  const integrationId = new Types.ObjectId();
  const systemBotModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    create: jest.fn(),
  };
  const sessionManager = {
    startPairing: jest.fn(),
    getPairingSnapshot: jest.fn().mockReturnValue({ qrCode: 'data:image/png;base64,abc' }),
    reconnect: jest.fn(),
    stopSession: jest.fn(),
  };
  const authStore = { deleteAuthState: jest.fn() };
  const connectivity = { assertReachable: jest.fn() };
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.enabled') return true;
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkyWhatsAppSystemBotConnectionService,
        WorkyWhatsAppSystemBotService,
        { provide: ConfigService, useValue: configService },
        { provide: WhatsAppConnectivityService, useValue: connectivity },
        { provide: WhatsAppSessionManager, useValue: sessionManager },
        { provide: MongoBaileysAuthStore, useValue: authStore },
        { provide: getModelToken(WorkyWhatsAppSystemBot.name), useValue: systemBotModel },
      ],
    }).compile();

    service = module.get(WorkyWhatsAppSystemBotConnectionService);
  });

  it('connect rejects when already connected', async () => {
    systemBotModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: integrationId,
        key: WORKY_WHATSAPP_SYSTEM_BOT_KEY,
        status: WhatsAppIntegrationStatus.CONNECTED,
        pairedByUserId: new Types.ObjectId(),
      }),
    });

    await expect(service.connect('admin-user')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('connect starts pairing for disconnected bot', async () => {
    const pairedByUserId = new Types.ObjectId();
    systemBotModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: integrationId,
        key: WORKY_WHATSAPP_SYSTEM_BOT_KEY,
        status: WhatsAppIntegrationStatus.DISCONNECTED,
      }),
    });
    systemBotModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: integrationId,
        pairedByUserId,
        status: WhatsAppIntegrationStatus.PAIRING,
      }),
    });

    const result = await service.connect('admin-user');

    expect(authStore.deleteAuthState).toHaveBeenCalledWith(integrationId);
    expect(sessionManager.startPairing).toHaveBeenCalled();
    expect(result.status).toBe('PAIRING');
    expect(result.sessionId).toBeDefined();
  });
});

describe('WorkyWhatsAppSystemBotService', () => {
  let service: WorkyWhatsAppSystemBotService;
  const configService = {
    get: jest.fn().mockReturnValue('33753929093'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkyWhatsAppSystemBotService,
        { provide: ConfigService, useValue: configService },
        {
          provide: getModelToken(WorkyWhatsAppSystemBot.name),
          useValue: { findOne: jest.fn(), updateOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(WorkyWhatsAppSystemBotService);
  });

  it('assertExpectedPhone accepts matching digits', () => {
    expect(() => service.assertExpectedPhone('+33753929093')).not.toThrow();
  });

  it('assertExpectedPhone rejects mismatch', () => {
    try {
      service.assertExpectedPhone('+21600000000');
      fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).code).toBe(
        ErrorCode.WHATSAPP_SYSTEM_BOT_PHONE_MISMATCH,
      );
    }
  });
});
