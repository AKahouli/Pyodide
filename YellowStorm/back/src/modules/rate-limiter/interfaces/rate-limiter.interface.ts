export interface RateLimitRecord {
  count: number;
  resetAt: number;
  firstRequestAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyPrefix?: string;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitRecord>;
  get(key: string): Promise<RateLimitRecord | null>;
  reset(key: string): Promise<void>;
  cleanup(): Promise<void>;
}
