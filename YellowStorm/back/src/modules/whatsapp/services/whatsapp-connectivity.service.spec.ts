import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import { WHATSAPP_SW_JS_URL } from '../baileys/whatsapp-network.util';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';

describe('WhatsAppConnectivityService', () => {
  let service: WhatsAppConnectivityService;

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.enabled') return true;
      if (key === 'whatsapp.connectivityProbeTimeoutMs') return 5000;
      return defaultValue;
    }),
  };

  const originalFetch = global.fetch;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.enabled') return true;
      if (key === 'whatsapp.connectivityProbeTimeoutMs') return 5000;
      return defaultValue;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppConnectivityService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get(WhatsAppConnectivityService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('skips startup probe when WhatsApp is disabled', async () => {
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'whatsapp.enabled') return false;
      return defaultValue;
    });
    global.fetch = jest.fn();

    const disabledModule = await Test.createTestingModule({
      providers: [
        WhatsAppConnectivityService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    await disabledModule.get(WhatsAppConnectivityService).onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns reachable when fetch succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const result = await service.probeWhatsAppServers(true);

    expect(result).toEqual({ reachable: true });
    expect(global.fetch).toHaveBeenCalledWith(
      WHATSAPP_SW_JS_URL,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('returns unreachable and logs when fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

    const result = await service.probeWhatsAppServers(true);

    expect(result).toEqual({ reachable: false, error: 'ECONNRESET' });
    expect(mockLoggerService.warn).toHaveBeenCalledWith(
      'WhatsApp connectivity probe failed',
      { error: 'ECONNRESET' },
    );
  });

  it('uses cached probe result within the cache window', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    await service.probeWhatsAppServers(true);
    const result = await service.probeWhatsAppServers(false);

    expect(result).toEqual({ reachable: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws BadRequestException when assertReachable fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(service.assertReachable(true)).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_NETWORK_UNREACHABLE,
    });
    await expect(service.assertReachable(true)).rejects.toBeInstanceOf(BadRequestException);
  });
});
