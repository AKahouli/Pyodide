# Logger Module

A production-grade, global logging module with MongoDB persistence, buffered writes, and request tracking.

## Features

- **Global Module** - Inject anywhere without importing in each module
- **Structured Output** - JSON in production, colored pretty-print in development
- **Log Levels** - ERROR, WARN, INFO, DEBUG, VERBOSE
- **Sensitive Data Redaction** - Automatically redacts passwords, tokens, secrets
- **Context Support** - Track which service/class is logging
- **MongoDB Persistence** - Logs are saved to a separate MongoDB connection
- **Buffered Writes** - Non-blocking, fire-and-forget log persistence
- **Request Tracking** - Track all logs for a specific HTTP request via `requestId`
- **Display/Save Control** - Skip console output or database persistence per log
- **Display-Only Contexts** - Startup/runtime logs are display-only by default (not saved to DB)
- **Query API** - Search and filter logs from both buffer and database
- **Graceful Shutdown** - Flushes pending logs before application exit
- **TTL Auto-Cleanup** - Old logs automatically deleted after configured days

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum log level (error, warn, info, debug, verbose) |
| `LOGGING_MONGODB_URI` | `MONGODB_URI` | Separate MongoDB URI for logging (falls back to main DB) |
| `LOGGING_BUFFER_SIZE` | `100` | Max logs in buffer before auto-flush |
| `LOGGING_FLUSH_INTERVAL_MS` | `5000` | Flush interval in milliseconds |
| `LOGGING_TTL_DAYS` | `30` | Days to retain logs before auto-deletion |
| `LOGGING_PERSISTENCE_ENABLED` | `true` | Enable/disable database persistence |
| `LOGGING_DEFAULT_SAVE` | `true` | Default value for `save` option |
| `LOGGING_DEFAULT_DISPLAY` | `true` | Default value for `display` option |
| `LOGGING_MAX_POOL_SIZE` | `3` | Max MongoDB connections for logging |
| `LOGGING_DISPLAY_ONLY_CONTEXTS` | *(see below)* | Comma-separated contexts that are display-only |

### Display-Only Contexts

By default, the following contexts are **display-only** (shown in console but not saved to database). These are typically startup/bootstrap logs that don't need persistence:

- `NestFactory`
- `InstanceLoader`
- `RoutesResolver`
- `RouterExplorer`
- `NestApplication`
- `Bootstrap`
- `DatabaseModule`
- `LoggerModule`
- `ConfigModule`

To customize, set `LOGGING_DISPLAY_ONLY_CONTEXTS` with a comma-separated list:

```env
LOGGING_DISPLAY_ONLY_CONTEXTS=NestFactory,Bootstrap,MyCustomStartupService
```

### Example `.env`

```env
LOG_LEVEL=info
LOGGING_MONGODB_URI=mongodb://localhost:27017/yellostorm_logs
LOGGING_BUFFER_SIZE=100
LOGGING_FLUSH_INTERVAL_MS=5000
LOGGING_TTL_DAYS=30
```

## Basic Usage

```typescript
import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(MyService.name);
  }

  doSomething() {
    this.logger.log('Operation started');
    this.logger.debug('Debug details', { userId: '123' });
    this.logger.warn('Something unusual happened');
    this.logger.error('Operation failed', { error: 'details' });
  }
}
```

## Advanced Usage

### Request ID Tracking

Track all logs from a specific HTTP request:

```typescript
@Injectable()
export class MyService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(MyService.name);
  }

  handleRequest(requestId: string) {
    // All these logs can be queried by requestId
    this.logger.log('Request received', { requestId });
    this.logger.log('Processing started', { requestId });
    this.logger.log('Request completed', { requestId });
  }
}
```

### Display and Save Options

Control whether logs appear in console or are saved to database:

```typescript
// Skip console output (e.g., for sensitive data that should only be in DB)
this.logger.log('Sensitive operation', { userId }, { display: false });

// Skip database persistence (e.g., for high-volume debug logs)
this.logger.debug('High frequency event', { data }, { save: false });

// Skip both (effectively disables the log)
this.logger.verbose('Internal state', { state }, { display: false, save: false });

// Combine with requestId
this.logger.log('User action', { action }, { requestId: 'req-123', display: true, save: true });
```

### Log Options Interface

```typescript
interface LogOptions {
  display?: boolean;   // Control console output (default: true)
  save?: boolean;      // Control database persistence (default: true)
  requestId?: string;  // Request ID for tracking
}
```

## Querying Logs

The `LogBufferService` provides methods to query logs from both the in-memory buffer and database.

### Basic Query

```typescript
import { LogBufferService, LogLevelEnum } from '@modules/logger';

@Injectable()
export class AdminService {
  constructor(private readonly logBuffer: LogBufferService) {}

  async getLogs() {
    const result = await this.logBuffer.findLogs({
      page: 1,
      limit: 50,
      sort: 'desc',
    });

    return result;
    // { data: LogEntry[], pagination: { page, limit, total, totalPages, hasNext, hasPrev } }
  }
}
```

### Filter Options

```typescript
await this.logBuffer.findLogs({
  // Log level filter (single or multiple)
  level: LogLevelEnum.ERROR,
  level: [LogLevelEnum.ERROR, LogLevelEnum.WARN],

  // Context filter (exact match or wildcard)
  context: 'AuthService',        // Exact match
  context: 'Auth*',              // Wildcard pattern
  context: '^Auth',              // Starts with

  // Message search (case-insensitive)
  message: 'failed',

  // Date range
  from: '2024-01-01',
  to: new Date(),

  // Request tracking
  requestId: 'req-abc-123',
  traceId: 'trace-xyz',

  // Environment filters
  hostname: 'server-1',
  nodeEnv: 'production',

  // Pagination
  page: 1,
  limit: 50,                     // Max 1000
  sort: 'desc',                  // 'asc' or 'desc'
});
```

### Query by Request ID

Track all logs from a specific HTTP request:

```typescript
const requestLogs = await this.logBuffer.findLogs({
  requestId: 'req-abc-123',
  sort: 'asc',  // Chronological order
});
```

### Get Single Log by ID

```typescript
const log = await this.logBuffer.findLogById('65a1b2c3d4e5f6g7h8i9j0k1');
```

### Get Distinct Values

Useful for building filter dropdowns:

```typescript
const contexts = await this.logBuffer.getDistinctValues('context');
// ['AuthService', 'UserService', 'PaymentService', ...]

const levels = await this.logBuffer.getDistinctValues('level');
// ['ERROR', 'WARN', 'INFO', 'DEBUG', 'VERBOSE']

const hostnames = await this.logBuffer.getDistinctValues('hostname');
const environments = await this.logBuffer.getDistinctValues('nodeEnv');
```

### Get Counts by Level

```typescript
const counts = await this.logBuffer.getCountsByLevel();
// { ERROR: 42, WARN: 156, INFO: 1234, DEBUG: 567, VERBOSE: 89 }

// With filters
const errorCounts = await this.logBuffer.getCountsByLevel({
  from: '2024-01-01',
  context: 'AuthService',
});
```

### Check Buffer Size

```typescript
const unflushedCount = this.logBuffer.getBufferSize();
// Number of logs in memory not yet persisted
```

## Log Entry Structure

```typescript
interface LogEntry {
  _id?: string;           // MongoDB ID (only for persisted logs)
  timestamp: string;      // ISO 8601 timestamp
  level: string;          // ERROR, WARN, INFO, DEBUG, VERBOSE
  context?: string;       // Service/class name
  message: string;        // Log message
  data?: Record<string, unknown>;  // Additional data
  traceId?: string;       // Distributed tracing ID
  requestId?: string;     // HTTP request tracking ID
  hostname?: string;      // Server hostname
  nodeEnv?: string;       // Environment (development, production, test)
  createdAt?: Date;       // MongoDB timestamp (only for persisted logs)
  _fromBuffer?: boolean;  // true if from memory buffer, false if from DB
}
```

## Output Examples

### Development (Pretty Print)

```
2024-01-14T12:00:00.000Z INFO    [MyService] Operation started
2024-01-14T12:00:00.001Z DEBUG   {req-123} [MyService] Debug details {"userId":"123"}
2024-01-14T12:00:00.002Z ERROR   {req-123} [MyService] Operation failed {"error":"details"}
```

### Production (JSON)

```json
{"timestamp":"2024-01-14T12:00:00.000Z","level":"INFO","context":"MyService","message":"Operation started"}
{"timestamp":"2024-01-14T12:00:00.001Z","level":"DEBUG","context":"MyService","message":"Debug details","data":{"userId":"123"},"requestId":"req-123"}
```

## Security

The logger automatically redacts sensitive fields:
- password, token, secret, authorization, apikey, api_key

```typescript
this.logger.log('User login', { email: 'user@example.com', password: 'secret123' });
// Output: {"email":"user@example.com","password":"[REDACTED]"}
```

## Architecture

```
┌─────────────────┐     ┌────────────────┐     ┌─────────────────┐
│  LoggerService  │────>│ LogBufferService│────>│ MongoDB (logs)  │
│                 │     │                │     │ Separate conn   │
│  - log()        │     │ - buffer[]     │     │                 │
│  - error()      │     │ - add()        │     │ - logs collection│
│  - warn()       │     │ - flush()      │     │ - TTL index     │
│  - debug()      │     │ - findLogs()   │     │ - requestId idx │
│  - verbose()    │     │                │     │                 │
└────────┬────────┘     │ Interval: 5s   │     └─────────────────┘
         │              │ Max: 100 logs  │
         │              └────────────────┘
         ▼
┌─────────────────┐
│     Console     │
│  (if display)   │
└─────────────────┘
```

## Exports

```typescript
// Main exports
export { LoggerModule } from './logger.module';
export { LoggerService, LogLevel } from './logger.service';
export { LogBufferService, LogEntry } from './log-buffer.service';

// Types
export type { LogOptions } from './interfaces/log-options.interface';
export type {
  LogQueryFilters,
  LogQueryOptions,
  LogQueryPagination,
  LogQueryResult,
} from './interfaces/log-query.interface';

// Enums
export { LogLevelEnum } from './schemas/log.schema';
```

## Best Practices

1. **Use Request IDs** - Generate a unique ID per HTTP request and pass it to all logs
2. **Set Context** - Always call `setContext()` in constructors for better log organization
3. **Use Appropriate Levels** - ERROR for failures, WARN for recoverable issues, INFO for key events, DEBUG for troubleshooting
4. **Skip High-Volume Logs** - Use `{ save: false }` for frequent debug logs to reduce DB load
5. **Don't Log Sensitive Data** - Even with redaction, avoid logging PII when possible
6. **Query by Request ID** - When debugging issues, find all logs for a specific request
