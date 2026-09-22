# Connected App Module

The Connected App module enables OAuth 2.0 integrations with third-party services, allowing users to connect their accounts with external providers like GitHub, Microsoft, and others.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [OAuth Flow](#oauth-flow)
- [Module Structure](#module-structure)
- [Database Tables](#database-tables)
- [API Endpoints](#api-endpoints)
- [Environment Variables](#environment-variables)
- [Supported Providers](#supported-providers)
- [Usage](#usage)
- [Security](#security)

---

## Overview

The Connected App module provides a complete OAuth 2.0 implementation for user-level integrations. Key features include:

- **OAuth 2.0 & PKCE Support**: Secure authorization with PKCE for enhanced security
- **Multiple Providers**: Support for GitHub, Microsoft, and other OAuth providers
- **Token Management**: Automatic token refresh, encryption, and expiry tracking
- **State Management**: CSRF protection with state parameter validation
- **Admin Configuration**: Admin-managed OAuth app definitions
- **User Connections**: User-specific app connections with scoping

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           Frontend                               │
├─────────────────────────────────────────────────────────────────┤
│  Connect To [Provider] Button                                   │
│  ↓                                                               │
│  Popup Opens Provider Authorization Page                        │
│  ↓                                                               │
│  PostMessage Callback -> Connection State Update               │
├─────────────────────────────────────────────────────────────────┤
│                           Backend                                │
├─────────────────────────────────────────────────────────────────┤
│  ConnectedAppController (User endpoints)                         │
│  - List user connections                                         │
│  - Manage user app connections                                    │
├─────────────────────────────────────────────────────────────────┤
│  ConnectedAppAdminController (Admin endpoints)                   │
│  - Manage OAuth app definitions                                  │
│  - View all connections                                           │
├─────────────────────────────────────────────────────────────────┤
│  ConnectedAppOAuthService                                        │
│  - Build authorization URLs                                      │
│  - Handle OAuth callbacks                                        │
│  - Exchange codes for tokens                                     │
│  - Token refresh                                                 │
├─────────────────────────────────────────────────────────────────┤
│  ConnectedAppUserService                                         │
│  - Manage user app connections                                   │
│  - Get connection status                                         │
│  - Disconnect users                                              │
├─────────────────────────────────────────────────────────────────┤
│  ConnectedAppDefinitionService                                   │
│  - CRUD for OAuth app definitions                                │
│  - Fetch app config by key                                       │
├─────────────────────────────────────────────────────────────────┤
│  CryptoService (Encryption)                                      │
├─────────────────────────────────────────────────────────────────┤
│  Tables (Postgres, schema integrations):                         │
│  - connected_app_definitions     (OAuth app configs)             │
│  - user_app_connections         (User connections)              │
│  - connected_app_oauth_states    (OAuth state storage)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## OAuth Flow

### Authorization Code Flow with PKCE

```
1. User clicks "Connect to GitHub"
   ↓
2. Frontend calls GET /connected-apps/github/authorize
   ↓
3. Backend generates PKCE code_verifier and code_challenge
   ↓
4. Backend creates OAuth state record (TTL: 10 minutes)
   ↓
5. Backend returns authorization URL with state and code_challenge
   ↓
6. Frontend opens popup to provider
   ↓
7. User authorizes the app
   ↓
8. Provider redirects to /connected-apps/github/callback with code and state
   ↓
9. Backend validates state and retrieves code_verifier
   ↓
10. Backend exchanges code for tokens (with code_verifier for PKCE)
   ↓
11. Tokens are encrypted and stored in user_app_connections
   ↓
12. Callback page posts message to opener window
   ↓
13. Frontend updates connection UI
```

### Token Refresh Flow

```
1. Service requests access token for user
   ↓
2. Backend checks token expiry (5-minute buffer)
   ↓
3a. If valid: Return access token
   ↓
3b. If expiring: Use refresh token to get new access token
   ↓
4. Update stored tokens
   ↓
5. Return new access token
```

---

## Module Structure

```
back/src/modules/connected-app/
├── controllers/
│   ├── connected-app.controller.ts       # User endpoints
│   ├── connected-app-admin.controller.ts # Admin endpoints
│   ├── connected-app-callback.controller.ts # OAuth callback handler
│   ├── connected-app-admin.controller.spec.ts
│   ├── connected-app.controller.spec.ts
│   └── connected-app-callback.controller.spec.ts
├── dto/
│   ├── create-connected-app-definition.dto.ts
│   ├── update-connected-app-definition.dto.ts
│   ├── index.ts
├── persistence/
│   ├── connected-app.store.ts                # Store ports (definition, user connection, OAuth state)
│   └── pg-connected-app.store.ts             # Pg* adapters (Drizzle, integrations schema)
├── services/
│   ├── connected-app-definition.service.ts
│   ├── connected-app-oauth.service.ts        # OAuth flow logic
│   ├── connected-app-user.service.ts         # User connection mgmt
│   ├── connected-app-token.service.ts        # Token mgmt
│   ├── connected-app-definition.service.spec.ts
│   ├── connected-app-oauth.service.spec.ts
│   ├── connected-app-user.service.spec.ts
│   └── connected-app-token.service.spec.ts
├── interfaces/
│   └── connected-app.interface.ts
├── connected-app.module.ts                  # Module definition
├── index.ts                                # Public exports
└── README.md                               # This file
```

---

## Database Tables

Persistence is PostgreSQL (Drizzle, schema `integrations`; `postgres/schema/integrations.schema.ts`). `ConnectedAppModule` binds `CONNECTED_APP_DEFINITION_STORE` -> `PgConnectedAppDefinitionStore`, `USER_APP_CONNECTION_STORE` -> `PgUserAppConnectionStore` and `CONNECTED_APP_OAUTH_STATE_STORE` -> `PgConnectedAppOauthStateStore`. Unique indexes: `connected_app_definitions (app_key)`, `user_app_connections (user_id, app_key)`, `connected_app_oauth_states (state)`. `user_id` carries no FK. The TypeScript shapes below are logical models.

### `integrations.connected_app_definitions`

OAuth application definitions (admin-managed).

```typescript
{
  appKey: string;              // Unique app identifier (e.g., "github")
  displayName: string;         // Display name for UI
  description: string;         // App description
  clientId: string;            // OAuth client ID
  clientSecret: string;        // OAuth client secret (encrypted)
  authorizationUrl: string;    // OAuth authorization endpoint
  tokenUrl: string;            // OAuth token endpoint
  userInfoUrl?: string;        // User info endpoint (optional)
  scopes: string[];            // Requested OAuth scopes
  pkceEnabled: boolean;        // Enable PKCE flow
  tenantId?: string;           // For Azure AD tenant support
  revokeUrl?: string;          // Token revocation endpoint
  enabled: boolean;            // Enable/disable app
  createdAt: Date;
  updatedAt: Date;
}
```

### `integrations.user_app_connections`

User-specific OAuth connections.

```typescript
{
  userId: ObjectId;            // User ID
  appKey: string;              // Connected app key
  accessToken: string;         // Encrypted access token
  refreshToken: string;        // Encrypted refresh token
  tokenExpiresAt: Date;        // Token expiry
  scopes: string[];            // Granted scopes
  status: 'active' | 'expired' | 'revoked' | 'error';
  providerAccountId?: string;  // Provider account ID
  providerEmail?: string;      // Provider account email
  lastRefreshedAt: Date;
  lastUsedAt: Date;
  errorMessage?: string;       // Error details
  createdAt: Date;
  updatedAt: Date;
}
```

### `integrations.connected_app_oauth_states`

Temporary OAuth state storage (TTL: 10 minutes; expired rows are swept by `PgTtlSweeper`).

```typescript
{
  state: string;               // CSRF protection state
  appKey: string;              // App identifier
  userId: ObjectId;            // User ID
  codeVerifier?: string;       // PKCE code verifier
  expiresAt: Date;             // Expiration timestamp
  createdAt: Date;
}
```

---

## API Endpoints

### User Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/connected-apps` | User | List user's connections |
| GET | `/connected-apps/:appKey/authorize` | User | Get OAuth authorization URL |
| GET | `/connected-apps/:appKey/authorize-pkce` | User | Get OAuth URL with PKCE |
| GET | `/connected-apps/:appKey/status` | User | Get connection status |
| DELETE | `/connected-apps/:appKey` | User | Disconnect app |

### Admin Endpoints

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/admin/connected-apps` | `CONNECTED_APPS_READ` | List all app definitions |
| GET | `/admin/connected-apps/:appKey` | `CONNECTED_APPS_READ` | Get app definition |
| POST | `/admin/connected-apps` | `CONNECTED_APPS_CREATE` | Create app definition |
| PATCH | `/admin/connected-apps/:appKey` | `CONNECTED_APPS_UPDATE` | Update app definition |
| DELETE | `/admin/connected-apps/:appKey` | `CONNECTED_APPS_DELETE` | Delete app definition |
| GET | `/admin/connected-apps/connections` | `CONNECTED_APPS_READ` | List all user connections |
| GET | `/admin/connected-apps/connections/:userId` | `CONNECTED_APPS_READ` | Get user connections |
| DELETE | `/admin/connected-apps/connections/:userId/:appKey` | `CONNECTED_APPS_MANAGE` | Disconnect user |

### OAuth Callback

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/connected-apps/:appKey/callback` | Public | OAuth callback handler |

---

## Environment Variables

### GitHub OAuth

```bash
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/connected-apps/github/callback
```

### Microsoft OAuth

```bash
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_TENANT_ID=common  # or specific tenant ID
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/v1/auth/microsoft/callback
```

---

## Supported Providers

### GitHub

| Property | Value |
|----------|-------|
| `appKey` | `github` |
| Authorization URL | `https://github.com/login/oauth/authorize` |
| Token URL | `https://github.com/login/oauth/access_token` |
| Scopes | `repo`, `read:org` (configurable) |
| PKCE | Supported |

### Microsoft Azure AD

| Property | Value |
|----------|-------|
| `appKey` | `microsoft` |
| Authorization URL | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` |
| Token URL | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` |
| UserInfo URL | `https://graph.microsoft.com/oidc/userinfo` |
| Scopes | `openid`, `email`, `profile` |
| Tenant ID | Configurable (`common`, `organizations`, or specific tenant) |

---

## Usage

### Creating a Connected App Definition (Admin)

```typescript
const appDefinition = await createConnectedAppDefinition({
  appKey: 'github',
  displayName: 'GitHub',
  description: 'GitHub OAuth integration',
  clientId: 'your_client_id',
  clientSecret: 'your_client_secret',
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scopes: ['repo', 'read:org'],
  pkceEnabled: true,
  enabled: true
});
```

### User Connects to App

```typescript
// 1. Get authorization URL
const { authorizationUrl } = await getAuthorizationUrl('github');

// 2. Open popup to authorizationUrl
window.open(authorizationUrl, 'oauth-popup', 'width=600,height=700');

// 3. Listen for postMessage callback
window.addEventListener('message', (event) => {
  if (event.data.type === 'connected-app-oauth-result') {
    if (event.data.success) {
      console.log('Connected successfully');
    }
  }
});

// 4. Check status
const status = await getConnectionStatus('github');
```

### Using OAuth Token in Service

```typescript
async callGitHubApi(userId: string) {
  const token = await this.connectedAppTokenService.getValidAccessToken(userId, 'github');
  
  const response = await fetch('https://api.github.com/user/repos', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  
  return response.json();
}
```

### Disconnect User

```typescript
await disconnectUserApp(userId, 'github');
// This revokes tokens at provider (if revokeUrl configured)
// and marks connection as revoked
```

---

## Security

### Token Encryption

All tokens are encrypted using `CryptoService`:

```typescript
const encrypted = this.cryptoService.encrypt(token);
const decrypted = this.cryptoService.decrypt(encrypted);
```

### CSRF Protection

State parameter prevents CSRF attacks:

```typescript
// Generate random state
const state = crypto.randomBytes(32).toString('hex');

// Validate on callback
const oauthState = await this.oauthStateModel.findOneAndDelete({ state });
if (!oauthState) {
  throw new BadRequestException('Invalid or expired OAuth state');
}
```

### PKCE (Proof Key for Code Exchange)

For mobile and SPA apps, PKCE adds an extra layer of security:

```typescript
// Generate code verifier
const codeVerifier = crypto.randomBytes(32).toString('base64url');

// Generate code challenge
const codeChallenge = crypto.createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// Include in authorization URL
params.set('code_challenge', codeChallenge);
params.set('code_challenge_method', 'S256');

// Use code_verifier in token exchange
body.set('code_verifier', codeVerifier);
```

### TTL-Based Cleanup

OAuth states expire after 10 minutes and are deleted by `PgTtlSweeper` (registered for `integrations.connected_app_oauth_states.expires_at` in `PgTtlRegistrationService`):

```typescript
this.sweeper.register({ schema: 'integrations', table: 'connected_app_oauth_states', column: 'expires_at' });
```

### Token Refresh Buffer

Tokens are refreshed 5 minutes before expiry:

```typescript
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

if (record.tokenExpiresAt && 
    record.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < now.getTime()) {
  return this.refreshAccessToken(record);
}
```

---

## Related Documentation

- [Connector Module](../connector/README.md) - Admin-level OAuth for connectors
- [Authorization Module](../authorization/README.md) - Permission system
- [Crypto Service](../../common/services/crypto.service.ts) - Token encryption