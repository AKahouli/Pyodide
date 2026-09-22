import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimiterService } from './rate-limiter.service';
import { RateLimitGuard } from './guards/rate-limit.guard';

@Global()
@Module({
  providers: [
    RateLimiterService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
  exports: [RateLimiterService],
})
export class RateLimiterModule {}
