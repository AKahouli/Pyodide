import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ForbiddenException, TooManyRequestsException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { RateLimiterService } from '../../rate-limiter';
import { UserDocument } from '../../user/schemas/user.schema';
import { AppBuilderAiUsageService } from '../services/app-builder-ai-usage.service';
import { isAppBuilderAiProxyMode } from '../utils/app-builder-ai-mode';

type AiProxyAuthedRequest = Request & {
  user?: UserDocument;
  aiProxyAuth?: { mode?: 'platform' | 'app_end_user' | 'ai_preview' };
  body?: { max_tokens?: number; max_completion_tokens?: number };
};

/**
 * Enforces the dedicated App Builder AI offer quota for preview/end-user traffic.
 * Platform JWT traffic is skipped (handled by UsageLimitGuard).
 * Also applies offer-level RPM and maxTokensPerRequest when configured (> 0).
 */
@Injectable()
export class AppBuilderAiUsageLimitGuard implements CanActivate {
  constructor(
    private readonly usage: AppBuilderAiUsageService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AiProxyAuthedRequest>();
    if (!isAppBuilderAiProxyMode(request.aiProxyAuth?.mode)) {
      return true;
    }
    const user = request.user;
    if (!user) return true;

    const userId = user._id.toString();
    const check = await this.usage.checkLimit(userId);
    if (!check.allowed) {
      throw new ForbiddenException(
        ErrorCode.USAGE_LIMIT_EXCEEDED,
        `App Builder AI token limit exceeded. Resets at ${check.resetsAt.toISOString()}. ` +
          `Current usage: ${check.currentUsage}/${check.limit} tokens.`,
      );
    }

    const offer = check.offer;
    const maxTokens = offer.maxTokensPerRequest;
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      const requested =
        request.body?.max_completion_tokens ?? request.body?.max_tokens;
      if (typeof requested === 'number' && requested > maxTokens) {
        throw new ForbiddenException(
          ErrorCode.USAGE_LIMIT_EXCEEDED,
          `Requested tokens (${requested}) exceed the offer maximum of ${maxTokens}.`,
        );
      }
    }

    const rpm = offer.requestsPerMinute;
    if (typeof rpm === 'number' && rpm > 0) {
      const result = await this.rateLimiter.check(`ab-ai-rpm:${userId}`, {
        limit: rpm,
        windowMs: 60_000,
        keyPrefix: 'app-builder-ai',
      });
      if (!result.allowed) {
        throw new TooManyRequestsException(
          `App Builder AI rate limit exceeded (${rpm}/min). Try again in ${result.retryAfter ?? 1} seconds.`,
        );
      }
    }

    return true;
  }
}
