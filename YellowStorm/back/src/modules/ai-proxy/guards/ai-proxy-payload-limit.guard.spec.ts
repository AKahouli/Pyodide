import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '../../exceptions';
import { AiProxyPayloadLimitGuard } from './ai-proxy-payload-limit.guard';

describe('AiProxyPayloadLimitGuard', () => {
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'aiProxy.maxBodyBytes') return 100;
      return fallback;
    }),
  } as unknown as ConfigService;

  const createContext = (
    method: string,
    contentLength?: string,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers: contentLength == null ? {} : { 'content-length': contentLength },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows GET requests without checking Content-Length', () => {
    const guard = new AiProxyPayloadLimitGuard(configService);
    expect(guard.canActivate(createContext('GET', '9999'))).toBe(true);
  });

  it('allows POSTs under the configured Content-Length limit', () => {
    const guard = new AiProxyPayloadLimitGuard(configService);
    expect(guard.canActivate(createContext('POST', '50'))).toBe(true);
  });

  it('rejects POSTs that advertise a Content-Length over the limit', () => {
    const guard = new AiProxyPayloadLimitGuard(configService);
    expect(() => guard.canActivate(createContext('POST', '101'))).toThrow(BadRequestException);
  });
});
