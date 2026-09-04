import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { WorkyStream } from '../schemas/worky-stream.schema';
import { WorkyPlanningService } from './worky-planning.service';
import { WorkySttService } from './worky-stt.service';
import { WorkyWhatsAppIngressService } from './worky-whatsapp-ingress.service';
import { WorkyTurnKickoffService } from './worky-turn-kickoff.service';

describe('WorkyWhatsAppIngressService', () => {
  let service: WorkyWhatsAppIngressService;
  const streamId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();
  const streams = { findById: jest.fn() };
  const planning = {
    appendOwnerMessage: jest.fn(),
  };
  const kickoff = { kickoff: jest.fn() };
  const stt = { transcribe: jest.fn() };
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'worky.sttMaxBytes') return 26214400;
      return defaultValue;
    }),
  };
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    streams.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ownerUserId: new Types.ObjectId(userId),
        status: 'active',
      }),
    });
    planning.appendOwnerMessage.mockResolvedValue({
      id: 'msg-1',
      content: 'hello',
      createdAt: new Date().toISOString(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkyWhatsAppIngressService,
        { provide: getModelToken(WorkyStream.name), useValue: streams },
        { provide: WorkyPlanningService, useValue: planning },
        { provide: WorkyTurnKickoffService, useValue: kickoff },
        { provide: WorkySttService, useValue: stt },
        { provide: ConfigService, useValue: configService },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();

    service = module.get(WorkyWhatsAppIngressService);
  });

  it('ingestAudioMessage transcribes and ingests text', async () => {
    stt.transcribe.mockResolvedValue({ text: '  Bonjour Worky  ' });

    await service.ingestAudioMessage({
      streamId,
      userId,
      audio: Buffer.from('audio-bytes'),
      mimetype: 'audio/ogg; codecs=opus',
    });

    expect(stt.transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      'audio/ogg; codecs=opus',
    );
    expect(planning.appendOwnerMessage).toHaveBeenCalledWith(userId, streamId, {
      content: 'Bonjour Worky',
    });
    expect(kickoff.kickoff).toHaveBeenCalledWith({
      streamId,
      userId,
      content: 'Bonjour Worky',
      turnId: undefined,
    });
  });

  it('ingestAudioMessage drops empty transcription', async () => {
    stt.transcribe.mockResolvedValue({ text: '   ' });

    await service.ingestAudioMessage({
      streamId,
      userId,
      audio: Buffer.from('audio-bytes'),
      mimetype: 'audio/ogg',
    });

    expect(planning.appendOwnerMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Worky WhatsApp voice drop: empty transcription',
      expect.objectContaining({ streamId }),
    );
  });
});
