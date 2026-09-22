# Analytics Module

The Analytics Module provides experimental endpoints for studying user behavior from consenting users only. All data is filtered to include only users who have explicitly opted in via `consents.dataSharing: true`.

## Overview

- **Base Path**: `/api/v1/experimental/analytics`
- **Authentication**: JWT required (global guard)
- **Data Scope**: Only consenting users (`consents.dataSharing: true`)
- **Read-Only**: All endpoints are GET-only

## Module Structure

```
back/src/modules/analytics/
├── analytics.module.ts              # Module definition and imports
├── index.ts                         # Barrel exports
├── controllers/
│   ├── analytics.controller.ts      # API endpoints
│   └── index.ts
├── dto/
│   ├── analytics-query.dto.ts       # Query parameter validation
│   └── index.ts
├── interfaces/
│   ├── analytics.interface.ts       # Response type definitions
│   └── index.ts
└── services/
    ├── analytics.service.ts         # Main orchestrator service
    ├── user-analytics.service.ts    # User metrics
    ├── usage-analytics.service.ts   # Token/model usage metrics
    ├── conversation-analytics.service.ts  # Conversation & quality metrics
    └── index.ts
```

## API Endpoints

### Common Query Parameters

All endpoints accept the following optional query parameters:

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dateFrom` | ISO 8601 string | Start date filter | `2024-01-01T00:00:00Z` |
| `dateTo` | ISO 8601 string | End date filter | `2024-01-31T23:59:59Z` |
| `groupBy` | enum | Time-series grouping | `day`, `week`, `month` |

---

### 1. User Analytics

**GET** `/experimental/analytics/users`

Returns analytics about consenting users including registration trends, verification status, and profile completion rates.

**Response:**
```json
{
  "totalConsentingUsers": 1250,
  "newUsersOverTime": [
    { "date": "2024-01-01", "count": 15 },
    { "date": "2024-01-02", "count": 23 }
  ],
  "verificationStatus": {
    "verified": 1100,
    "unverified": 150
  },
  "profileCompletion": {
    "complete": 980,
    "incomplete": 270
  }
}
```

---

### 2. Usage Analytics

**GET** `/experimental/analytics/usage`

Returns token usage analytics including totals, breakdown by model, and usage trends over time.

**Response:**
```json
{
  "totalTokens": {
    "input": 5000000,
    "output": 8000000,
    "total": 13000000
  },
  "tokensByModel": [
    {
      "model": "gpt-4",
      "inputTokens": 3000000,
      "outputTokens": 5000000,
      "totalTokens": 8000000,
      "requestCount": 15000
    }
  ],
  "averageTokensPerConversation": 2500,
  "usageOverTime": [
    { "date": "2024-01-01", "count": 150000 }
  ],
  "errorRates": [
    {
      "model": "gpt-4",
      "totalRequests": 15000,
      "failedRequests": 150,
      "errorRate": 1.0
    }
  ]
}
```

**Note:** Usage logs are retained for 30 days (hourly batch cleanup in `UsageService`), so historical usage data is limited.

---

### 3. Conversation Analytics

**GET** `/experimental/analytics/conversations`

Returns conversation analytics including message counts, component distribution, and conversation duration.

**Response:**
```json
{
  "totalConversations": 5000,
  "messagesPerConversation": {
    "average": 8.5,
    "min": 1,
    "max": 150
  },
  "conversationsOverTime": [
    { "date": "2024-01-01", "count": 120 }
  ],
  "componentTypeDistribution": [
    { "type": "text", "count": 25000, "percentage": 65.5 },
    { "type": "code", "count": 8000, "percentage": 21.0 },
    { "type": "reasoning", "count": 5000, "percentage": 13.5 }
  ],
  "averageConversationDurationMs": 300000
}
```

---

### 4. Quality Analytics

**GET** `/experimental/analytics/quality`

Returns quality analytics including feedback distribution, report counts by category, and regeneration rates.

**Response:**
```json
{
  "feedbackDistribution": {
    "likes": 5000,
    "dislikes": 500,
    "none": 20000
  },
  "feedbackRate": 21.57,
  "reportsByCategory": [
    { "category": "inaccurate", "count": 50 },
    { "category": "hallucination", "count": 30 }
  ],
  "totalReports": 120,
  "regenerationRate": 5.2
}
```

---

### 5. Summary Dashboard

**GET** `/experimental/analytics/summary`

Returns an aggregated overview of all key metrics for a dashboard view.

**Response:**
```json
{
  "users": {
    "totalConsenting": 1250,
    "newThisPeriod": 150,
    "verifiedPercentage": 88.0
  },
  "usage": {
    "totalTokens": 13000000,
    "averagePerConversation": 2500,
    "topModel": "gpt-4"
  },
  "conversations": {
    "total": 5000,
    "averageMessages": 8.5,
    "newThisPeriod": 800
  },
  "quality": {
    "feedbackRate": 21.57,
    "likePercentage": 90.9,
    "totalReports": 120
  },
  "periodStart": "2024-01-01T00:00:00.000Z",
  "periodEnd": "2024-01-31T23:59:59.999Z"
}
```

---

## Architecture

### Consent Filtering

All analytics are filtered to only include data from users who have consented to data sharing:

```typescript
// In UserAnalyticsService
async getConsentingUserIds(): Promise<string[]> {
  const rows = await this.q
    .select({ id: schema.identityUsers.id })
    .from(schema.identityUsers)
    .where(sql`${schema.identityUsers.consentDataSharing} = true`);
  return rows.map((r) => r.id);
}
```

Each analytics method filters by these user IDs before aggregating data.

### Service Responsibilities

| Service | Responsibility |
|---------|----------------|
| `AnalyticsService` | Main orchestrator, coordinates other services |
| `UserAnalyticsService` | User counts, registration trends, consent management |
| `UsageAnalyticsService` | Token metrics from `conversation.usage_logs` via `USAGE_STORE` |
| `ConversationAnalyticsService` | Message/conversation metrics, quality metrics |

### Data Sources

| Metric | Table / source | Key Fields |
|--------|-----------|------------|
| User counts | `identity.users` | `consent_data_sharing`, `created_at`, `email_verified` |
| Token usage | `conversation.usage_logs` | `input_tokens`, `output_tokens`, `model_name`, `created_at` |
| Conversations | conversation store (`CONVERSATION_ANALYTICS_STORE`) | `createdBy`, `createdAt`, `messageCount` |
| Messages | conversation store | `conversationType`, `components`, `feedback`, `createdAt` |
| Reports | conversation store | `reason`, `userId`, `createdAt` |

---

## Usage Examples

### Fetch last 7 days of user analytics

```bash
curl -X GET \
  'http://localhost:3000/api/v1/experimental/analytics/users?dateFrom=2024-01-24T00:00:00Z&dateTo=2024-01-31T23:59:59Z&groupBy=day' \
  -H 'Authorization: Bearer <token>'
```

### Fetch monthly usage breakdown

```bash
curl -X GET \
  'http://localhost:3000/api/v1/experimental/analytics/usage?groupBy=month' \
  -H 'Authorization: Bearer <token>'
```

### Fetch summary dashboard for a specific period

```bash
curl -X GET \
  'http://localhost:3000/api/v1/experimental/analytics/summary?dateFrom=2024-01-01T00:00:00Z&dateTo=2024-01-31T23:59:59Z' \
  -H 'Authorization: Bearer <token>'
```

---

## File Reference

### `analytics.module.ts`

Defines the module, imports the modules that supply the Postgres-backed stores (no Mongoose models), and registers services/controllers.

```typescript
@Module({
  imports: [
    UserModule,
    LoggerModule,
    forwardRef(() => AuthorizationModule),
    UsageModule,
    ConversationPersistenceModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    UserAnalyticsService,
    UsageAnalyticsService,
    ConversationAnalyticsService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
```

### `dto/analytics-query.dto.ts`

Validates query parameters with class-validator:

```typescript
export class AnalyticsQueryDto {
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @IsEnum(GroupByPeriod)
  @IsOptional()
  groupBy?: GroupByPeriod;
}
```

### `interfaces/analytics.interface.ts`

Defines TypeScript interfaces for all response types:

- `TimeSeriesDataPoint`
- `UserAnalyticsResponse`
- `TokensByModel`
- `UsageAnalyticsResponse`
- `ComponentTypeDistribution`
- `ConversationAnalyticsResponse`
- `FeedbackDistribution`
- `ReportsByCategory`
- `QualityAnalyticsResponse`
- `SummaryAnalyticsResponse`

### `controllers/analytics.controller.ts`

Defines REST endpoints with Swagger documentation:

```typescript
@ApiTags('Analytics (Experimental)')
@ApiBearerAuth()
@Controller('experimental/analytics')
export class AnalyticsController {
  @Get('users')
  async getUserAnalytics(@Query() query: AnalyticsQueryDto) { ... }

  @Get('usage')
  async getUsageAnalytics(@Query() query: AnalyticsQueryDto) { ... }

  @Get('conversations')
  async getConversationAnalytics(@Query() query: AnalyticsQueryDto) { ... }

  @Get('quality')
  async getQualityAnalytics(@Query() query: AnalyticsQueryDto) { ... }

  @Get('summary')
  async getSummaryAnalytics(@Query() query: AnalyticsQueryDto) { ... }
}
```

### `services/analytics.service.ts`

Main orchestrator that coordinates the specialized services:

```typescript
@Injectable()
export class AnalyticsService {
  async getUserAnalytics(dateFrom?, dateTo?, groupBy?) { ... }
  async getUsageAnalytics(dateFrom?, dateTo?, groupBy?) { ... }
  async getConversationAnalytics(dateFrom?, dateTo?, groupBy?) { ... }
  async getQualityAnalytics(dateFrom?, dateTo?) { ... }
  async getSummaryAnalytics(dateFrom?, dateTo?) { ... }
}
```

### `services/user-analytics.service.ts`

Handles user-related analytics:

- `getConsentingUserIds()` - Returns IDs of users with data sharing consent
- `getUserAnalytics()` - Aggregates user metrics
- `getNewUsersOverTime()` - Time-series of new registrations
- `getVerificationStatus()` - Email verification breakdown
- `getProfileCompletion()` - Profile completion rates

### `services/usage-analytics.service.ts`

Handles token and model usage analytics:

- `getUsageAnalytics()` - Aggregates all usage metrics
- `getTotalTokens()` - Total input/output/combined tokens
- `getTokensByModel()` - Breakdown by AI model
- `getAverageTokensPerConversation()` - Per-conversation average
- `getUsageOverTime()` - Time-series of token usage
- `getErrorRates()` - Error rates per model

### `services/conversation-analytics.service.ts`

Handles conversation and quality analytics:

- `getConversationAnalytics()` - Conversation metrics
- `getQualityAnalytics()` - Feedback and report metrics
- `getMessagesPerConversation()` - Message count statistics
- `getConversationsOverTime()` - Time-series of conversations
- `getComponentTypeDistribution()` - Component type breakdown
- `getFeedbackDistribution()` - Like/dislike/none counts
- `getReportsByCategory()` - Report reasons breakdown
- `getRegenerationRate()` - Edited message percentage

---

## Notes

- Aggregations run in the database (SQL over Postgres via Drizzle for user analytics; `USAGE_STORE` and `CONVERSATION_ANALYTICS_STORE` ports for usage and conversation metrics)
- Usage logs are cleaned up after 30 days, limiting historical usage data
- No PII (Personally Identifiable Information) is exposed in responses
- The module is registered in `AppModule` and available immediately
- Endpoints are documented in Swagger under "Analytics (Experimental)" tag
