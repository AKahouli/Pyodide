# Usage Module

The Usage module provides plan management and token usage tracking for the YelloStorm application. It allows you to define subscription plans with token limits and track user consumption against those limits.

## Features

- **Plan Management**: Create, update, and manage subscription plans (Free, Basic, Enterprise, Unlimited)
- **Usage Tracking**: Track input/output tokens per user with time-windowed limits
- **Usage Guard**: Protect endpoints from users who have exceeded their limits
- **Usage History**: Query historical usage data for analytics
- **Automatic Seeding**: Default plans are created automatically on application startup

## Architecture

### Schemas

| Schema | Description |
|--------|-------------|
| `Plan` | Defines subscription plans with token limits, features, and pricing |
| `Usage` | Aggregated token usage per user per time window |
| `UsageLog` | Detailed per-request logging for analytics |

### Time Windows

Usage is tracked in configurable time windows (e.g., 24 hours for daily limits). When a window expires, a new one is automatically created. This allows for:
- Rolling limits that reset automatically
- Historical usage tracking
- Different window sizes per plan (hourly, daily, weekly)

## Default Plans

| Plan | Token Limit | Window | Requests/Min | Features |
|------|-------------|--------|--------------|----------|
| Free | 10,000 | 24h | 10 | `basic_chat` |
| Basic | 100,000 | 24h | 30 | `basic_chat`, `history`, `export` |
| Enterprise | 1,000,000 | 24h | 60 | + `api_access`, `priority_support`, `analytics` |
| Unlimited | ∞ | 24h | ∞ | All features |

## API Endpoints

### User Endpoints

```
GET  /api/v1/usage/status   - Get current usage status (tokens used, remaining, reset time)
GET  /api/v1/usage/plan     - Get user's current plan details
GET  /api/v1/usage/history  - Get usage history with optional date filtering
```

### Plan Management (Admin)

```
GET    /api/v1/usage/plans      - Get all active plans
GET    /api/v1/usage/plans/all  - Get all plans including inactive
GET    /api/v1/usage/plans/:id  - Get plan by ID
POST   /api/v1/usage/plans      - Create a new plan
PUT    /api/v1/usage/plans/:id  - Update a plan
DELETE /api/v1/usage/plans/:id  - Deactivate a plan
```

## Usage

### Protecting Endpoints with Usage Limits

Use the `@CheckUsage()` decorator to enforce limits on token-consuming endpoints:

```typescript
import { CheckUsage } from '../usage';

@Controller('chat')
export class ChatController {
  // Basic usage check - blocks if user exceeded their token limit
  @Post()
  @CheckUsage()
  async chat(@Body() dto: ChatDto) {
    // Your chat logic here
  }

  // Check with estimated tokens (pre-flight check)
  @Post('generate')
  @CheckUsage({ estimatedTokens: 2000 })
  async generateLongText(@Body() dto: GenerateDto) {
    // Will be blocked if user can't afford 2000 tokens
  }

  // Require a specific feature
  @Get('api-endpoint')
  @CheckUsage({ requiredFeature: 'api_access' })
  async apiOnly() {
    // Only accessible to users with 'api_access' feature
  }
}
```

### Recording Usage

After processing a request that consumes tokens, record the usage:

```typescript
import { UsageService, UsageType } from '../usage';

@Injectable()
export class ChatService {
  constructor(private readonly usageService: UsageService) {}

  async processChat(userId: string, plan: PlanDocument, result: ChatResult) {
    // Record the token usage
    await this.usageService.recordUsageWithPlan(
      {
        userId,
        inputTokens: result.promptTokens,
        outputTokens: result.completionTokens,
        usageType: UsageType.CHAT,
        modelName: 'gpt-4',
        endpoint: '/chat',
        durationMs: result.durationMs,
        success: true,
      },
      plan,
    );
  }
}
```

### Getting Usage Status

```typescript
// Get current usage status for a user
const status = await usageService.getUsageStatus(userId, plan);

// Response structure:
{
  window: {
    start: Date,
    end: Date,
    hoursRemaining: number
  },
  tokens: {
    input: number,
    output: number,
    total: number,
    limit: number,
    remaining: number,
    percentUsed: number,
    isUnlimited: boolean
  },
  requests: {
    count: number,
    limit: number,
    remaining: number,
    isUnlimited: boolean
  },
  plan: {
    id: string,
    name: string,
    slug: string,
    // ...
  },
  isLimitExceeded: boolean,
  resetsAt: string  // ISO date string
}
```

### Checking Limits Programmatically

```typescript
// Check if user can make a request
const check = await usageService.checkUsageLimit(userId, plan, estimatedTokens);

if (!check.allowed) {
  throw new ForbiddenException(
    ErrorCode.USAGE_LIMIT_EXCEEDED,
    `Limit exceeded. Resets at ${check.resetsAt}`
  );
}
```

### Assigning Plans to Users

Plans are automatically assigned during registration. To manually assign a plan:

```typescript
// Get a plan
const plan = await usageService.getPlanBySlug('basic');

// Assign to user
await userService.assignPlan(userId, plan._id, plan.slug);
```

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| ERR_1700 | USAGE_LIMIT_EXCEEDED | User has exceeded their token limit |
| ERR_1701 | USAGE_RATE_LIMITED | Too many requests per minute |
| ERR_1702 | USAGE_REQUEST_TOO_LARGE | Single request exceeds max tokens |
| ERR_1710 | PLAN_NOT_FOUND | Requested plan doesn't exist |
| ERR_1711 | PLAN_ALREADY_EXISTS | Plan with slug already exists |
| ERR_1712 | PLAN_INACTIVE | Plan is not available |
| ERR_1713 | PLAN_INVALID | Invalid plan configuration |
| ERR_1714 | PLAN_UPGRADE_REQUIRED | Feature requires higher tier |
| ERR_1715 | PLAN_FEATURE_NOT_AVAILABLE | Feature not in user's plan |

## Creating Custom Plans

```typescript
const plan = await usageService.createPlan({
  name: 'Pro',
  slug: 'pro',
  description: 'Professional plan for power users',
  tokenLimit: 500000,      // 500k tokens
  windowHours: 24,         // Daily limit
  requestsPerMinute: 45,
  maxTokensPerRequest: 8000,
  features: ['basic_chat', 'history', 'export', 'api_access'],
  priority: 1,
  priceMonthly: 29.99,
  priceYearly: 299.99,
  isActive: true,
  isDefault: false,
  displayOrder: 1,
});
```

## Database Indexes

The module creates the following indexes for performance:

**Plans Collection:**
- `slug` (unique)
- `isActive, displayOrder`
- `isDefault`
- `priority`

**Usage Collection:**
- `userId, windowStart, windowEnd` (unique compound)
- `userId, windowEnd`
- `windowStart, planSlug`

**Usage Logs Collection:**
- `userId, createdAt`
- `usageType, modelName, createdAt`
- `createdAt` (with 30-day TTL for auto-cleanup)

## Integration with Auth Module

The auth module automatically assigns the default (free) plan to new users during registration:

```typescript
// In AuthService.register()
const defaultPlan = await this.usageService.getDefaultPlan();
await this.userService.assignPlan(userId, defaultPlan._id, defaultPlan.slug);
```

The user's plan is included in login responses and the `/users/me` endpoint.
