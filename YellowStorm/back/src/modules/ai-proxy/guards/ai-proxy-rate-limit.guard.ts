import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { getClientIp } from '@common/utils';
import { TooManyRequestsException } from '../../exceptions';
import { RateLimiterService } from '../../rate-limiter';
import {
  AI_PROXY_DEFAULT_RATE_LIMIT_PER_USER,
  AI_PROXY_DEFAULT_RATE_LIMIT_WINDOW_MS,
} from '../constants/ai-proxy.constants';

interface AiProxyRequestUser {
  _id?: { toString(): string };
  id?: string;
  sub?: string;
}

type AiProxyRequest = Request & {
  user?: AiProxyRequestUser;
  body: Request['body'] & { model?: string };
};

@Injectable()
export class AiProxyRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimiterService: RateLimiterService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AiProxyRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const limit = this.configService.get<number>(
      'aiProxy.rateLimitPerUser',
      AI_PROXY_DEFAULT_RATE_LIMIT_PER_USER,
    );
    const windowMs = this.configService.get<number>(
      'aiProxy.rateLimitWindowMs',
      AI_PROXY_DEFAULT_RATE_LIMIT_WINDOW_MS,
    );

    const userId = this.resolveUserId(request.user);
    const ip = getClientIp(request);
    const handler = context.getHandler().name;
    const model = typeof request.body?.model === 'string' ? request.body.model : undefined;
    const endpoint = model
      ? `${request.method}:AiProxyController:${handler}:${model}`
      : `${request.method}:AiProxyController:${handler}`;

    const identifier = this.rateLimiterService.generateKey(userId, ip, endpoint);
    const result = await this.rateLimiterService.check(identifier, {
      limit,
      windowMs,
      keyPrefix: 'ai-proxy',
    });

    response.setHeader('X-RateLimit-Limit', String(result.limit));
    response.setHeader('X-RateLimit-Remaining', String(result.remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfter ?? 1));
      throw new TooManyRequestsException(
        `Rate limit exceeded. Try again in ${result.retryAfter ?? 1} seconds.`,
      );
    }

    return true;
  }

  private resolveUserId(
    user?: AiProxyRequestUser,
  ): string | undefined {
    if (!user) return undefined;
    if (user._id) return user._id.toString();
    return user.id ?? user.sub;
  }
}
