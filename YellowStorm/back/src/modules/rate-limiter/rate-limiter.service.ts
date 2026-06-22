import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemoryStore } from './stores/memory.store';
import {
  RateLimitResult,
  RateLimitOptions,
  RateLimitStore,
} from './interfaces/rate-limiter.interface';

@Injectable()
export class RateLimiterService {
  private readonly store: RateLimitStore;
  private readonly defaultLimit: number;
  private readonly defaultWindowMs: number;

  constructor(
    private readonly configService: ConfigService,
    memoryStore: MemoryStore,
  ) {
    this.store = memoryStore;
    this.defaultLimit = this.configService.get<number>('app.throttleLimit', 100);
    this.defaultWindowMs = this.configService.get<number>('app.throttleTtl', 60) * 1000;
  }

  async check(
    identifier: string,
    options?: Partial<RateLimitOptions>,
  ): Promise<RateLimitResult> {
    const limit = options?.limit ?? this.defaultLimit;
    const windowMs = options?.windowMs ?? this.defaultWindowMs;
    const keyPrefix = options?.keyPrefix ?? 'rl';

    const key = `${keyPrefix}:${identifier}`;
    const record = await this.store.increment(key, windowMs);

    const allowed = record.count <= limit;
    const remaining = Math.max(0, limit - record.count);
    const resetAt = record.resetAt;

    const result: RateLimitResult = {
      allowed,
      limit,
      remaining,
      resetAt,
    };

    if (!allowed) {
      result.retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    }

    return result;
  }

  async reset(identifier: string, keyPrefix = 'rl'): Promise<void> {
    const key = `${keyPrefix}:${identifier}`;
    await this.store.reset(key);
  }

  async getStatus(
    identifier: string,
    options?: Partial<RateLimitOptions>,
  ): Promise<RateLimitResult> {
    const limit = options?.limit ?? this.defaultLimit;
    const windowMs = options?.windowMs ?? this.defaultWindowMs;
    const keyPrefix = options?.keyPrefix ?? 'rl';

    const key = `${keyPrefix}:${identifier}`;
    const record = await this.store.get(key);

    if (!record) {
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetAt: Date.now() + windowMs,
      };
    }

    const remaining = Math.max(0, limit - record.count);

    return {
      allowed: record.count < limit,
      limit,
      remaining,
      resetAt: record.resetAt,
    };
  }

  generateKey(userId?: string, ip?: string, endpoint?: string): string {
    const parts: string[] = [];

    if (userId) {
      parts.push(`user:${userId}`);
    } else if (ip) {
      parts.push(`ip:${ip}`);
    } else {
      parts.push('anonymous');
    }

    if (endpoint) {
      parts.push(endpoint.replaceAll('/', ':'));
    }

    return parts.join(':');
  }
}
