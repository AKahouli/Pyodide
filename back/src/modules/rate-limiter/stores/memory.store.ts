import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RateLimitStore, RateLimitRecord } from '../interfaces/rate-limiter.interface';

@Injectable()
export class MemoryStore implements RateLimitStore, OnModuleDestroy {
  private readonly store = new Map<string, RateLimitRecord>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      void this.cleanup();
    }, 60000);
    this.cleanupInterval.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
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

  async get(key: string): Promise<RateLimitRecord | null> {
    const record = this.store.get(key);
    if (!record) return null;

    if (Date.now() >= record.resetAt) {
      this.store.delete(key);
      return null;
    }

    return record;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now >= record.resetAt) {
        this.store.delete(key);
      }
    }
  }
}
