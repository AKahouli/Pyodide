import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@modules/logger';

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
}

@Injectable()
export class WhatsAppRateLimiterService {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WhatsAppRateLimiterService.name);
  }

  private maxTokensPerMinute(): number {
    return this.configService.get<number>('whatsapp.maxInboundPerMinute', 30);
  }

  private bucketWindowMs(): number {
    return 60_000;
  }

  tryAcquire(integrationId: string): boolean {
    const maxTokens = this.maxTokensPerMinute();
    const windowMs = this.bucketWindowMs();
    const now = Date.now();

    let bucket = this.buckets.get(integrationId);
    if (!bucket) {
      bucket = { tokens: maxTokens - 1, lastRefillAt: now };
      this.buckets.set(integrationId, bucket);
      return true;
    }

    const elapsed = now - bucket.lastRefillAt;
    const refill = Math.floor((elapsed / windowMs) * maxTokens);
    bucket.tokens = Math.min(maxTokens, bucket.tokens + refill);
    bucket.lastRefillAt = now - (elapsed % windowMs);

    if (bucket.tokens <= 0) {
      this.logger.warn('WhatsApp rate limit exceeded', {
        integrationId,
        tokensRemaining: 0,
        windowMs,
      });
      return false;
    }

    bucket.tokens -= 1;
    return true;
  }

  reset(integrationId: string): void {
    this.buckets.delete(integrationId);
  }

  resetAll(): void {
    this.buckets.clear();
  }
}
