import { AppBuilderAiUsageLimitGuard } from './app-builder-ai-usage-limit.guard';
import { ForbiddenException, TooManyRequestsException } from '../../exceptions';

describe('AppBuilderAiUsageLimitGuard', () => {
  const usage = { checkLimit: jest.fn() };
  const rateLimiter = { check: jest.fn() };
  const createGuard = () =>
    new AppBuilderAiUsageLimitGuard(usage as never, rateLimiter as never);

  const offer = {
    maxTokensPerRequest: -1,
    requestsPerMinute: 0,
  };

  const ctx = (mode: string, userId = 'u1', body?: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          aiProxyAuth: { mode },
          user: { _id: { toString: () => userId } },
          body: body ?? {},
        }),
      }),
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimiter.check.mockResolvedValue({ allowed: true, remaining: 1, limit: 60, resetAt: Date.now() });
  });

  it('skips platform mode', async () => {
    await expect(createGuard().canActivate(ctx('platform'))).resolves.toBe(true);
    expect(usage.checkLimit).not.toHaveBeenCalled();
  });

  it('allows app builder traffic under quota', async () => {
    usage.checkLimit.mockResolvedValueOnce({
      allowed: true,
      currentUsage: 10,
      limit: 100,
      resetsAt: new Date(),
      offer,
    });
    await expect(createGuard().canActivate(ctx('ai_preview'))).resolves.toBe(true);
  });

  it('rejects when App Builder AI quota is exceeded', async () => {
    usage.checkLimit.mockResolvedValue({
      allowed: false,
      currentUsage: 100,
      limit: 100,
      resetsAt: new Date('2026-01-01T00:00:00.000Z'),
      offer,
    });
    await expect(createGuard().canActivate(ctx('app_end_user'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects when requested tokens exceed offer maxTokensPerRequest', async () => {
    usage.checkLimit.mockResolvedValueOnce({
      allowed: true,
      currentUsage: 0,
      limit: 100,
      resetsAt: new Date(),
      offer: { ...offer, maxTokensPerRequest: 100 },
    });
    await expect(
      createGuard().canActivate(ctx('ai_preview', 'u1', { max_tokens: 500 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when offer RPM is exceeded', async () => {
    usage.checkLimit.mockResolvedValueOnce({
      allowed: true,
      currentUsage: 0,
      limit: 100,
      resetsAt: new Date(),
      offer: { ...offer, requestsPerMinute: 20 },
    });
    rateLimiter.check.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      limit: 20,
      resetAt: Date.now(),
      retryAfter: 30,
    });
    await expect(createGuard().canActivate(ctx('app_end_user'))).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );
  });
});
