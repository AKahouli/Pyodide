import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { getClientIp } from '@common/utils';
import { RateLimiterService } from '../rate-limiter.service';
import { RATE_LIMIT_KEY, RateLimitMetadata } from '../decorators/rate-limit.decorator';
import { TooManyRequestsException } from '../../exceptions';

interface AuthenticatedRequest extends Request {
  user?: { sub?: string; id?: string };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.getMetadata(context);

    if (!metadata || (metadata as { skip?: boolean }).skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const identifier = this.getIdentifier(request, context);
    const result = await this.rateLimiterService.check(identifier, {
      limit: metadata.limit,
      windowMs: metadata.windowMs,
      keyPrefix: metadata.keyPrefix,
    });

    this.setHeaders(response, result.limit, result.remaining, result.resetAt);

    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfter));
      throw new TooManyRequestsException(
        `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      );
    }

    return true;
  }

  private getMetadata(context: ExecutionContext): RateLimitMetadata | null {
    return this.reflector.getAllAndOverride<RateLimitMetadata>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  private getIdentifier(request: AuthenticatedRequest, context: ExecutionContext): string {
    const userId = request.user?.sub ?? request.user?.id;
    const ip = getClientIp(request);
    const endpoint = `${request.method}:${context.getClass().name}:${context.getHandler().name}`;

    return this.rateLimiterService.generateKey(userId, ip, endpoint);
  }

  private setHeaders(
    response: Response,
    limit: number,
    remaining: number,
    resetAt: number,
  ): void {
    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader('X-RateLimit-Remaining', String(remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
  }
}
