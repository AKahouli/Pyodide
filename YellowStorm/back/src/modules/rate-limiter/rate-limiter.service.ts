import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitResult, RateLimitOptions, RateLimitRecord } from './interfaces/rate-limiter.interface';

const CLEANUP_INTERVAL_MS = 60000;

@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly store = new Map<string, RateLimitRecord>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly defaultLimit: number;
  private readonly defaultWindowMs: number;

  constructor(private readonly configService: ConfigService) {
    this.cleanupInterval = setInterval(() => {
      void this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
    this.defaultLimit = this.configService.get<number>('app.throttleLimit', 100);
    this.defaultWindowMs = this.configService.get<number>('app.throttleTtl', 60) * 1000;
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }

  async check(
    identifier: string,
    options?: Partial<RateLimitOptions>,
  ): Promise<RateLimitResult> {
    const limit = options?.limit ?? this.defaultLimit;
    const windowMs = options?.windowMs ?? this.defaultWindowMs;
    const keyPrefix = options?.keyPrefix ?? 'rl';

    const key = `${keyPrefix}:${identifier}`;
    const record = await this.increment(key, windowMs);

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
    this.store.delete(key);
  }

  async getStatus(
    identifier: string,
    options?: Partial<RateLimitOptions>,
  ): Promise<RateLimitResult> {
    const limit = options?.limit ?? this.defaultLimit;
    const windowMs = options?.windowMs ?? this.defaultWindowMs;
    const keyPrefix = options?.keyPrefix ?? 'rl';

    const key = `${keyPrefix}:${identifier}`;
    const record = this.get(key);

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

  private increment(key: string, windowMs: number): RateLimitRecord {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || now >= existing.resetAt) {
      const record: RateLimitRecord = {
        count: 1,
        resetAt: now + windowMs,
        firstRequestAt: now,
      };
      this.store.set(key, record);
      return record;
    }

    existing.count++;
    this.store.set(key, existing);
    return existing;
  }

  private get(key: string): RateLimitRecord | null {
    const record = this.store.get(key);
    if (!record) return null;

    if (Date.now() >= record.resetAt) {
      this.store.delete(key);
      return null;
    }

    return record;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now >= record.resetAt) {
        this.store.delete(key);
      }
    }
  }
}
