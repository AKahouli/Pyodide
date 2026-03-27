# Authorization Module (RBAC)

Role-Based Access Control system for YelloStorm. Permissions are stored in JWT tokens for zero-DB-hit authorization checks.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Permissions](#permissions)
- [Roles](#roles)
- [Protecting Endpoints](#protecting-endpoints)
- [Audit Logging](#audit-logging)
- [JWT Integration](#jwt-integration)
- [Admin API](#admin-api)
- [First Super Admin Setup](#first-super-admin-setup)
- [Maintenance](#maintenance)

---

## Quick Start

### Protect a single endpoint

```typescript
import { RequirePermissions, PermissionsGuard } from '../authorization';

@Get('admin/users')
@UseGuards(PermissionsGuard)
@RequirePermissions('users.read')
async getUsers() {
  // Only users with 'users.read' or 'users.*' or '*' can access
}
```

### Protect an entire controller

```typescript
@Controller('admin/analytics')
@UseGuards(PermissionsGuard)
@RequirePermissions('analytics.read')
export class AnalyticsController {
  // All routes require 'analytics.read' permission
}
```

### Check multiple permissions

```typescript
// All required (AND logic) - default
@RequirePermissions('plans.create', 'plans.update')

// Any required (OR logic)
@RequirePermissions(['analytics.read', 'reports.read'], 'any')
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Request Flow                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Request with JWT ──► JwtAuthGuard ──► JwtStrategy            │
│                                              │                   │
│                              Attaches permissions from JWT       │
│                              to request.user (no DB hit)         │
│                                              │                   │
│  2. ──────────────────────► PermissionsGuard                     │
│                                              │                   │
│                              Checks request.user.permissions     │
│                              against @RequirePermissions         │
│                              (no DB hit)                         │
│                                              │                   │
│  3. ──────────────────────► Controller/Service                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Permission Update Flow:
┌─────────────────────────────────────────────────────────────────┐
│  1. Admin assigns role to user                                   │
│  2. user.permissionsVersion incremented                          │
│  3. User continues with old access token (up to 15 min)          │
│  4. Access token expires → client refreshes                      │
│  5. Refresh endpoint fetches fresh permissions from roles        │
│  6. New access token issued with updated permissions             │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Permissions in JWT | Zero DB hits per request for authorization |
| Wildcard matching | `users.*` covers current and future `users.x` permissions |
| Role caching (5 min TTL) | Reduces DB load when generating tokens |
| Async audit logging | Never blocks main operations |
| No `isAdmin` boolean | All authorization through permissions only |
| No priority-based auth | Priority is for UI display only |

---

## Permissions

### Permission Format

Permissions use dot-notation: `namespace.action` or `namespace.subnamespace.action`

```
users.read           # Read user data
users.suspend        # Suspend users
users.*              # All user permissions (current and future)
admin.roles.manage   # Manage roles
*                    # Super admin - full access
```

### Available Permissions

| Namespace | Permissions | Description |
|-----------|-------------|-------------|
| `users` | `read`, `suspend`, `activate`, `assign_plan`, `assign_role`, `*` | User management |
| `plans` | `read_all`, `create`, `update`, `delete`, `*` | Plan management |
| `reports` | `read`, `update`, `*` | Report moderation |
| `system` | `maintenance`, `skip_maintenance`, `*` | System administration |
| `workspaces` | `admin_delete`, `manage_templates`, `*` | Workspace admin |
| `analytics` | `read`, `*` | Analytics access |
| `conversations` | `admin_delete`, `*` | Conversation admin |
| `admin` | `roles.read`, `roles.manage`, `audit.read`, `*` | Admin panel access |

### Wildcard Matching (Deep)

Wildcards match at any depth:

```typescript
hasPermission(['users.*'], 'users.read')           // ✓ true
hasPermission(['users.*'], 'users.roles.assign')   // ✓ true (deep match)
hasPermission(['users.roles.*'], 'users.roles.assign') // ✓ true
hasPermission(['users.roles.*'], 'users.read')     // ✗ false
hasPermission(['*'], 'anything.here')              // ✓ true (super admin)
```

### Adding New Permissions

1. Add to `constants/permissions.ts`:

```typescript
// In Permissions object (for autocomplete)
export const Permissions = {
  // ...existing
  BILLING_READ: 'billing.read',
  BILLING_MANAGE: 'billing.manage',
  BILLING_ALL: 'billing.*',
};

// In ALL_PERMISSIONS set (source of truth)
const ALL_PERMISSIONS = new Set<string>([
  // ...existing
  'billing.read',
  'billing.manage',
  'billing.*',
]);
```

2. Use in controllers:

```typescript
@RequirePermissions(Permissions.BILLING_READ)
```

3. Assign to roles via admin API or database.

---

## Roles

### Default Roles (Seeded on Startup)

| Role | Priority | Permissions | Use Case |
|------|----------|-------------|----------|
| `user` | 0 | `[]` | Regular users, no admin access |
| `tester` | 10 | `analytics.read` | QA team, view-only analytics |
| `dev` | 20 | `analytics.read`, `system.maintenance` | Developers |
| `moderator` | 50 | `reports.*`, `conversations.admin_delete` | Content moderation |
| `admin` | 90 | Full admin except role management | General administrators |
| `super_admin` | 100 | `*` | Full system access |

**Note:** Priority is for UI display ordering only. It has NO effect on authorization.

### Role Properties

```typescript
interface Role {
  name: string;          // Unique, lowercase (e.g., 'content_manager')
  description: string;   // Human-readable description
  permissions: string[]; // Array of permission strings
  isActive: boolean;     // Inactive roles are ignored
  isSystem: boolean;     // System roles cannot be modified/deleted
  priority: number;      // Display ordering (higher = more privileged)
}
```

### Creating Custom Roles

Via API:
```bash
POST /api/v1/admin/roles
Authorization: Bearer <token-with-admin.roles.manage>

{
  "name": "content_manager",
  "description": "Manages workspaces and documents",
  "permissions": ["workspaces.*", "reports.read"],
  "priority": 40
}
```

Via Database:
```javascript
db.roles.insertOne({
  name: 'content_manager',
  description: 'Manages workspaces and documents',
  permissions: ['workspaces.*', 'reports.read'],
  isActive: true,
  isSystem: false,
  priority: 40
});
```

---

## Protecting Endpoints

### Basic Usage

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequirePermissions, PermissionsGuard, Permissions } from '../authorization';

@Controller('admin')
export class AdminController {

  // Single permission
  @Get('users')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.USERS_READ)
  async getUsers() { }

  // Multiple permissions (ALL required)
  @Post('users/:id/plan')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.USERS_READ, Permissions.USERS_ASSIGN_PLAN)
  async assignPlan() { }

  // Multiple permissions (ANY required)
  @Get('dashboard')
  @UseGuards(PermissionsGuard)
  @RequirePermissions([Permissions.ANALYTICS_READ, Permissions.REPORTS_READ], 'any')
  async getDashboard() { }
}
```

### Controller-Level Protection

```typescript
@Controller('admin/analytics')
@UseGuards(PermissionsGuard)
@RequirePermissions(Permissions.ANALYTICS_READ)
export class AnalyticsController {
  // All routes in this controller require 'analytics.read'

  @Get('users')
  async getUserAnalytics() { }

  @Get('usage')
  async getUsageAnalytics() { }
}
```

### Combining with Other Guards

```typescript
@Get('workspace/:id/documents')
@UseGuards(PermissionsGuard, WorkspaceOwnerGuard)
@RequirePermissions(Permissions.WORKSPACES_ADMIN_DELETE)
async deleteWorkspaceDocuments() {
  // Requires permission AND ownership
}
```

---

## Audit Logging

### Automatic Logging

The `AuditLogService` provides fire-and-forget logging that never blocks operations:

```typescript
import { AuditLogService } from '../authorization';

@Injectable()
export class UserService {
  constructor(private readonly auditLogService: AuditLogService) {}

  async suspendUser(userId: string, actor: UserDocument, req: Request) {
    await this.userModel.updateOne({ _id: userId }, { status: 'suspended' });

    // Fire and forget - doesn't block or throw
    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'users.suspend',
      targetId: userId,
      targetType: 'User',
      metadata: { reason: 'Policy violation' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
```

### Logging Failures

```typescript
try {
  await this.dangerousOperation();
  this.auditLogService.logSuccess({ /* ... */ });
} catch (error) {
  this.auditLogService.logFailure({
    actorId: user._id.toString(),
    actorEmail: user.email,
    action: 'system.dangerous_operation',
    status: 'failure',
    failureReason: error.message,
  });
  throw error;
}
```

### Audit Log Schema

```typescript
{
  actorId: ObjectId,       // Who performed the action
  actorEmail: string,      // For display without joins
  action: string,          // Permission-style string
  targetId?: ObjectId,     // What was affected
  targetType?: string,     // 'User', 'Role', 'Workspace', etc.
  metadata?: object,       // Additional context
  ipAddress?: string,
  userAgent?: string,
  status: 'success' | 'failure',
  failureReason?: string,
  createdAt: Date,         // Auto-indexed, TTL: 2 years
}
```

### Querying Audit Logs

```bash
GET /api/v1/admin/audit-logs?actorId=xxx&action=users.suspend&limit=50
Authorization: Bearer <token-with-admin.audit.read>
```

---

## JWT Integration

### Token Structure

Access tokens include:

```typescript
{
  sub: string,              // User ID
  email: string,
  type: 'access',
  sessionId: string,
  permissions: string[],    // Flattened from all roles
  roleNames: string[],      // For display: ['admin', 'moderator']
  permissionsVersion: number, // Incremented when roles change
  iat: number,
  exp: number,
}
```

### Permission Propagation

When a user's roles change:

1. `user.permissionsVersion` is incremented
2. Existing access tokens continue working (up to 15 min TTL)
3. On token refresh, new permissions are fetched and included
4. New access token has updated permissions

This means:
- **Best case:** New permissions take effect on next refresh (~immediately if token is expiring)
- **Worst case:** Up to access token TTL (default 15 min) delay

### Force Immediate Update

To force immediate permission update, invalidate all user sessions:

```typescript
await this.authService.invalidateAllUserSessions(userId);
// User must re-login, getting fresh permissions
```

---

## Admin API

### Role Endpoints

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/admin/roles` | `admin.roles.read` | List all roles |
| `GET` | `/admin/roles/active` | `admin.roles.read` | List active roles |
| `GET` | `/admin/roles/:id` | `admin.roles.read` | Get role by ID |
| `POST` | `/admin/roles` | `admin.roles.manage` | Create role |
| `PUT` | `/admin/roles/:id` | `admin.roles.manage` | Update role |
| `DELETE` | `/admin/roles/:id` | `admin.roles.manage` | Delete role |
| `POST` | `/admin/roles/assign` | `users.assign_role` | Assign role to user |
| `POST` | `/admin/roles/unassign` | `users.assign_role` | Remove role from user |
| `GET` | `/admin/roles/user/:userId` | `users.read` or `admin.roles.read` | Get user's roles |

### Audit Log Endpoints

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/admin/audit-logs` | `admin.audit.read` | Query audit logs |

Query parameters: `actorId`, `action`, `targetType`, `status`, `startDate`, `endDate`, `limit`, `skip`

---

## First Super Admin Setup

After initial deployment, assign super_admin to your first admin user:

### Option 1: MongoDB Shell

```javascript
// Connect to your MongoDB instance
use yellostorm;

// Find the super_admin role
const role = db.roles.findOne({ name: 'super_admin' });

// Assign to user by email
db.users.updateOne(
  { email: 'admin@example.com' },
  {
    $addToSet: { roles: role._id },
    $inc: { permissionsVersion: 1 }
  }
);

// Verify
db.users.findOne({ email: 'admin@example.com' }, { roles: 1, permissionsVersion: 1 });
```

### Option 2: MongoDB Compass

1. Open `roles` collection, find `super_admin`, copy its `_id`
2. Open `users` collection, find your admin user
3. Add the role `_id` to the `roles` array
4. Increment `permissionsVersion` by 1
5. Save

### After Assignment

The user must **log out and log back in** to receive the new permissions in their JWT.

---

## Maintenance

### Role Cache

Roles are cached in memory for 5 minutes. The cache is automatically invalidated when:
- A role is created, updated, or deleted via the API
- The application restarts

To manually invalidate (e.g., after direct DB changes):

```typescript
// In a service or controller
this.authorizationService.invalidateCache();
```

### Audit Log Retention

Audit logs have a 2-year TTL (MongoDB TTL index). To change:

```typescript
// In audit-log.schema.ts
AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 } // 1 year
);
```

After changing, drop and recreate the index:

```javascript
db.audit_logs.dropIndex("createdAt_1");
// Restart application to recreate with new TTL
```

### Adding Permissions to Existing Roles

Via API:
```bash
PUT /api/v1/admin/roles/:id
{
  "permissions": ["existing.perm", "new.perm"]
}
```

Via Database (for system roles):
```javascript
db.roles.updateOne(
  { name: 'admin' },
  { $addToSet: { permissions: 'new.permission' } }
);
// Then invalidate cache or restart application
```

### Troubleshooting

**User doesn't have expected permissions:**
1. Check user has the role: `db.users.findOne({ _id: userId }, { roles: 1 })`
2. Check role has the permission: `db.roles.findOne({ _id: roleId })`
3. Check role is active: `isActive: true`
4. Have user log out and back in (refreshes JWT)

**Permission check always fails:**
1. Verify `@UseGuards(PermissionsGuard)` is present
2. Check permission string matches exactly (case-sensitive)
3. Ensure user is authenticated (JwtAuthGuard runs first)

**Audit logs not appearing:**
1. Check MongoDB connection
2. Verify `AuditLogService` is injected
3. Check application logs for "Failed to write audit log" errors

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| `ERR_2100` | `ROLE_NOT_FOUND` | Role doesn't exist |
| `ERR_2101` | `ROLE_ALREADY_EXISTS` | Role name taken |
| `ERR_2102` | `ROLE_SYSTEM_PROTECTED` | Cannot modify system role |
| `ERR_2103` | `PERMISSION_DENIED` | User lacks required permission |
| `ERR_2104` | `INVALID_PERMISSION` | Permission string not recognized |
