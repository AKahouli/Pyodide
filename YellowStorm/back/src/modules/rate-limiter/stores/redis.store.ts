import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RateLimitStore, RateLimitRecord } from '../interfaces/rate-limiter.interface';

@Injectable()
export class RedisStore implements RateLimitStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisStore.name);
  private readonly client: Redis;
  private readonly prefix: string;

  constructor(configService: ConfigService) {
    const url = configService.get<string>('REDIS_URL');
    this.prefix = configService.get<string>('REDIS_KEY_PREFIX') ?? 'rl:';

    if (url) {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });
    } else {
      const password = configService.get<string>('REDIS_PASSWORD');
      this.client = new Redis({
        host: configService.get<string>('REDIS_HOST') ?? 'localhost',
        port: configService.get<number>('REDIS_PORT') ?? 6379,
        password: password || undefined,
        db: configService.get<number>('REDIS_DB') ?? 0,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });
    }

    this.client.on('error', (err) => {
      this.logger.error('Redis connection error', err);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  private key(raw: string): string {
    return `${this.prefix}${raw}`;
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    const k = this.key(key);
    const count = await this.client.incr(k);
    const ttl = await this.client.pttl(k);

    if (count === 1 && ttl < 0) {
      await this.client.pexpire(k, windowMs);
    }

    const resetAt = count === 1 ? Date.now() + windowMs : Date.now() + Math.max(ttl, 0);

    return { count, resetAt, firstRequestAt: 0 };
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    const k = this.key(key);
    const [countStr, ttl] = await Promise.all([
      this.client.get(k),
      this.client.pttl(k),
    ]);

    if (countStr === null || ttl < 0) return null;

    return {
      count: Number(countStr),
      resetAt: Date.now() + ttl,
      firstRequestAt: 0,
    };
  }

  async reset(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async cleanup(): Promise<void> {
    // Redis handles TTL expiry automatically.
  }
}
