import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { BadRequestException } from '@modules/exceptions';
import { TelegramLinkCodeService } from './telegram-link-code.service';
import { TelegramLinkCode } from '../schemas/telegram-link-code.schema';

describe('TelegramLinkCodeService', () => {
  let service: TelegramLinkCodeService;

  const mockModel = {
    deleteMany: jest.fn(),
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: unknown) => {
      if (key === 'telegram.linkCodeTtlSeconds') return 900;
      if (key === 'telegram.linkCodeLength') return 8;
      return defaultValue;
    }),
  };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramLinkCodeService,
        { provide: getModelToken(TelegramLinkCode.name), useValue: mockModel },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<TelegramLinkCodeService>(TelegramLinkCodeService);
  });

  it('generates a code and persists hashed value with expiry', async () => {
    mockModel.deleteMany.mockResolvedValue({ deletedCount: 0 });
    mockModel.create.mockResolvedValue(undefined);
    const integration = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      agentId: new Types.ObjectId(),
    } as any;

    const result = await service.generateForIntegration(integration);

    expect(result.code).toHaveLength(8);
    expect(typeof result.expiresAt).toBe('string');
    expect(mockModel.deleteMany).toHaveBeenCalled();
    expect(mockModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: integration._id,
        userId: integration.userId,
        agentId: integration.agentId,
        consumed: false,
      }),
    );
  });

  it('marks code as consumed when valid', async () => {
    const integrationId = new Types.ObjectId();
    mockModel.findOneAndUpdate.mockResolvedValue({ _id: new Types.ObjectId() });

    await service.consumeCodeOrThrow('ABCD1234', integrationId);

    expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId,
        consumed: false,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ consumed: true }),
      }),
      { new: true },
    );
  });

  it('throws when code is invalid or expired', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue(null);

    await expect(
      service.consumeCodeOrThrow('INVALID', new Types.ObjectId()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
