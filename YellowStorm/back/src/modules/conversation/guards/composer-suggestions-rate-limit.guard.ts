import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TooManyRequestsException } from '../../exceptions';
import { RateLimiterService } from '../../rate-limiter';
import { ConversationSettingsService } from '../../system/conversation-settings.service';

interface AuthenticatedRequest extends Request {
  user?: { sub?: string; id?: string };
}

@Injectable()
export class ComposerSuggestionsRateLimitGuard implements CanActivate {
  constructor(
    private readonly settings: ConversationSettingsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const { requestsPerMinute } = (await this.settings.getSettings()).composerSuggestions;
    const identifier = this.rateLimiter.generateKey(
      request.user?.sub ?? request.user?.id,
      request.ip,
      'POST:conversation:suggestions',
    );
    const result = await this.rateLimiter.check(identifier, {
      limit: requestsPerMinute,
      windowMs: 60_000,
      keyPrefix: 'conversation:suggestions',
    });
    response.setHeader('X-RateLimit-Limit', String(result.limit));
    response.setHeader('X-RateLimit-Remaining', String(result.remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfter));
      throw new TooManyRequestsException(`Rate limit exceeded. Try again in ${result.retryAfter} seconds.`);
    }
    return true;
  }
}
