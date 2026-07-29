import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimiterService } from '../rate-limiter.service';
import { TooManyRequestsException } from '../../exceptions';
import { RateLimitResult } from '../interfaces/rate-limiter.interface';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let reflector: jest.Mocked<Reflector>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;

  const createAllowedResult = (overrides: Partial<RateLimitResult> = {}): RateLimitResult => ({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetAt: Date.now() + 60000,
    ...overrides,
  });

  const createDeniedResult = (overrides: Partial<RateLimitResult> = {}): RateLimitResult => ({
    allowed: false,
    limit: 100,
    remaining: 0,
    resetAt: Date.now() + 60000,
    retryAfter: 30,
    ...overrides,
  });

  const mockSetHeader = jest.fn();

  const createMockContext = (overrides: {
    user?: { sub?: string; id?: string };
    headers?: Record<string, string | string[]>;
    ip?: string;
    socket?: { remoteAddress?: string };
    method?: string;
  } = {}): ExecutionContext => {
    const request = {
      user: overrides.user,
      headers: overrides.headers ?? {},
      ip: overrides.ip ?? '127.0.0.1',
      socket: overrides.socket ?? { remoteAddress: '127.0.0.1' },
      method: overrides.method ?? 'GET',
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader: mockSetHeader }),
      }),
      getHandler: () => function testHandler() {},
      getClass: () => class TestController {},
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    rateLimiterService = {
      check: jest.fn(),
      generateKey: jest.fn().mockReturnValue('user:u1:GET:TestController:testHandler'),
    } as unknown as jest.Mocked<RateLimiterService>;

    guard = new RateLimitGuard(reflector, rateLimiterService);
  });

  describe('canActivate', () => {
    it('should allow when no metadata is found', async () => {
      reflector.getAllAndOverride.mockReturnValue(null);

      const result = await guard.canActivate(createMockContext());

      expect(result).toBe(true);
      expect(rateLimiterService.check).not.toHaveBeenCalled();
    });

    it('should allow when metadata has skip flag', async () => {
      reflector.getAllAndOverride.mockReturnValue({ skip: true });

      const result = await guard.canActivate(createMockContext());

      expect(result).toBe(true);
      expect(rateLimiterService.check).not.toHaveBeenCalled();
    });

    it('should allow when rate limit check passes', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        limit: 100,
        windowMs: 60000,
      });
      rateLimiterService.check.mockResolvedValue(createAllowedResult());

      const result = await guard.canActivate(createMockContext({ user: { sub: 'u1' } }));

      expect(result).toBe(true);
    });

    it('should throw TooManyRequestsException when rate limit exceeded', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        limit: 5,
        windowMs: 60000,
      });
      rateLimiterService.check.mockResolvedValue(createDeniedResult({ retryAfter: 45 }));

      const context = createMockContext({ user: { sub: 'u1' } });

      await expect(guard.canActivate(context)).rejects.toThrow(TooManyRequestsException);
    });

    it('should include retryAfter in exception message', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        limit: 5,
        windowMs: 60000,
      });
      rateLimiterService.check.mockResolvedValue(createDeniedResult({ retryAfter: 12 }));

      const context = createMockContext({ user: { sub: 'u1' } });

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Rate limit exceeded. Try again in 12 seconds.',
      );
    });

    it('should call check with metadata options', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        limit: 10,
        windowMs: 30000,
        keyPrefix: 'api',
      });
      rateLimiterService.check.mockResolvedValue(createAllowedResult());

      await guard.canActivate(createMockContext({ user: { sub: 'u1' } }));

      expect(rateLimiterService.check).toHaveBeenCalledWith(
        expect.any(String),
        { limit: 10, windowMs: 30000, keyPrefix: 'api' },
      );
    });
  });

  describe('response headers', () => {
    it('should set rate limit headers on allowed requests', async () => {
      reflector.getAllAndOverride.mockReturnValue({ limit: 50, windowMs: 60000 });
      rateLimiterService.check.mockResolvedValue(
        createAllowedResult({ limit: 50, remaining: 49, resetAt: 1700000060000 }),
      );

      await guard.canActivate(createMockContext({ user: { sub: 'u1' } }));

      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '50');
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '49');
      expect(mockSetHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        String(Math.ceil(1700000060000 / 1000)),
      );
    });

    it('should set Retry-After header on denied requests', async () => {
      reflector.getAllAndOverride.mockReturnValue({ limit: 5, windowMs: 60000 });
      rateLimiterService.check.mockResolvedValue(createDeniedResult({ retryAfter: 20 }));

      const context = createMockContext({ user: { sub: 'u1' } });

      await expect(guard.canActivate(context)).rejects.toThrow();

      expect(mockSetHeader).toHaveBeenCalledWith('Retry-After', '20');
    });

    it('should set rate limit headers even on denied requests', async () => {
      reflector.getAllAndOverride.mockReturnValue({ limit: 5, windowMs: 60000 });
      rateLimiterService.check.mockResolvedValue(
        createDeniedResult({ limit: 5, remaining: 0 }),
      );

      const context = createMockContext({ user: { sub: 'u1' } });

      await expect(guard.canActivate(context)).rejects.toThrow();

      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
    });
  });

  describe('identifier extraction', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue({ limit: 100, windowMs: 60000 });
      rateLimiterService.check.mockResolvedValue(createAllowedResult());
    });

    it('should use user.sub for authenticated users', async () => {
      await guard.canActivate(createMockContext({ user: { sub: 'sub-123' } }));

      expect(rateLimiterService.generateKey).toHaveBeenCalledWith(
        'sub-123',
        expect.any(String),
        expect.any(String),
      );
    });

    it('should fallback to user.id if sub is not present', async () => {
      await guard.canActivate(createMockContext({ user: { id: 'id-456' } }));

      expect(rateLimiterService.generateKey).toHaveBeenCalledWith(
        'id-456',
        expect.any(String),
        expect.any(String),
      );
    });

    it('should pass undefined userId for unauthenticated requests', async () => {
      await guard.canActivate(createMockContext());

      expect(rateLimiterService.generateKey).toHaveBeenCalledWith(
        undefined,
        expect.any(String),
        expect.any(String),
      );
    });

    it('should use request.ip regardless of headers', async () => {
      await guard.canActivate(
        createMockContext({
          ip: '203.0.113.50',
          headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
        }),
      );

      expect(rateLimiterService.generateKey).toHaveBeenCalledWith(
        undefined,
        '203.0.113.50',
        expect.any(String),
      );
    });

    it('should use request.ip when x-real-ip header is present', async () => {
      await guard.canActivate(
        createMockContext({
          ip: '10.0.0.5',
          headers: { 'x-real-ip': '192.168.1.1' },
        }),
      );

      expect(rateLimiterService.generateKey).toHaveBeenCalledWith(
        undefined,
        '10.0.0.5',
        expect.any(String),
      );
    });

    it('should fallback to request.ip', async () => {
      await guard.canActivate(createMockContext({ ip: '192.168.1.100' }));

      expect(rateLimiterService.generateKey).toHaveBeenCalledWith(
        undefined,
        '192.168.1.100',
        expect.any(String),
      );
    });

    it('should fallback to socket.remoteAddress when ip is default', async () => {
      await guard.canActivate(
        createMockContext({ ip: '::1', socket: { remoteAddress: '10.0.0.1' } }),
      );

      expect(rateLimiterService.generateKey).toHaveBeenCalledWith(
        undefined,
        '::1',
        expect.any(String),
      );
    });

    it('should build endpoint from method, class, and handler', async () => {
      await guard.canActivate(createMockContext({ method: 'POST', user: { sub: 'u1' } }));

      expect(rateLimiterService.generateKey).toHaveBeenCalledWith(
        'u1',
        expect.any(String),
        'POST:TestController:testHandler',
      );
    });
  });
});
