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

Via Database (Postgres, table `authz.roles`; `id` is a 24-char hex ObjectId-style string and the name must be lower-case/trimmed):
```sql
INSERT INTO authz.roles (id, name, description, permissions, is_active, is_system, priority)
VALUES ('<24-hex-id>', 'content_manager', 'Manages workspaces and documents',
        ARRAY['workspaces.*', 'reports.read'], true, false, 40);
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

Stored in `authz.audit_logs` via `AUDIT_LOG_STORE` -> `PgAuditLogStore`. `actor_id` deliberately has no FK (audit history outlives users); `status` is constrained to `success`/`failure`; indexes cover `created_at`, `(actor_id, created_at)`, `(action, created_at)`, `(target_type, target_id, created_at)`, `status` and a trigram GIN index on `actor_email` for search. Roles live in `authz.roles` (`ROLE_STORE` -> `PgRoleStore`, unique on lower-case `name`); user-to-role assignments are the junction table `identity.user_roles` (FKs to users and roles, `ON DELETE CASCADE`, `position` preserves role order).

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
  createdAt: Date,         // created_at, indexed; rows older than 730 days are swept by PgTtlSweeper
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

### Option 1: psql

Roles are in `authz.roles`; assignments are rows of the junction table `identity.user_roles`; `permissions_version` is a column on `identity.users`.

```sql
BEGIN;

-- Assign super_admin to the user by email (position keeps role order)
INSERT INTO identity.user_roles (user_id, role_id, position)
SELECT u.id, r.id, COALESCE((SELECT MAX(position) + 1 FROM identity.user_roles WHERE user_id = u.id), 0)
FROM identity.users u, authz.roles r
WHERE u.email = 'admin@example.com' AND r.name = 'super_admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Force fresh permissions on next refresh
UPDATE identity.users SET permissions_version = permissions_version + 1 WHERE email = 'admin@example.com';

COMMIT;

-- Verify
SELECT u.email, u.permissions_version, r.name
FROM identity.users u
JOIN identity.user_roles ur ON ur.user_id = u.id
JOIN authz.roles r ON r.id = ur.role_id
WHERE u.email = 'admin@example.com';
```

### Option 2: A Postgres GUI (pgAdmin, DBeaver, ...)

1. Open `authz.roles`, find `super_admin`, copy its `id`
2. Open `identity.users`, find your admin user and copy its `id`
3. Insert a row into `identity.user_roles` (`user_id`, `role_id`)
4. Increment `permissions_version` on the user row by 1
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

Audit logs are retained for 730 days. Retention is enforced by `PgTtlSweeper`, not by a database index: `PgTtlRegistrationService` registers `authz.audit_logs.created_at` with `olderThan: '730 days'`. To change it, edit that registration in `src/modules/postgres/ttl/pg-ttl-registration.service.ts` and redeploy (no index to drop or recreate).

### Adding Permissions to Existing Roles

Via API:
```bash
PUT /api/v1/admin/roles/:id
{
  "permissions": ["existing.perm", "new.perm"]
}
```

Via Database (for system roles):
```sql
UPDATE authz.roles
SET permissions = array_append(permissions, 'new.permission'), updated_at = now()
WHERE name = 'admin' AND NOT ('new.permission' = ANY (permissions));
-- Then invalidate cache or restart application
```

### Troubleshooting

**User doesn't have expected permissions:**
1. Check user has the role: `SELECT * FROM identity.user_roles WHERE user_id = '<userId>'`
2. Check role has the permission: `SELECT permissions FROM authz.roles WHERE id = '<roleId>'`
3. Check role is active: `is_active = true`
4. Have user log out and back in (refreshes JWT)

**Permission check always fails:**
1. Verify `@UseGuards(PermissionsGuard)` is present
2. Check permission string matches exactly (case-sensitive)
3. Ensure user is authenticated (JwtAuthGuard runs first)

**Audit logs not appearing:**
1. Check the Postgres connection
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

## Role cache (plan 1A.15)

The in-process role cache (permissions + names per role id) refreshes on a 5-minute TTL and on local invalidation. Cross-instance invalidation remains TTL-bound: a role change on instance A is visible on instance B within the TTL at most. This is unchanged from the previous MongoDB implementation.
