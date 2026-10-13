import { createHash } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';
import { getClientIp } from '@common/utils';
import authConfig, { type AuthAccountRateLimitScope, type AuthIpRateLimitScope } from '@config/auth.config';
import { RateLimiterService } from '../../rate-limiter';
import { TooManyRequestsException } from '../../exceptions';

/**
 * Config-driven throttling for the unauthenticated auth endpoints. Per-IP
 * buckets use the Express-resolved client IP (honours TRUST_PROXY, never raw
 * forwarding headers); per-account buckets are keyed by a digest of the
 * normalised identity so the same budget applies whether or not the account
 * exists (no enumeration signal) and no plaintext email is retained.
 */
@Injectable()
export class AuthThrottleService {
  constructor(
    private readonly rateLimiter: RateLimiterService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async enforceIp(scope: AuthIpRateLimitScope, req: Request, res?: Response): Promise<void> {
    const rule = this.config.rateLimits.ip[scope];
    await this.consume(`auth:ip:${scope}`, `ip:${getClientIp(req)}`, rule, res);
  }

  async enforceAccount(
    // 'login' is excluded: its budget counts failed attempts only (LoginLockoutService).
    scope: Exclude<AuthAccountRateLimitScope, 'login'>,
    identity: string,
    res?: Response,
  ): Promise<void> {
    const rule = this.config.rateLimits.account[scope];
    await this.consume(`auth:acct:${scope}`, `id:${AuthThrottleService.digest(identity)}`, rule, res);
  }

  /** Stable, non-reversible bucket key for an email or token identity. */
  static digest(identity: string): string {
    return createHash('sha256').update(identity.trim().toLowerCase()).digest('hex').slice(0, 32);
  }

  private async consume(
    keyPrefix: string,
    identifier: string,
    rule: { limit: number; windowMs: number },
    res?: Response,
  ): Promise<void> {
    const result = await this.rateLimiter.check(identifier, {
      limit: rule.limit,
      windowMs: rule.windowMs,
      keyPrefix,
    });
    if (result.allowed) return;

    const retryAfter = Math.max(1, result.retryAfter ?? Math.ceil(rule.windowMs / 1000));
    res?.setHeader('Retry-After', String(retryAfter));
    throw new TooManyRequestsException(`Too many attempts. Try again in ${String(retryAfter)} seconds.`);
  }
}
