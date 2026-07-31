# Rate Limiter Module

A production-grade, user-based rate limiting module with per-endpoint control.

## Features

- **User-Based Limiting** - Each user has their own rate limit counter
- **IP Fallback** - Anonymous users are limited by IP address
- **Per-Endpoint Control** - Different limits for different routes
- **Sliding Window** - Accurate rate limiting algorithm
- **Response Headers** - Standard rate limit headers for client awareness
- **Global Guard** - Automatic enforcement on decorated routes
- **Configurable** - Environment-based default configuration

## Configuration

Set defaults in your `.env` file:

```env
THROTTLE_TTL=60        # Window size in seconds
THROTTLE_LIMIT=100     # Requests per window
```

## Usage

### Basic Rate Limiting

Apply the `@RateLimit()` decorator to controllers or individual routes:

```typescript
import { Controller, Get } from '@nestjs/common';
import { RateLimit } from '@modules/rate-limiter';

@Controller('api')
export class ApiController {
  // 100 requests per minute (uses defaults)
  @RateLimit()
  @Get('data')
  getData() {
    return { data: 'example' };
  }

  // 10 requests per minute
  @RateLimit({ limit: 10, windowMs: 60000 })
  @Get('expensive-operation')
  expensiveOperation() {
    return { result: 'done' };
  }

  // 5 requests per hour for AI endpoints
  @RateLimit({ limit: 5, windowMs: 3600000, keyPrefix: 'ai' })
  @Get('ai/generate')
  generateAI() {
    return { generated: 'content' };
  }
}
```

### Controller-Level Rate Limiting

```typescript
import { Controller, Get } from '@nestjs/common';
import { RateLimit, RateLimitSkip } from '@modules/rate-limiter';

@RateLimit({ limit: 50, windowMs: 60000 })
@Controller('users')
export class UsersController {
  // Inherits 50/min from controller
  @Get()
  findAll() {}

  // Overrides to 10/min
  @RateLimit({ limit: 10, windowMs: 60000 })
  @Get('search')
  search() {}

  // Skips rate limiting entirely
  @RateLimitSkip()
  @Get('health')
  health() {}
}
```

### Programmatic Access

```typescript
import { Injectable } from '@nestjs/common';
import { RateLimiterService } from '@modules/rate-limiter';

@Injectable()
export class MyService {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  async checkUserLimit(userId: string) {
    const key = this.rateLimiter.generateKey(userId, undefined, 'custom-action');

    const result = await this.rateLimiter.check(key, {
      limit: 5,
      windowMs: 60000,
    });

    if (!result.allowed) {
      throw new Error(`Rate limited. Retry in ${result.retryAfter}s`);
    }

    return result;
  }

  async resetUserLimit(userId: string) {
    const key = this.rateLimiter.generateKey(userId);
    await this.rateLimiter.reset(key);
  }
}
```

## Response Headers

When rate limiting is active, the following headers are set:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in window |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds to wait (only when limit exceeded) |

## Rate Limit Key Generation

Keys are generated based on:

1. **Authenticated users**: `user:{userId}:{endpoint}`
2. **Anonymous users**: `ip:{clientIp}:{endpoint}`

This ensures:
- Each user has independent limits
- Same user accessing different endpoints has separate limits
- Shared IPs (corporate networks) are handled per-user when authenticated

## Error Response

When rate limit is exceeded:

```json
{
  "success": false,
  "error": {
    "code": "ERR_1007",
    "message": "Rate limit exceeded. Try again in 45 seconds.",
    "statusCode": 429,
    "timestamp": "2024-01-14T12:00:00.000Z",
    "path": "/api/v1/data",
    "method": "GET",
    "requestId": "uuid"
  }
}
```

## Security Considerations

- **IP Extraction**: Uses Express `req.ip` (and socket fallback). Application code must not read `X-Forwarded-For` / `X-Real-IP` directly. Configure `TRUST_PROXY` to the ingress hop count or proxy CIDRs so Express derives `req.ip` safely; leave empty/`false` when there is no trusted proxy.
- **User Priority**: Authenticated users are identified by user ID, preventing IP-based bypass
- **Automatic Cleanup**: Expired records are automatically cleaned up every 60 seconds
- **Memory Efficient**: Uses sliding window counters, not request logs

## Production Notes

For high-traffic production environments, consider:

1. **Redis Store**: Replace `MemoryStore` with a Redis-based implementation for distributed rate limiting across multiple instances
2. **Cluster Awareness**: Memory store only works for single-instance deployments
3. **Monitoring**: Log rate limit violations for security monitoring
