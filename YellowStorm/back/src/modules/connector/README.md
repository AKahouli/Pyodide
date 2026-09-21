# Connector Module

The Connector module enables integration with external Model Context Protocol (MCP) servers, allowing agents to use tools from third-party services such as GitHub, Microsoft, and other providers.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [OAuth 2.0 Authentication](#oauth-20-authentication)
- [Module Structure](#module-structure)
- [Database Collections](#database-collections)
- [API Endpoints](#api-endpoints)
- [Environment Variables](#environment-variables)
- [GitHub OAuth Setup](#github-oauth-setup)
- [Usage](#usage)
- [Security](#security)

---

## Overview

Connectors provide a standardized way to integrate with external MCP servers that expose tools for AI agents. Key features include:

- **Multiple Transport Types**: Streamable HTTP, SSE (Server-Sent Events), and stdio (local command)
- **Flexible Authentication**: Credential-based token, OAuth 2.0 via Connected Apps, or no authentication
- **Runtime Auth Config**: Support for custom headers and environment variable mappings
- **MCP Inspection**: Discover and import tools from MCP servers
- **Admin OAuth Flow**: Separate OAuth connections for admin-level access
- **Token Management**: Automatic token refresh and encrypted storage

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           Frontend                               │
├─────────────────────────────────────────────────────────────────┤
│  CreateEditConnectorDialog                                      │
│  - Create/Edit connector configuration                          │
│  - OAuth connection UI (Connect to GitHub)                      │
│  - MCP server inspection                                        │
├─────────────────────────────────────────────────────────────────┤
│  API Functions                                                  │
│  - CRUD operations for connectors                               │
│  - OAuth flow: authorize, status, disconnect                    │
│  - MCP inspection: inspect, import                              │
├─────────────────────────────────────────────────────────────────┤
│                           Backend                                │
├─────────────────────────────────────────────────────────────────┤
│  AdminConnectorController                                       │
│  - Connector CRUD endpoints                                     │
│  - OAuth authorization endpoints                               │
│  - MCP inspection endpoints                                     │
├─────────────────────────────────────────────────────────────────┤
│  ConnectorAdminAuthService                                      │
│  - OAuth flow management (PKCE support)                         │
│  - Token encryption and storage                                 │
│  - Automatic token refresh                                      │
├─────────────────────────────────────────────────────────────────┤
│  ConnectorService                                               │
│  - MCP server connection and inspection                         │
│  - Tool definition import                                       │
│  - Authentication injection                                     │
├─────────────────────────────────────────────────────────────────┤
│  ConnectedAppModule (Dependency)                                │
│  - OAuth app definitions (GitHub, etc.)                         │
│  - OAuth flow for user-level connections                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## OAuth 2.0 Authentication

The module supports OAuth 2.0 authentication for admin-level connector access. This is separate from user-level connected app OAuth.

### Flow Overview

```
1. Admin clicks "Connect to GitHub"
   ↓
2. Frontend calls GET /admin/connectors/oauth/github/authorize
   ↓
3. Backend generates authorization URL with PKCE
   ↓
4. Frontend opens popup to GitHub
   ↓
5. User authorizes the app
   ↓
6. GitHub redirects to /admin/connectors/oauth/github/callback
   ↓
7. Backend exchanges code for tokens
   ↓
8. Tokens are encrypted and stored in admin_connector_auth_tokens
   ↓
9. Callback page posts message to opener window
   ↓
10. Frontend polls status and shows connected state
```

### PKCE Support

The OAuth flow supports PKCE (Proof Key for Code Exchange) for enhanced security:

- **Code Verifier**: Random 32-byte value generated for each authorization
- **Code Challenge**: SHA-256 hash of code verifier sent to provider
- **Validation**: Code verifier sent during token exchange

### Token Management

| Aspect | Description |
|--------|-------------|
| Storage | Encrypted using `CryptoService` |
| Expiry Buffer | 5-minute buffer before refresh |
| Auto Refresh | Automatic refresh when token nears expiry |
| Revocation | Optional provider-side token revocation |

---

## Module Structure

```
back/src/modules/connector/
├── adapters/
│   └── m365-transfer.adapter.ts     # Microsoft 365 transfer adapter
├── dto/
│   ├── create-connector.dto.ts      # Create connector DTO
│   ├── update-connector.dto.ts      # Update connector DTO
│   ├── query-connector.dto.ts       # Query parameters DTO
│   ├── inspect-mcp.dto.ts           # MCP inspection DTO
│   ├── inspect-connector.dto.ts     # Connector inspection DTO
│   ├── connector-binding.dto.ts     # Connector binding DTO
│   ├── connector-transfer.dto.ts    # Connector transfer DTO
│   ├── create-connector-credential.dto.ts
│   ├── update-connector-credential.dto.ts
│   └── index.ts                     # DTO exports
├── interfaces/
│   ├── connector.interface.ts       # Connector interfaces
│   ├── connector-auth.interface.ts  # Authentication interfaces
│   └── connector-transfer.interface.ts
├── schemas/
│   ├── connector.schema.ts          # Connector data schema
│   ├── connector-credential.schema.ts
│   ├── admin-connector-auth.schema.ts      # OAuth token storage
│   └── admin-connector-oauth-state.schema.ts # OAuth state storage
├── services/
│   ├── connector-admin-auth.service.ts      # Admin OAuth flow
│   ├── connector.service.ts       # Core connector logic
│   ├── connector-auth.service.ts
│   ├── connector-credential.service.ts
│   └── connector-transfer.service.ts
├── admin-connector.controller.ts            # Admin API endpoints
├── admin-connector-auth-callback.controller.ts  # OAuth callback
├── connector.controller.ts          # Public/connector API
├── connector.module.ts              # Module definition
├── connector.service.spec.ts        # Unit tests
└── README.md                        # This file
```

---

## Database Collections

### `admin_connector_auth_tokens`

Stores encrypted OAuth tokens for admin connector connections.

```typescript
{
  userId: ObjectId;              // Admin user ID
  appKey: string;                // Connected app key (e.g., "github")
  accessToken: string;           // Encrypted OAuth access token
  refreshToken: string;          // Encrypted OAuth refresh token
  tokenExpiresAt: Date;          // Token expiration timestamp
  scopes: string[];              // Granted OAuth scopes
  connected: boolean;            // Connection status
  status: 'active' | 'expired' | 'revoked' | 'error';
  connectedAt: Date;             // Connection timestamp
  disconnectedAt: Date;          // Disconnection timestamp
  lastUsedAt: Date;              // Last token usage
  lastRefreshedAt: Date;         // Last token refresh
  errorMessage: string;          // Error details if applicable
}
```

### `admin_connector_oauth_states`

Temporary storage for OAuth state validation (TTL: 10 minutes).

```typescript
{
  state: string;                 // Random state parameter
  appKey: string;                // Connected app key
  userId: ObjectId;              // Admin user ID
  codeVerifier: string;          // PKCE code verifier
  expiresAt: Date;              // Expiration timestamp
}
```

### `connectors`

Main connector configuration storage.

```typescript
{
  slug: string;                  // Unique identifier
  name: string;                  // Display name
  description: string;           // Description
  icon: string;                  // Icon identifier
  color: string;                 // Display color
  authType: string;              // 'oauth2', 'token', 'none'
  authSourceType: string;        // 'connected_app', 'credential', 'none'
  connectedAppKey: string;       // Connected app reference
  runtimeAuthConfig: object;     // Runtime auth configuration
  mcpTransportType: string;      // 'streamable_http', 'sse', 'stdio'
  mcpServerUrl: string;          // MCP server URL
  mcpServerConfig: object;       // Server configuration
  actions: [];                   // Connector actions/tools
  referencedSkillIds: [];        // Linked skill IDs
  isActive: boolean;             // Active status
  createdBy: ObjectId;           // Creator user ID
}
```

---

## API Endpoints

### Connector Management

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/admin/connectors` | `CONNECTORS_READ` | List connectors (paginated) |
| GET | `/admin/connectors/:id` | `CONNECTORS_READ` | Get connector by ID |
| POST | `/admin/connectors` | `CONNECTORS_CREATE` | Create new connector |
| PATCH | `/admin/connectors/:id` | `CONNECTORS_UPDATE` | Update connector |
| DELETE | `/admin/connectors/:id` | `CONNECTORS_DELETE` | Delete connector |

### OAuth Management

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/admin/connectors/oauth/:appKey/authorize` | `CONNECTORS_UPDATE` | Get OAuth authorization URL |
| GET | `/admin/connectors/oauth/:appKey/status` | `CONNECTORS_READ` | Get OAuth connection status |
| DELETE | `/admin/connectors/oauth/:appKey/connection` | `CONNECTORS_UPDATE` | Disconnect OAuth connection |
| GET | `/admin/connectors/oauth/:appKey/callback` | Public | OAuth callback handler |

### MCP Inspection

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| POST | `/admin/connectors/inspect` | `CONNECTORS_READ` | Inspect MCP server (optional OAuth) |
| POST | `/admin/connectors/import-mcp` | `CONNECTORS_CREATE` | Import tools from MCP server |
| GET | `/admin/connectors/:id/authorize` | `CONNECTORS_UPDATE` | Get OAuth URL for connector |
| POST | `/admin/connectors/:id/inspect` | `CONNECTORS_READ` | Inspect using connector config |

---

## Environment Variables

### GitHub OAuth (Example)

```bash
# GitHub OAuth Configuration for Connectors
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# The callback URL must match your GitHub OAuth App configuration
# Local development example:
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/admin/connectors/oauth/github/callback

# Production example:
# GITHUB_CALLBACK_URL=https://api.yourdomain.com/api/v1/admin/connectors/oauth/github/callback
```

### Backend Configuration

```bash
# Application
PORT=3000
API_PREFIX=api

# Frontend URL (for OAuth postMessage)
FRONTEND_URL=http://localhost:5173  # or production domain

# Backend URL (for OAuth redirect URI construction)
BACKEND_URL=http://localhost:3000    # or production domain
```

---

## GitHub OAuth Setup

### Step 1: Create GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the form:
   - **Application name**: `YellowStorm Connectors`
   - **Homepage URL**: Your frontend URL (e.g., `http://localhost:5173`)
   - **Application description**: `Enables OAuth authentication for YellowStorm connectors`
   - **Authorization callback URL**: `http://localhost:3000/api/v1/admin/connectors/oauth/github/callback`

### Step 2: Configure Environment Variables

Add the following to your `.env` file:

```bash
GITHUB_CLIENT_ID=-------
GITHUB_CLIENT_SECRET=------------------
GITHUB_CALLBACK_URL=http://server/api/v1/admin/connectors/oauth/github/callback
```

### Step 3: Ensure Connected App Definition

The GitHub connected app must be defined in the `connected_app_definitions` collection:

```json
{
  "appKey": "github",
  "displayName": "GitHub",
  "description": "GitHub OAuth integration",
  "clientId": "${GITHUB_CLIENT_ID}",
  "clientSecret": "${GITHUB_CLIENT_SECRET}",
  "authorizationUrl": "https://github.com/login/oauth/authorize",
  "tokenUrl": "https://github.com/login/oauth/access_token",
  "scopes": ["repo", "read:org"],
  "pkceEnabled": true,
  "enabled": true
}
```

---

## Usage

### Creating a Connector with OAuth Authentication

```typescript
// 1. First, ensure OAuth connection is active
const authUrl = await authorizeConnectorAppOAuth('github');
// Open popup to `authUrl.authorizationUrl`

// 2. Check connection status
const status = await getConnectorAppOAuthStatus('github');
// { appKey: 'github', connected: true, status: 'active', ... }

// 3. Create connector
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
  isActive: true
});
```

### Inspecting an MCP Server

```typescript
const result = await inspectMcp(
  'streamable_http',
  'https://api.github.com/mcp',
  {},
  'github',  // connectedAppKey - will resolve OAuth token
  {
    strategy: 'http_header_bearer',
    headerName: 'Authorization',
    headerPrefix: 'Bearer '
  }
);

// result.tools contains discovered tool definitions
```

### Using OAuth Token in Service

```typescript
async inspectMcp(
  transportType: string,
  serverUrl: string,
  serverConfig: Record<string, unknown>,
  connectedAppKey?: string,
  runtimeAuthConfig?: Record<string, unknown>,
): Promise<McpInspectResult> {
  // Resolve OAuth token if connected app specified
  let resolvedToken: string | undefined;
  if (connectedAppKey) {
    resolvedToken = await this.connectorAdminAuthService.getValidToken(
      userId,
      connectedAppKey
    );
  }

  // Inject token into MCP connection
  const mcpConnection = await this.createMcpConnection(
    transportType,
    serverUrl,
    serverConfig,
    runtimeAuthConfig,
    resolvedToken
  );

  // Inspect tools...
}
```

---

## Security

### Token Encryption

All OAuth tokens are encrypted using the `CryptoService` before storage:

```typescript
const encryptedAccessToken = this.cryptoService.encrypt(accessToken);
const decryptedAccessToken = this.cryptoService.decrypt(encryptedAccessToken);
```

### CSRF Protection

OAuth state parameter prevents CSRF attacks:

```typescript
// Generate random state
const state = crypto.randomBytes(32).toString('hex');

// Validate on callback
const oauthState = await this.oauthStateModel.findOneAndDelete({ state });
if (!oauthState) {
  throw new BadRequestException('Invalid or expired OAuth state');
}
```

### Rate Limiting

Authorization endpoints are rate-limited to prevent abuse:

```typescript
@RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'admin:connector:oauth-authorize' })
```

### TTL-Based Cleanup

OAuth state documents automatically expire after 10 minutes:

```typescript
AdminConnectorOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

### Permission Checks

All admin connector endpoints require appropriate permissions:

```typescript
@RequirePermissions(Permissions.CONNECTORS_UPDATE)
async authorizeConnectorAppKey(...)
```

---

## Related Documentation

- [Connected App Module](../connected-app/README.md) - OAuth app definitions
- [Authorization Module](../authorization/README.md) - Permission system
- [Crypto Service](../../common/services/crypto.service.ts) - Token encryption

## Catalog import transaction boundary (plan 1B.4.5)

With the skills cutover, `CatalogTransferService.importArchive` runs as **two
ordered transactions**: a PostgreSQL transaction for skill categories and
skills first, then the Mongo session for connector categories, connectors and
security records. Both halves are idempotent upserts — skills keyed by
`(slug, createdBy)`, categories by name, connectors by `(slug, createdBy)` —
so re-running a failed import converges. P3 collapses this back into a single
PostgreSQL transaction.
