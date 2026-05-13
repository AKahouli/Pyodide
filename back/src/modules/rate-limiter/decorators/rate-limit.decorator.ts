import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitMetadata {
  limit: number;
  windowMs: number;
  keyPrefix?: string;
  skipIf?: (context: unknown) => boolean;
}

export const RateLimit = (options: Partial<RateLimitMetadata> = {}): MethodDecorator & ClassDecorator => {
  return SetMetadata(RATE_LIMIT_KEY, {
    limit: options.limit ?? 100,
    windowMs: options.windowMs ?? 60000,
    keyPrefix: options.keyPrefix,
    skipIf: options.skipIf,
  });
};

export const RateLimitSkip = (): MethodDecorator & ClassDecorator => {
  return SetMetadata(RATE_LIMIT_KEY, { skip: true });
};
