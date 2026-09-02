# Admin Module

The Admin module provides administrative functionality for managing users, roles, plans, system settings, and viewing analytics/audit logs.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Permissions System](#permissions-system)
- [Module Structure](#module-structure)
- [Adding New Admin Pages](#adding-new-admin-pages)
- [API Integration](#api-integration)
- [Audit Logging](#audit-logging)
- [System Logs](#system-logs)
- [Components Reference](#components-reference)
- [Appearance](#appearance)
- [Connectors](#connectors)
- [Testing](#testing)
- [Best Practices](#best-practices)

---

## Overview

The admin module is a permission-gated section of the application that allows authorized users to:

- **Users**: View, suspend/activate users, assign plans and roles
- **Roles**: Create, update, delete roles and manage permissions
- **Plans**: Create and manage subscription plans
- **Analytics**: View user, usage, conversation, and quality metrics
- **Audit Logs**: Track all admin actions for compliance
- **System Logs**: View application logs in real-time for debugging
- **System**: Toggle maintenance mode
- **Appearance**: Apply a global color palette and manage the sidebar logo library
- **Connectors**: Manage MCP server integrations with OAuth 2.0 authentication
- **Tools**: Manage tool definitions and attributes
- **Skills**: Manage skill definitions and imports

Access is controlled by the RBAC (Role-Based Access Control) system defined in the backend.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
├─────────────────────────────────────────────────────────────┤
│  AdminGuard          │  Checks if user has admin access     │
│  AdminLayout         │  Sidebar + content layout            │
│  AdminButton         │  Entry point in main app sidebar     │
│  Pages (Users, etc.) │  Individual admin features           │
├─────────────────────────────────────────────────────────────┤
│                        API Layer                             │
├─────────────────────────────────────────────────────────────┤
│  api.ts              │  All admin API functions             │
│  types.ts            │  TypeScript interfaces               │
├─────────────────────────────────────────────────────────────┤
│                        Backend                               │
├─────────────────────────────────────────────────────────────┤
│  Controllers         │  /admin/* endpoints                  │
│  PermissionsGuard    │  Validates user permissions          │
│  AuditLogService     │  Logs all admin actions              │
└─────────────────────────────────────────────────────────────┘
```

---

## Permissions System

### How Permissions Work

1. **Backend**: Each admin endpoint is protected by `@RequirePermissions(Permissions.SOME_PERMISSION)`
2. **Frontend**: The `usePermissions()` hook provides permission checking
3. **Menu Items**: Each menu item in `constants.ts` specifies required permissions

### Permission Format

Permissions follow a namespace pattern: `namespace.action`

```
users.read          - Read user data
users.suspend       - Suspend user accounts
users.activate      - Activate user accounts
users.assign_plan   - Assign plans to users
users.assign_role   - Assign roles to users

admin.roles.read    - View roles
admin.roles.manage  - Create/update/delete roles

plans.read_all      - View all plans (including inactive)
plans.create        - Create new plans
plans.update        - Update existing plans
plans.delete        - Delete plans

admin.audit.read    - View audit logs
admin.logs.read     - View system application logs

system.maintenance  - Toggle maintenance mode

analytics.*         - Various analytics permissions

connectors.read     - Read connectors
connectors.create   - Create new connectors
connectors.update   - Update existing connectors
connectors.delete   - Delete connectors

tools.read          - Read tools
tools.create        - Create new tools
tools.update        - Update existing tools
tools.delete        - Delete tools

skills.read         - Read skills
skills.create       - Create new skills
skills.update       - Update existing skills
skills.delete       - Delete skills
```

### Checking Permissions in Components

```tsx
import { usePermissions } from '../hooks';

function MyComponent() {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();

  // Single permission
  if (hasPermission('users.suspend')) {
    // Show suspend button
  }

  // Any of multiple permissions
  if (hasAnyPermission(['users.read', 'admin.roles.read'])) {
    // Show if user has either permission
  }

  // All permissions required
  if (hasAllPermissions(['users.read', 'users.suspend'])) {
    // Show only if user has both
  }
}
```

### Admin Access Check

```tsx
import { useAdminAccess } from '../hooks';

function SomeComponent() {
  const { hasAdminAccess, isLoading } = useAdminAccess();

  if (!hasAdminAccess) {
    return null; // Hide admin button entirely
  }
}
```

---

## Module Structure

```
front/src/modules/admin/
├── index.ts              # Public exports
├── api.ts                # API functions
├── types.ts              # TypeScript types + PERMISSION_GROUPS
├── constants.ts          # Menu items, access permissions
├── hooks.ts              # usePermissions, useAdminAccess
├── README.md             # This file
│
├── components/
│   ├── index.ts          # Component exports
│   ├── AdminGuard.tsx    # Route protection
│   ├── AdminLayout.tsx   # Layout with sidebar
│   ├── AdminSidebar.tsx  # Navigation sidebar
│   ├── AdminButton.tsx   # Entry button for main sidebar
│   └── AdminDashboard.tsx # Dashboard overview
│
├── appearance/
│   ├── ColorThemeCard.tsx
│   ├── LogoLibrarySection.tsx
│   ├── LogoMark.tsx
│   ├── LogoUploadDialog.tsx
│   ├── constants/
│   └── utils/
│
└── pages/
    ├── index.ts          # Page exports
    ├── UsersPage.tsx     # User management
    ├── RolesPage.tsx     # Role management
    ├── PlansPage.tsx     # Plan management
    ├── AnalyticsPage.tsx # Analytics dashboard
    ├── AuditLogsPage.tsx # Audit log viewer
    ├── LogsPage.tsx      # System logs viewer
    ├── SystemPage.tsx    # System settings
    ├── AppearancePage.tsx # Global color palette + logo library
    │
    ├── tools/
    │   ├── index.ts
    │   └── README.md
    │
    └── connectors/
        ├── index.ts
        ├── ConnectorsPage.tsx          # Main connectors list page
        ├── CreateEditConnectorDialog.tsx # Connector CRUD dialog with OAuth
        ├── connector-form-schema.ts    # Connector form validation
        ├── mcp-server-config.ts        # MCP config parsing utilities
        └── README.md
```

---

### Localization Requirements

- Menu entries in `constants.ts` must declare `labelKey` and `descriptionKey` fields that point to flat keys in `src/modules/admin/locales/{lang}.json`.
- Permission groups defined in `types.ts` require translation keys as well. Add entries like `roles.permissions.groups.<namespace>` plus `roles.permissions.items.<permission>` when you introduce new permissions.
- Keep the locale files for every supported language (`en`, `fr`) in sync whenever you add or rename admin copy.
- All translation keys must remain flat (dot notation). Do not nest JSON objects when adding new admin copy.

---

## Adding New Admin Pages

### Step 1: Create the Page Component

Create a new file in `pages/`:

```tsx
// pages/MyNewPage.tsx
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMyData } from '../api';
import type { MyDataResponse } from '../types';

export function MyNewPage() {
  const [data, setData] = useState<MyDataResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await getMyData();
        setData(result);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My New Page</h1>
        <p className="text-muted-foreground">Description here</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Your content */}
        </CardContent>
      </Card>
    </div>
  );
}
```

### Step 2: Export from pages/index.ts

```tsx
export { MyNewPage } from './MyNewPage';
```

### Step 3: Add Menu Item in constants.ts

```tsx
import { MyIcon } from 'lucide-react';

export const ADMIN_MENU_ITEMS: AdminMenuItem[] = [
  // ... existing items
  {
    id: 'my-new-page',
    label: 'My New Page',
    path: '/admin/my-new-page',
    icon: MyIcon,
    permissions: ['my.permission'],  // Required permissions
    description: 'Description for the menu item',
  },
];

// Also add to ADMIN_ACCESS_PERMISSIONS if it's a new permission
export const ADMIN_ACCESS_PERMISSIONS = [
  // ... existing
  'my.permission',
];
```

### Step 4: Add Route in App.tsx

```tsx
import { MyNewPage } from '@/modules/admin';

// Inside routes
<Route path="my-new-page" element={<MyNewPage />} />
```

### Step 5: Export from index.ts

```tsx
export { MyNewPage } from './pages';
```

---

## API Integration

### Adding New API Endpoints

#### 1. Add endpoint to `lib/api/config.ts`:

```tsx
export const API_ENDPOINTS = {
  // ... existing
  myFeature: {
    base: '/admin/my-feature',
    byId: (id: string) => `/admin/my-feature/${id}`,
  },
} as const;
```

#### 2. Add types to `types.ts`:

```tsx
export interface MyDataResponse {
  id: string;
  name: string;
  // ... fields
}

export interface CreateMyDataRequest {
  name: string;
  // ... fields
}

export interface MyDataListParams {
  page?: number;
  limit?: number;
  search?: string;
}
```

#### 3. Add API functions to `api.ts`:

```tsx
import type { MyDataResponse, CreateMyDataRequest, MyDataListParams } from './types';

export async function getMyDataList(
  params: MyDataListParams = {}
): Promise<{ items: MyDataResponse[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);

  const response = await apiClient.get<ApiResponse<{ items: MyDataResponse[]; total: number }>>(
    `${API_ENDPOINTS.myFeature.base}?${searchParams}`
  );
  return response.data.data;
}

export async function createMyData(data: CreateMyDataRequest): Promise<MyDataResponse> {
  const response = await apiClient.post<ApiResponse<MyDataResponse>>(
    API_ENDPOINTS.myFeature.base,
    data
  );
  return response.data.data;
}

export async function deleteMyData(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.myFeature.byId(id));
}
```

#### 4. Export from `index.ts`:

```tsx
export type { MyDataResponse, CreateMyDataRequest, MyDataListParams } from './types';
export { getMyDataList, createMyData, deleteMyData } from './api';
```

---

## Audit Logging

All admin actions should be logged for compliance. The backend handles this automatically when you use the `AuditLogService`.

### Backend Pattern

```typescript
// In your controller
import { AuditLogService } from '../authorization';

@Controller('admin/my-feature')
export class MyFeatureController {
  constructor(
    private readonly myService: MyService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @RequirePermissions(Permissions.MY_FEATURE_CREATE)
  async create(
    @Body() dto: CreateDto,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ) {
    const result = await this.myService.create(dto);

    // Log the action
    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'myfeature.create',  // Format: feature.action
      targetId: result._id.toString(),
      targetType: 'MyFeature',
      metadata: { name: result.name },  // Relevant details
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }
}
```

### Action Naming Convention

Actions follow the pattern: `feature.action`

Examples:
- `users.suspend`
- `users.activate`
- `users.assign_plan`
- `roles.create`
- `roles.update`
- `roles.delete`
- `plans.create`
- `plans.update`
- `plans.delete`
- `system.maintenance`

### Viewing Audit Logs

The AuditLogsPage provides:
- Search by actor email
- Filter by feature (users, roles, plans, system)
- Filter by status (success/failure)
- Date range filtering
- Pagination

---

## System Logs

The LogsPage provides real-time access to application logs for debugging and monitoring. Unlike audit logs (which track admin actions), system logs capture all application events including errors, warnings, and debug information.

### Permission Required

```
admin.logs.read     - View system application logs
```

### Features

- **Live Auto-Refresh**: Toggle automatic refresh every 5 seconds to monitor logs in real-time
- **Level Counts**: Clickable badges showing counts per log level (ERROR, WARN, INFO, DEBUG, VERBOSE)
- **Filtering**:
  - By log level (ERROR, WARN, INFO, DEBUG, VERBOSE)
  - By context (module/service that generated the log)
  - By message content (text search)
  - By request ID (trace a specific request across all services)
  - By date range (from/to timestamps)
- **Expandable Rows**: Click to expand and view full log data as JSON
- **Pagination**: Navigate through large log sets

### Request ID Tracking

System logs support `requestId` correlation, allowing you to trace a single user request through the entire application:

1. Each incoming HTTP request gets a unique `requestId` from the `RequestContextService`
2. All logs generated during that request include the same `requestId`
3. In the LogsPage, filter by `requestId` to see all events for a specific request

This is useful for debugging conversation requests, where you can see:
- Request received by controller
- Message creation in service
- gRPC stream lifecycle
- Any errors that occurred

### API Endpoints

The logs viewer uses these backend endpoints:

```
GET  /admin/logs           - Query logs with filters
GET  /admin/logs/levels    - Get available log levels
GET  /admin/logs/contexts  - Get available contexts (modules)
GET  /admin/logs/counts    - Get counts per log level
```

### Usage Example

To trace a specific conversation request:

1. Find the conversation's AI message in the database
2. Get its `requestId` field
3. In LogsPage, paste the `requestId` in the filter
4. View all logs for that request in chronological order

### Backend Integration

Logs are generated using the `LoggerService` with optional `LogOptions`:

```typescript
import { LoggerService, LogOptions } from '@modules/logger';
import { RequestContextService } from '@modules/request-context';

@Injectable()
export class MyService {
  constructor(
    private readonly logger: LoggerService,
    private readonly requestContext: RequestContextService,
  ) {
    this.logger.setContext('MyService');
  }

  async doSomething() {
    const logOpts = this.requestContext.getLogOptions();

    this.logger.log('Operation started', { someData: 'value' }, logOpts);

    // ... do work ...

    this.logger.log('Operation completed', { result: 'success' }, logOpts);
  }
}
```

---

## Components Reference

### AdminGuard

Protects admin routes. Redirects to home if user lacks admin access.

```tsx
<Route element={<AdminGuard />}>
  <Route path="admin/*" element={<AdminLayout />}>
    {/* Admin routes */}
  </Route>
</Route>
```

### AdminLayout

Provides the admin page layout with sidebar navigation.

```tsx
// Automatically wraps admin pages
// Includes: AdminSidebar + Outlet for page content
```

### AdminButton

Entry point button shown in the main app sidebar.

```tsx
import { AdminButton } from '@/modules/admin';

// In your main sidebar
<AdminButton />  // Only renders if user has admin access
```

### AdminSidebar

Navigation sidebar with permission-filtered menu items.

```tsx
// Automatically included in AdminLayout
// Items filtered based on user's permissions
```

---

## Appearance

Admin Appearance (`/admin/appearance`) stores a **global color palette** and a **sidebar logo library**. Palette changes apply to every user. Selecting a logo assigns it to all four palettes immediately.

### Folder layout

Keep React components thin. Constants and helpers live next to the UI, not inside it:

```
appearance/
├── ColorThemeCard.tsx          # Palette preview card
├── LogoLibrarySection.tsx      # Builtin + custom catalog
├── LogoMark.tsx                # Builtin SVG or custom <img>
├── LogoUploadDialog.tsx        # Validate, fit, upload
├── constants/
│   ├── appearance.constants.ts # Fallback logos, default map, sync event name
│   ├── logo.constants.ts       # Slot 224×48, retina 448×96, MIME, size limits
│   └── theme-palettes.ts       # Preview swatches for ColorThemeCard
└── utils/
    ├── appearance-settings.ts  # Catalog/map helpers + `yellowstorm:appearance-updated`
    ├── logo-mime.ts            # MIME + source dimension checks
    ├── logo-file.ts            # inspectLogoFile / prepareLogoUpload
    ├── logo-fit.ts             # Canvas contain+center rasterize to PNG
    └── logo-url.ts             # Authenticated-origin URL for custom logo files
```

`AppBrandLogo` (`src/components/AppBrandLogo.tsx`) is the shared chrome: custom logos render as `<img>`, builtins go through `Icons.AppLogo`. `CombinedProvider` loads public appearance settings, applies `applyColorThemeClass`, and resolves the current logo via `resolveThemeLogo`. After a save, dispatch `yellowstorm:appearance-updated` so other tabs/windows refresh.

### Upload pipeline

1. Client checks type (png/jpeg/webp/svg), source size (8 MB), and landscape dimensions (min 80×24, aspect 1.2–10).
2. Canvas contain-fits the image into the sidebar slot and stores a PNG (448×96, falling back to 224×48 if the retina blob exceeds 512 KB).
3. `createAppearanceLogo` / `updateAppearanceLogo` send `multipart/form-data` without a forced `Content-Type` so Axios can set the boundary.
4. The API stores the PNG and returns metadata; the file is served at `GET /experimental/system/appearance/logos/:id/file`.

Built-in ids `yellowmind` and `kpmg` cannot be edited or deleted. Deleting a custom logo that is in use falls back to `yellowmind` on the server.

### API helpers (`api.ts`)

| Function | Endpoint | Notes |
|---|---|---|
| `getAppearanceSettings` | `GET /experimental/system/appearance` | Public; includes `logos` |
| `setAppearanceSettings` | `POST /experimental/system/appearance` | `SYSTEM_MAINTENANCE`; body is `defaultColorTheme` + `themes` only |
| `createAppearanceLogo` | `POST /experimental/system/appearance/logos` | Multipart `file` + optional `name` |
| `updateAppearanceLogo` | `PATCH /experimental/system/appearance/logos/:id` | Rename and/or replace file |
| `deleteAppearanceLogo` | `DELETE /experimental/system/appearance/logos/:id` | Custom logos only |

Copy lives in `locales/en.json` and `locales/fr.json` under `appearance.*`. Validation keys are `appearance.logo.validation.{type,unreadable,size,dimensions}`.

---

## Connectors

Connectors enable integration with external MCP (Model Context Protocol) servers, allowing agents to use tools from third-party services like GitHub.

### Connector Features

- **Multiple Transport Types**: Streamable HTTP, SSE, and stdio
- **OAuth 2.0 Authentication**: Secure connection using OAuth flows (GitHub support)
- **Runtime Auth Config**: Custom headers and environment variable mappings
- **MCP Inspection**: Discover and import tools from MCP servers
- **Admin OAuth**: Separate OAuth connections for admin-level access

### OAuth Connection Flow

```
1. Admin clicks "Connect to GitHub"
   ↓
2. Frontend calls authorizeConnectorAppOAuth('github')
   ↓
3. Backend returns authorization URL with PKCE parameters
   ↓
4. Frontend opens popup to GitHub authorization page
   ↓
5. User authorizes the app
   ↓
6. GitHub redirects to OAuth callback endpoint
   ↓
7. Backend exchanges code for tokens, encrypts and stores them
   ↓
8. Callback page posts message to opener window
   ↓
9. Frontend polls status and updates UI to show connected state
```

### Connector API Functions

```tsx
// Get OAuth authorization URL
const { authorizationUrl } = await authorizeConnectorAppOAuth('github');
window.open(authorizationUrl, 'connector-admin-github-oauth', 'width=600,height=700');

// Check OAuth connection status
const status = await getConnectorAppOAuthStatus('github');
// { appKey: 'github', connected: true, status: 'active', connectedAt: '...', ... }

// Disconnect OAuth connection
await disconnectConnectorAppOAuth('github');

// Inspect MCP server with OAuth
const result = await inspectMcp(
  'streamable_http',
  'https://api.github.com/mcp',
  {},  // serverConfig
  'github',  // connectedAppKey
  {  // runtimeAuthConfig
    strategy: 'http_header_bearer',
    headerName: 'Authorization',
    headerPrefix: 'Bearer '
  }
);

// Create connector with OAuth
const connector = await createConnector({
  slug: 'github-mcp',
  name: 'GitHub MCP Server',
  description: 'GitHub tools for code analysis',
  authType: 'oauth2',
  authSourceType: 'connected_app',
  connectedAppKey: 'github',
  runtimeAuthConfig: {
    strategy: 'http_header_bearer',
    headerName: 'Authorization',
    headerPrefix: 'Bearer '
  },
  mcpTransportType: 'streamable_http',
  mcpServerUrl: 'https://api.github.com/mcp',
  actions: [],  // Auto-populated from MCP inspection
  isActive: true
});
```

### Connector OAuth Status Component

The `CreateEditConnectorDialog` component includes an OAuth status indicator:

```tsx
{form.authSourceType === 'connected_app' && form.connectedAppKey === 'github' && (
  <div className='flex items-center gap-2'>
    {githubConnected ? (
      <>
        <div className='w-2 h-2 rounded-full bg-green-500 animate-pulse' />
        <span className='text-green-600'>Connected to GitHub</span>
        <Button onClick={handleGithubDisconnect}>Disconnect</Button>
      </>
    ) : (
      <>
        <div className='w-2 h-2 rounded-full bg-amber-500' />
        <span className='text-amber-600'>Not connected to GitHub</span>
        <Button onClick={handleGithubOAuth}>Connect to GitHub</Button>
      </>
    )}
  </div>
)}
```

### OAuth Popup Communication

The OAuth flow uses `postMessage` for popup-to-parent communication:

```tsx
const handleMessage = (event: MessageEvent) => {
  if (event.data.type !== 'connector-admin-oauth-result' || event.data.appKey !== 'github') {
    return;
  }
  if (event.data.success) {
    await refreshGithubConnectionStatus();
  } else {
    toast.error('GitHub connection failed', { description: event.data.error });
  }
};

window.addEventListener('message', handleMessage);
```

### PostMessage Message Format

```typescript
{
  type: 'connector-admin-oauth-result';
  appKey: string;      // e.g., 'github'
  success: boolean;
  error?: string;      // Error message if failed
}
```

### Environment Configuration

For local development, ensure the following are configured in `.env`:

```bash
# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/admin/connectors/oauth/github/callback

# Frontend URL (for postMessage origin)
FRONTEND_URL=http://localhost:5173
```

For production, update the URLs to match your production domain.

### OAuth Callback HTML

The callback page returns HTML that posts the result to the opener window:

```html
<script>
  if (window.opener) {
    window.opener.postMessage({
      type: 'connector-admin-oauth-result',
      appKey: 'github',
      success: true
    }, 'http://localhost:5173');
  }
  setTimeout(function() { window.close(); }, 500);
</script>
```

---

## Testing

Admin tests are co-located with source files (`*.test.ts` / `*.test.tsx`).

### Current Coverage

- `api.ts`: analytics query-string behavior and representative endpoint contracts (maintenance, plans)
- `hooks/*`: wildcard permission logic and admin access/menu derivation
- `constants.ts` and `types.ts`: configuration invariants (unique ids/namespaces, non-empty permissions)
- `components/*`: AdminButton, AdminGuard, AdminLayout, AdminSidebar, AdminDashboard, and index exports
- `pages/*/form-schema.ts`: agent, agent-type, and tool form schema validation/default behavior

### Test Location Pattern

- `src/modules/admin/*.test.ts`
- `src/modules/admin/hooks/*.test.tsx`
- `src/modules/admin/components/*.test.tsx`
- `src/modules/admin/pages/**/*.test.ts`

### Run Admin Tests

```bash
npm run test -- src/modules/admin
```

### Notes

- Shared fixtures/mocks are used to keep duplication low and tests focused.
- UI component tests stub heavy primitives where needed for deterministic runs.

---

## Best Practices

### 1. Always Check Permissions

```tsx
// Before showing sensitive actions
{hasPermission('users.suspend') && (
  <Button onClick={handleSuspend}>Suspend User</Button>
)}
```

### 2. Use Consistent Loading States

```tsx
const [loading, setLoading] = useState(true);
const [saving, setSaving] = useState(false);

// Show spinner during load
{loading && <Loader2 className="h-6 w-6 animate-spin" />}

// Disable buttons during save
<Button disabled={saving}>
  {saving ? 'Saving...' : 'Save'}
</Button>
```

### 3. Handle Errors Gracefully

```tsx
import { toast } from 'sonner';

try {
  await someApiCall();
  toast.success('Action completed');
} catch (err) {
  toast.error('Action failed', {
    description: err instanceof Error ? err.message : 'Unknown error',
  });
}
```

### 4. Use Confirmation Dialogs for Destructive Actions

```tsx
import { AlertDialog, AlertDialogAction, ... } from '@/components/ui/alert-dialog';

<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete} className="bg-destructive">
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### 5. Implement Pagination for Lists

```tsx
const [page, setPage] = useState(1);
const [limit] = useState(20);
const [total, setTotal] = useState(0);

const totalPages = Math.ceil(total / limit);

// Pagination controls
<div className="flex justify-between">
  <span>Page {page} of {totalPages}</span>
  <div className="flex gap-2">
    <Button
      onClick={() => setPage(p => Math.max(1, p - 1))}
      disabled={page === 1}
    >
      Previous
    </Button>
    <Button
      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
      disabled={page === totalPages}
    >
      Next
    </Button>
  </div>
</div>
```

### 6. Use Shadcn/ui Components

Always check `front/src/components/ui/` for existing components before adding new dependencies.

Common components used in admin pages:
- `Card`, `CardHeader`, `CardTitle`, `CardContent`
- `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`
- `Button`, `Input`, `Select`, `Checkbox`
- `Dialog`, `AlertDialog`
- `Badge`, `Label`
- `DropdownMenu`

### 7. Follow the Responsive Pattern

```tsx
// Hide on mobile, show on desktop
<TableCell className="hidden md:table-cell">...</TableCell>

// Different layouts
<div className="flex flex-col md:flex-row gap-4">
```

### 8. Update Exports When Adding Features

When adding new types, functions, or components, always update:
1. The local `index.ts` in the subfolder
2. The main `modules/admin/index.ts`

---

## Related Documentation

- Backend Authorization: `back/src/modules/authorization/README.md`
- Backend Logger: `back/src/modules/logger/README.md`
- Backend Connector Module: `back/src/modules/connector/README.md`
- Backend Connected App Module: `back/src/modules/connected-app/README.md`
- Error Codes: `front/src/lib/error-codes.ts`
- API Client: `front/src/lib/api/client.ts`
