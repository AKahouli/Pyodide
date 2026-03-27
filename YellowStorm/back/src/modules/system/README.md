# System Module

The system module provides system-wide configuration and maintenance mode control, allowing administrators to put the application into maintenance mode while keeping critical endpoints accessible.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Data Model](#data-model)
- [Maintenance Mode](#maintenance-mode)
- [Global Guard](#global-guard)
- [API Endpoints](#api-endpoints)
- [Caching Strategy](#caching-strategy)
- [Usage](#usage)
- [Error Handling](#error-handling)

---

## Overview

The system module provides:

- **Maintenance Mode**: Enable/disable maintenance with custom messages and estimated end times
- **Global Guard**: Automatically blocks requests during maintenance (with bypass options)
- **Path Whitelisting**: Certain paths always bypass maintenance (health checks, status endpoints)
- **Decorator-Based Bypass**: Mark specific endpoints to skip maintenance checks
- **Cached Status**: In-memory caching for high-performance status checks
- **Audit Logging**: All maintenance changes are logged for accountability

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SYSTEM MODULE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Incoming Request                                                            │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     MaintenanceGuard (Global)                         │   │
│  │                                                                       │   │
│  │  1. OPTIONS request? ──► Allow                                        │   │
│  │  2. @SkipMaintenance? ──► Allow                                       │   │
│  │  3. Whitelisted path? ──► Allow                                       │   │
│  │  4. Maintenance enabled?                                             │   │
│  │     ├── User has system.skip_maintenance? ──► Allow                  │   │
│  │     └── Otherwise ──► Throw MaintenanceException (503)              │   │
│  │  5. Otherwise ──► Allow                                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────────┐         ┌──────────────────────────┐                  │
│  │ SystemController │ ◄─────► │     SystemService        │                  │
│  │                  │         │                          │                  │
│  │ GET  /maintenance│         │ - getMaintenanceStatus() │                  │
│  │ POST /maintenance│         │ - setMaintenanceMode()   │                  │
│  └──────────────────┘         │ - isMaintenanceEnabled() │                  │
│                               └────────────┬─────────────┘                  │
│                                            │                                 │
│                               ┌────────────┴─────────────┐                  │
│                               │                          │                  │
│                               ▼                          ▼                  │
│                    ┌──────────────────┐      ┌───────────────────┐         │
│                    │   In-Memory      │      │     MongoDB       │         │
│                    │     Cache        │      │ system_settings   │         │
│                    │  (5s TTL)        │      │                   │         │
│                    └──────────────────┘      └───────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **NestJS** | Module framework with global guard registration |
| **Mongoose** | MongoDB ODM for settings persistence |
| **Reflector** | Read decorator metadata for bypass decisions |
| **AuthorizationModule** | Permission-based access control |

---

## Directory Structure

```
system/
├── index.ts                          # Module exports
├── system.module.ts                  # NestJS module (Global)
├── system.controller.ts              # API endpoints
├── system.service.ts                 # Business logic with caching
├── guards/
│   └── maintenance.guard.ts          # Global maintenance guard
├── decorators/
│   └── skip-maintenance.decorator.ts # Bypass decorator
├── schemas/
│   └── system-setting.schema.ts      # MongoDB schema
├── interfaces/
│   └── maintenance.interface.ts      # TypeScript interfaces
├── dto/
│   └── set-maintenance.dto.ts        # Validation DTO
└── exceptions/
    └── maintenance.exception.ts      # Custom 503 exception
```

---

## Data Model

### SystemSetting Schema

A generic key-value store for system-wide settings:

```typescript
@Schema({ timestamps: true, collection: 'system_settings' })
export class SystemSetting {
  @Prop({ required: true, unique: true, index: true })
  key: string;                    // e.g., "maintenance_mode"

  @Prop({ type: Object, required: true })
  value: MaintenanceValue | Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}
```

### MaintenanceValue Schema

The value structure for the `maintenance_mode` key:

```typescript
@Schema({ _id: false })
export class MaintenanceValue {
  @Prop({ required: true, default: false })
  enabled: boolean;               // Whether maintenance is active

  @Prop({ required: true, default: 'System is under maintenance...' })
  message: string;                // User-facing message

  @Prop()
  startedAt?: Date;               // When maintenance began

  @Prop()
  startedBy?: string;             // User ID who enabled it

  @Prop()
  estimatedEndAt?: Date;          // Expected end time
}
```

### Interfaces

```typescript
// Status returned by API
interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  startedAt?: Date;
  startedBy?: string;
  estimatedEndAt?: Date;
}

// Error response format
interface MaintenanceResponse {
  statusCode: 503;
  error: 'Service Unavailable';
  code: 'MAINTENANCE_MODE';
  maintenance: MaintenanceStatus;
}
```

---

## Maintenance Mode

### Enabling Maintenance

When maintenance is enabled:

1. Admin calls `POST /experimental/system/maintenance` with `enabled: true`
2. Service stores the setting in MongoDB
3. Cache is immediately updated
4. All subsequent requests (except bypassed) receive 503

### Maintenance Status Fields

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether maintenance is active |
| `message` | string | Custom message for users (max 500 chars) |
| `startedAt` | Date | Timestamp when maintenance began |
| `startedBy` | string | User ID of admin who enabled it |
| `estimatedEndAt` | Date | Optional ETA for maintenance end |

### Frontend Handling

When the frontend receives a 503 with `code: 'MAINTENANCE_MODE'`, it should:

1. Redirect to `/maintenance` page
2. Display the `message` from the response
3. Show `estimatedEndAt` if provided
4. Poll `/experimental/system/maintenance` to detect when maintenance ends

---

## Global Guard

### MaintenanceGuard

Registered as a global guard via `APP_GUARD`:

```typescript
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
  ],
})
export class SystemModule {}
```

### Bypass Logic

The guard allows requests through in this order:

```
1. OPTIONS requests (CORS preflight)
       │
       ▼ (not OPTIONS)
2. @SkipMaintenance() decorator present?
       │
       ▼ (no decorator)
3. Path matches whitelist pattern?
       │
       ▼ (not whitelisted)
4. Maintenance enabled?
       │
       ├── YES ──► User has system.skip_maintenance? ──► Allow
       │           Otherwise ──► Throw MaintenanceException (503)
       │
       └── NO ──► Allow request
```

### Whitelisted Paths

These paths always bypass maintenance (regex patterns):

| Pattern | Matches |
|---------|---------|
| `/^\/api\/v\d+\/health/` | `/api/v1/health`, `/api/v2/health/live`, etc. |
| `/^\/api\/v\d+\/system\/maintenance/` | Maintenance status endpoint |

### @SkipMaintenance Decorator

Mark endpoints that should bypass maintenance:

```typescript
@Controller('admin')
export class AdminController {
  @Get('dashboard')
  @SkipMaintenance()  // Admin dashboard accessible during maintenance
  getDashboard() { ... }
}
```

Can be applied to:
- Individual route handlers
- Entire controllers (applies to all routes)

---

## API Endpoints

### GET /experimental/system/maintenance

Get current maintenance status. **Always accessible** (public, skips auth, skips rate limiting).

**Decorators:**
- `@Public()` - No authentication required
- `@SkipMaintenance()` - Bypasses maintenance check
- `@RateLimitSkip()` - No rate limiting

**Response:**
```json
{
  "enabled": false,
  "message": "",
  "startedAt": null,
  "startedBy": null,
  "estimatedEndAt": null
}
```

### POST /experimental/system/maintenance

Set maintenance mode. **Requires `SYSTEM_MAINTENANCE` permission**.

**Decorators:**
- `@UseGuards(PermissionsGuard)`
- `@RequirePermissions(Permissions.SYSTEM_MAINTENANCE)`
- `@SkipMaintenance()` - Admin can disable maintenance during maintenance

**Request Body:**
```json
{
  "enabled": true,
  "message": "We are upgrading our systems. Please check back in 30 minutes.",
  "estimatedEndAt": "2024-01-16T15:00:00Z"
}
```

**Response:**
```json
{
  "enabled": true,
  "message": "We are upgrading our systems. Please check back in 30 minutes.",
  "startedAt": "2024-01-16T14:30:00Z",
  "startedBy": "user123",
  "estimatedEndAt": "2024-01-16T15:00:00Z"
}
```

### Validation Rules

| Field | Rules |
|-------|-------|
| `enabled` | Required, boolean |
| `message` | Optional, string, max 500 characters |
| `estimatedEndAt` | Optional, ISO 8601 date string |

---

## Caching Strategy

### In-Memory Cache

The service maintains an in-memory cache for high-performance status checks:

```typescript
private maintenanceCache: MaintenanceStatus | null = null;
private lastCacheUpdate = 0;
private readonly CACHE_TTL_MS = 5000; // 5 seconds
```

### Cache Refresh

```
┌─────────────────────────────────────────────────────────────┐
│                    CACHE REFRESH FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Application Startup                                         │
│         │                                                    │
│         ▼                                                    │
│  1. Load from MongoDB ──► Initialize cache                   │
│         │                                                    │
│         ▼                                                    │
│  2. Start periodic refresh (every 5 seconds)                 │
│         │                                                    │
│         │    ┌──────────────────────────────────┐           │
│         └───►│  setInterval(refreshCache, 5000) │           │
│              └──────────────────────────────────┘           │
│                                                              │
│  On setMaintenanceMode():                                    │
│         │                                                    │
│         ▼                                                    │
│  Immediately update cache (no DB roundtrip for readers)     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Sync vs Async Access

| Method | Type | Use Case |
|--------|------|----------|
| `getMaintenanceStatus()` | async | API endpoints (can refresh cache if stale) |
| `getMaintenanceStatusSync()` | sync | Guards (returns cached value immediately) |
| `isMaintenanceEnabled()` | sync | Quick boolean check |

The guard uses sync access for performance - it returns the last known state rather than waiting for a DB query on every request.

---

## Usage

### Importing the Module

The module is `@Global()`, so `SystemService` is available everywhere without importing:

```typescript
import { SystemService } from '@modules/system';

@Injectable()
export class SomeService {
  constructor(private readonly systemService: SystemService) {}

  async doSomething() {
    if (this.systemService.isMaintenanceEnabled()) {
      // Handle maintenance case
    }
  }
}
```

### Using @SkipMaintenance Decorator

```typescript
import { SkipMaintenance } from '@modules/system';

@Controller('critical')
@SkipMaintenance()  // All routes in this controller bypass maintenance
export class CriticalController {
  @Get('status')
  getStatus() { ... }
}

// Or on individual routes:
@Controller('api')
export class ApiController {
  @Get('health')
  @SkipMaintenance()  // Only this route bypasses
  healthCheck() { ... }
}
```

### Programmatic Maintenance Control

```typescript
// Enable maintenance
await systemService.setMaintenanceMode(true, {
  message: 'Scheduled maintenance in progress',
  estimatedEndAt: new Date(Date.now() + 3600000), // 1 hour
  userId: 'admin123',
});

// Disable maintenance
await systemService.setMaintenanceMode(false);

// Check status
const status = await systemService.getMaintenanceStatus();
console.log(`Maintenance: ${status.enabled ? 'ON' : 'OFF'}`);
```

---

## Error Handling

### MaintenanceException

A custom exception that returns HTTP 503:

```typescript
export class MaintenanceException extends Error {
  public readonly statusCode = 503; // Service Unavailable
  public readonly code = 'MAINTENANCE_MODE';
  public readonly maintenance: MaintenanceStatus;
}
```

### Response Format

When maintenance is enabled, blocked requests receive:

```json
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "code": "MAINTENANCE_MODE",
  "maintenance": {
    "enabled": true,
    "message": "System is under maintenance. Please try again later.",
    "startedAt": "2024-01-16T14:30:00Z",
    "estimatedEndAt": "2024-01-16T15:00:00Z"
  }
}
```

### Audit Logging

All maintenance changes are logged:

```typescript
this.auditLogService.logSuccess({
  actorId: user._id.toString(),
  actorEmail: user.email,
  action: 'system.maintenance',
  metadata: {
    enabled: body.enabled,
    message: body.message,
    estimatedEndAt: body.estimatedEndAt,
  },
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});
```

### Graceful Degradation

If the database is unavailable during startup:

1. Cache initializes with `{ enabled: false, message: '' }`
2. Warning logged: "Failed to initialize system service"
3. Application continues running (maintenance assumed OFF)

If cache refresh fails:

1. Previous cached value is retained
2. Warning logged
3. No disruption to request handling

---

## Best Practices

### When to Use Maintenance Mode

- Database migrations requiring downtime
- Major deployments with breaking changes
- Infrastructure upgrades
- Security patches requiring service restart

### What to Keep Accessible

- Health check endpoints (for load balancer probes)
- Maintenance status endpoint (for frontend polling)
- Admin endpoints (to disable maintenance)

### Communication

- Provide clear, user-friendly messages
- Set realistic `estimatedEndAt` when possible
- Update the message if maintenance extends beyond ETA
