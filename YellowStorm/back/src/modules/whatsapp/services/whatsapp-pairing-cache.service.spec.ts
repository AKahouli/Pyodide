import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WhatsAppPairingCacheService } from './whatsapp-pairing-cache.service';

describe('WhatsAppPairingCacheService', () => {
  let service: WhatsAppPairingCacheService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.pairingTimeoutMs') return 60_000;
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppPairingCacheService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(WhatsAppPairingCacheService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('stores and retrieves pairing snapshot', () => {
    service.set('sess-1', { qrCode: 'qr-data' });

    expect(service.get('sess-1')).toEqual({ qrCode: 'qr-data' });
  });

  it('merges snapshots for the same session', () => {
    service.set('sess-1', { qrCode: 'qr-data' });
    service.set('sess-1', { pairingCode: '123456' });

    expect(service.get('sess-1')).toEqual({ qrCode: 'qr-data', pairingCode: '123456' });
  });

  it('returns undefined for unknown or expired sessions', () => {
    service.set('sess-1', { qrCode: 'qr-data' });
    jest.advanceTimersByTime(61_000);

    expect(service.get('sess-1')).toBeUndefined();
    expect(service.get('unknown')).toBeUndefined();
  });

  it('clears a session from cache', () => {
    service.set('sess-1', { qrCode: 'qr-data' });
    service.clear('sess-1');

    expect(service.get('sess-1')).toBeUndefined();
  });
});
