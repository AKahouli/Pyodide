import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TooManyRequestsException } from '../../exceptions';
import { RateLimiterService } from '../../rate-limiter';
import { AiProxyRateLimitGuard } from './ai-proxy-rate-limit.guard';

describe('AiProxyRateLimitGuard', () => {
  const check = jest.fn();
  const generateKey = jest.fn().mockReturnValue('user:u1:endpoint');
  const rateLimiterService = {
    check,
    generateKey,
  } as unknown as RateLimiterService;
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        'aiProxy.rateLimitPerUser': 60,
        'aiProxy.rateLimitWindowMs': 60_000,
      };
      return values[key] ?? fallback;
    }),
  } as unknown as ConfigService;

  const setHeader = jest.fn();

  const createContext = (body?: { model?: string }): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          body,
          ip: '127.0.0.1',
          user: { _id: { toString: () => 'user-1' } },
          headers: {},
        }),
        getResponse: () => ({ setHeader }),
      }),
      getHandler: () => ({ name: 'chatCompletions' }),
      getClass: () => ({ name: 'AiProxyController' }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    check.mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    });
  });

  it('allows requests under the configured limit and scopes by model', async () => {
    const guard = new AiProxyRateLimitGuard(rateLimiterService, configService);

    await expect(guard.canActivate(createContext({ model: 'gpt-4o' }))).resolves.toBe(true);

    expect(generateKey).toHaveBeenCalledWith(
      'user-1',
      '127.0.0.1',
      'POST:AiProxyController:chatCompletions:gpt-4o',
    );
    expect(check).toHaveBeenCalledWith('user:u1:endpoint', {
      limit: 60,
      windowMs: 60_000,
      keyPrefix: 'ai-proxy',
    });
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '60');
  });

  it('throws 429 when the user exceeds the limit', async () => {
    check.mockResolvedValue({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfter: 30,
    });
    const guard = new AiProxyRateLimitGuard(rateLimiterService, configService);

    await expect(guard.canActivate(createContext({ model: 'gpt-4o' }))).rejects.toThrow(
      TooManyRequestsException,
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });
});
