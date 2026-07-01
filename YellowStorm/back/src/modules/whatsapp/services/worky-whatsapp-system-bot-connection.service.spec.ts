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
  const adminUserId = '507f1f77bcf86cd799439011';
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
        expectedPairingPhone: '33753929093',
        pairedByUserId: new Types.ObjectId(),
      }),
    });

    await expect(service.connect(adminUserId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('connect rejects when expected phone is not configured', async () => {
    systemBotModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: integrationId,
        key: WORKY_WHATSAPP_SYSTEM_BOT_KEY,
        status: WhatsAppIntegrationStatus.DISCONNECTED,
      }),
    });

    await expect(service.connect(adminUserId)).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_SYSTEM_BOT_PHONE_NOT_CONFIGURED,
    });
  });

  it('connect starts pairing for disconnected bot', async () => {
    systemBotModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: integrationId,
        key: WORKY_WHATSAPP_SYSTEM_BOT_KEY,
        status: WhatsAppIntegrationStatus.DISCONNECTED,
        expectedPairingPhone: '33753929093',
      }),
    });
    systemBotModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: integrationId,
        pairedByUserId: new Types.ObjectId(adminUserId),
        status: WhatsAppIntegrationStatus.PAIRING,
      }),
    });

    const result = await service.connect(adminUserId);

    expect(authStore.deleteAuthState).toHaveBeenCalledWith(integrationId);
    expect(sessionManager.startPairing).toHaveBeenCalled();
    expect(result.status).toBe('PAIRING');
    expect(result.sessionId).toBeDefined();
  });
});

describe('WorkyWhatsAppSystemBotService', () => {
  let service: WorkyWhatsAppSystemBotService;
  const systemBotModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkyWhatsAppSystemBotService,
        {
          provide: getModelToken(WorkyWhatsAppSystemBot.name),
          useValue: systemBotModel,
        },
      ],
    }).compile();

    service = module.get(WorkyWhatsAppSystemBotService);
  });

  it('assertExpectedPhone accepts matching digits', async () => {
    systemBotModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        expectedPairingPhone: '33753929093',
      }),
    });

    await expect(service.assertExpectedPhone('+33753929093')).resolves.toBeUndefined();
  });

  it('assertExpectedPhone rejects mismatch', async () => {
    systemBotModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        expectedPairingPhone: '33753929093',
      }),
    });

    await expect(service.assertExpectedPhone('+21600000000')).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_SYSTEM_BOT_PHONE_MISMATCH,
    });
  });

  it('assertExpectedPhone rejects when phone is not configured', async () => {
    systemBotModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({}),
    });

    await expect(service.assertExpectedPhone('+33753929093')).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_SYSTEM_BOT_PHONE_NOT_CONFIGURED,
    });
  });
});
