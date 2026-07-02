import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { WorkyWhatsAppIntegrationService } from '@modules/worky/services/worky-whatsapp-integration.service';
import { WorkyWhatsAppSystemBotService } from '@modules/worky/services/worky-whatsapp-system-bot.service';
import { WhatsAppSessionManager } from './whatsapp-session.manager';
import { WorkyWhatsAppGroupService } from './worky-whatsapp-group.service';

describe('WorkyWhatsAppGroupService', () => {
  let service: WorkyWhatsAppGroupService;
  const systemBotService = {
    assertConnected: jest.fn().mockResolvedValue(undefined),
  };
  const workyIntegrationService = {
    findStreamTitle: jest.fn().mockResolvedValue('My Stream'),
    updateGroupJid: jest.fn().mockResolvedValue(undefined),
    updateUserWhatsappJid: jest.fn().mockResolvedValue(undefined),
    resolveGroupJidByStreamId: jest.fn().mockResolvedValue('120363@g.us'),
  };
  const sessionManager = {
    getSystemBotSocket: jest.fn(),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkyWhatsAppGroupService,
        { provide: LoggerService, useValue: logger },
        { provide: WorkyWhatsAppSystemBotService, useValue: systemBotService },
        { provide: WorkyWhatsAppIntegrationService, useValue: workyIntegrationService },
        { provide: WhatsAppSessionManager, useValue: sessionManager },
      ],
    }).compile();

    service = module.get(WorkyWhatsAppGroupService);
  });

  it('resolveGroupJid delegates to integration service', async () => {
    const jid = await service.resolveGroupJid('stream-1');
    expect(jid).toBe('120363@g.us');
    expect(workyIntegrationService.resolveGroupJidByStreamId).toHaveBeenCalledWith('stream-1');
  });

  it('provisionBridgeGroup creates group via bot socket', async () => {
    const groupCreate = jest.fn().mockResolvedValue({ id: '120363999@g.us' });
    sessionManager.getSystemBotSocket.mockReturnValue({ groupCreate });

    const result = await service.provisionBridgeGroup({
      streamId: new Types.ObjectId().toString(),
      userId: new Types.ObjectId().toString(),
      integrationId: new Types.ObjectId(),
      userJid: '21612345678@s.whatsapp.net',
    });

    expect(systemBotService.assertConnected).toHaveBeenCalled();
    expect(groupCreate).toHaveBeenCalledWith('My Stream', ['21612345678@s.whatsapp.net']);
    expect(result.groupJid).toBe('120363999@g.us');
  });

  it('provisionBridgeGroup strips device suffix from participant jid', async () => {
    const groupCreate = jest.fn().mockResolvedValue({ id: '120363999@g.us' });
    sessionManager.getSystemBotSocket.mockReturnValue({ groupCreate });

    await service.provisionBridgeGroup({
      streamId: new Types.ObjectId().toString(),
      userId: new Types.ObjectId().toString(),
      integrationId: new Types.ObjectId(),
      userJid: '21651856582:21@s.whatsapp.net',
    });

    expect(groupCreate).toHaveBeenCalledWith('My Stream', ['21651856582@s.whatsapp.net']);
  });

  it('provisionBridgeGroup throws when bot socket missing', async () => {
    sessionManager.getSystemBotSocket.mockReturnValue(undefined);
    await expect(
      service.provisionBridgeGroup({
        streamId: new Types.ObjectId().toString(),
        userId: new Types.ObjectId().toString(),
        integrationId: new Types.ObjectId(),
        userJid: '21612345678@s.whatsapp.net',
      }),
    ).rejects.toThrow('System bot socket is not active');
  });
});
