import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@modules/logger';
import { BadRequestException } from '@modules/exceptions';
import { TelegramLinkCodeService } from './telegram-link-code.service';
import { TELEGRAM_LINK_CODE_STORE } from '../persistence/telegram.store';
import { InMemoryTelegramLinkCodeStore } from '../persistence/telegram.store.fake';

describe('TelegramLinkCodeService', () => {
  let service: TelegramLinkCodeService;
  let linkCodeStore: InMemoryTelegramLinkCodeStore;

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
    linkCodeStore = new InMemoryTelegramLinkCodeStore();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramLinkCodeService,
        { provide: TELEGRAM_LINK_CODE_STORE, useValue: linkCodeStore },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<TelegramLinkCodeService>(TelegramLinkCodeService);
  });

  it('generates a code, stores only its sha256 hash, and replaces unconsumed codes', async () => {
    await linkCodeStore.generate({
      integrationId: 'integration-1',
      userId: 'user-1',
      agentId: 'agent-1',
      codeHash: 'stale-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.generateForIntegration({ id: 'integration-1', userId: 'user-1', agentId: 'agent-1' } as any);

    expect(result.code).toHaveLength(8);
    expect(typeof result.expiresAt).toBe('string');
    expect(linkCodeStore.rows).toHaveLength(1);
    expect(linkCodeStore.rows[0].codeHash).toBe(createHash('sha256').update(result.code).digest('hex'));
    expect(linkCodeStore.rows[0].consumed).toBe(false);
  });

  it('marks code as consumed when valid', async () => {
    const result = await service.generateForIntegration({ id: 'integration-1', userId: 'user-1', agentId: 'agent-1' } as any);

    const record = await service.consumeCodeOrThrow(result.code, 'integration-1');

    expect(record.id).toBe(linkCodeStore.rows[0].id);
    expect(record.consumed).toBe(true);
    expect(record.consumedAt).not.toBeNull();
  });

  it('throws when code is invalid or expired', async () => {
    await expect(
      service.consumeCodeOrThrow('INVALID', 'integration-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
