# Auth Provider Module

A generic, admin-configurable OAuth 2.0 provider system that supports any standards-compliant identity provider (Microsoft, Google, GitHub, Okta, etc.).

## Features

- **Dynamic Provider Configuration** — Admins add/edit OAuth providers at runtime via API
- **PKCE (S256)** — Server-side code verifier with SHA-256 challenge for public client security
- **CSRF State Validation** — Server-side, single-use state tokens with 10-minute TTL
- **Encrypted Secrets** — Client secrets encrypted at rest using AES-256-GCM with per-value IV
- **Account Linking** — Email-verified linking only; never auto-links to existing accounts
- **Temp Token Exchange** — Short-lived token pattern enabling proper HTTP-only cookie handling
- **Unlink Protection** — Prevents users from unlinking their last authentication method
- **Audit Logging** — All admin CRUD operations are logged
- **Rate Limiting** — Applied to all public OAuth endpoints

## Schemas

Four Postgres tables in the `identity` schema back the module (Drizzle: `postgres/schema/identity.schema.ts`), each behind a store port with a `Pg*` adapter in `persistence/pg-auth-provider.stores.ts`:

| Table | Store (port -> adapter) / Purpose |
|-------|---------|
| `identity.auth_providers` | `AUTH_PROVIDER_STORE` -> `PgAuthProviderStore`. Unique on `provider_key`. Provider configurations (clientId, encrypted clientSecret, URLs, scopes) |
| `identity.user_provider_links` | `USER_PROVIDER_LINK_STORE` -> `PgUserProviderLinkStore`. Junction table mapping user ↔ provider (unique on `provider_key` + `provider_user_id`; `user_id` FK to `identity.users` with `ON DELETE CASCADE`) |
| `identity.oauth_states` | `OAUTH_STATE_STORE` -> `PgOAuthStateStore`. CSRF state + PKCE code_verifier (10min TTL, unique on `state`, expired rows swept by `PgTtlSweeper`) |
| `identity.provider_link_tokens` | `PROVIDER_LINK_TOKEN_STORE` -> `PgProviderLinkTokenStore`. Account linking verification and temp login tokens (unique on `token`, `user_id` FK with `ON DELETE CASCADE`, expired rows swept by `PgTtlSweeper`) |

## Services

### AuthProviderService

Admin CRUD for provider configurations. Secrets are masked in all responses and encrypted/decrypted via `CryptoService`.

### OAuthFlowService

Core OAuth orchestration with four key methods:

- **`buildAuthorizationUrl()`** — Generates state + PKCE, saves to DB, returns redirect URL
- **`handleCallback()`** — Validates state, exchanges code for tokens, fetches userinfo, runs decision tree
- **`exchangeTempToken()`** — Exchanges short-lived temp token for real JWT + refresh cookie
- **`verifyAndLink()`** — Verifies email linking token and creates provider link

**Decision tree** in `handleCallback()`:

| Condition | Action |
|-----------|--------|
| Provider already linked to a user | Log in → issue temp token |
| Email exists but not linked | Send verification email → return `link_required` |
| New email, no account | Create user + link → issue temp token |

### ProviderLinkService

User-provider link management. Enforces that the last authentication method cannot be unlinked.

## Controllers

### Public OAuth Endpoints

Routes under `/api/v1/auth/providers/`. All are public (no JWT required).

| Method | Endpoint | Rate Limit | Description |
|--------|----------|------------|-------------|
| GET | `/auth/providers` | — | List enabled providers (no secrets exposed) |
| GET | `/auth/providers/:providerKey/authorize` | 10/min | Redirect to OAuth provider authorization URL |
| GET | `/auth/providers/:providerKey/callback` | — | Handle OAuth callback, redirect to frontend |
| POST | `/auth/providers/exchange` | 10/min | Exchange temp token for JWT + refresh cookie |
| GET | `/auth/providers/link/verify` | 5/min | Verify email linking token, redirect to frontend |

### Admin Endpoints

Routes under `/api/v1/admin/auth-providers`. All require JWT + specific permissions.

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/admin/auth-providers` | `auth_providers.read` | List all providers (secrets masked) |
| GET | `/admin/auth-providers/:id` | `auth_providers.read` | Get provider by ID |
| POST | `/admin/auth-providers` | `auth_providers.create` | Create provider + audit log |
| PATCH | `/admin/auth-providers/:id` | `auth_providers.update` | Update provider + audit log |
| DELETE | `/admin/auth-providers/:id` | `auth_providers.delete` | Delete provider + audit log (rejects if users linked) |

## Configuration

### Environment Variables

```env
ENCRYPTION_KEY=   # 64 hex characters (32 bytes). Required in production.
```

Generate a key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In development, if `ENCRYPTION_KEY` is not set, a deterministic dev key is used. This key survives restarts but is not secure for production.

### Key Loss & Rotation

**If `ENCRYPTION_KEY` is lost or changed**, all provider secrets (clientId, clientSecret, tenantId) become undecryptable. OAuth login will fail for all providers.

**What breaks:**
- OAuth login — `buildAuthorizationUrl()` and `handleCallback()` fail on decrypt
- Admin panel still shows providers (display names are not encrypted) but secrets cannot be read

**What does NOT break:**
- Email/password login — unaffected
- Existing JWT sessions — tokens are signed with `JWT_SECRET`, not `ENCRYPTION_KEY`
- User accounts and provider links — intact in Postgres

**Recovery:**
1. **Old key available** — restore it in `ENCRYPTION_KEY`, everything works immediately
2. **Old key lost** — delete all providers (Admin UI, or `DELETE FROM identity.auth_providers`), then re-create them with the correct credentials. User-provider links (`identity.user_provider_links` table) remain valid since they reference `providerKey` + `providerUserId`, not the encrypted secrets

**Treat `ENCRYPTION_KEY` like `JWT_SECRET`** — back it up, never lose it in production. Losing `JWT_SECRET` only invalidates sessions (users re-login), but losing `ENCRYPTION_KEY` requires re-entering all OAuth provider credentials.

### Permissions

The following permissions are registered and included in the `admin` and `super_admin` default roles:

- `auth_providers.read`
- `auth_providers.create`
- `auth_providers.update`
- `auth_providers.delete`
- `auth_providers.*` (wildcard)

## OAuth Flow

```
User clicks "Login with Microsoft"
  → GET /auth/providers/microsoft/authorize
  → Backend generates state + PKCE, saves to DB
  → 302 redirect to Microsoft authorization URL

Microsoft authenticates user, redirects back
  → GET /auth/providers/microsoft/callback?code=...&state=...
  → Backend validates state (single-use, 10min TTL)
  → Exchanges authorization code for tokens (sends PKCE code_verifier)
  → Fetches userinfo (sub, email, name)
  → Runs decision tree:
      Linked       → create temp token → redirect with ?token=xxx
      Email exists → send linking email → redirect with ?link_required=true
      New user     → create user + link → redirect with ?token=xxx
  → 302 redirect to frontend /#/oauth-callback?...

Frontend OAuthCallbackPage
  → POST /auth/providers/exchange { token: xxx }
  → Backend validates temp token (single-use, 5min TTL)
  → Returns JWT access token + HTTP-only refresh cookie
  → Frontend stores access token, redirects to /
```

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| `ERR_1121` | `AUTH_OAUTH_FAILED` | Generic OAuth failure |
| `ERR_1122` | `AUTH_OAUTH_STATE_INVALID` | Invalid or expired CSRF state |
| `ERR_1123` | `AUTH_OAUTH_EMAIL_MISSING` | Provider did not return an email |
| `ERR_1124` | `AUTH_OAUTH_LINK_REQUIRED` | Account exists, linking required |
| `ERR_1125` | `AUTH_OAUTH_LINK_TOKEN_INVALID` | Invalid temp or link token |
| `ERR_1126` | `AUTH_OAUTH_LINK_TOKEN_EXPIRED` | Expired temp or link token |
| `ERR_1127` | `AUTH_OAUTH_PROVIDER_DISABLED` | Provider is disabled |
| `ERR_1128` | `AUTH_OAUTH_PROVIDER_NOT_FOUND` | Provider not found |
| `ERR_1129` | `AUTH_OAUTH_ACCOUNT_ALREADY_LINKED` | Provider account already linked to another user |
| `ERR_2600` | `AUTH_PROVIDER_NOT_FOUND` | Admin: provider not found |
| `ERR_2601` | `AUTH_PROVIDER_ALREADY_EXISTS` | Admin: duplicate provider key |
| `ERR_2603` | `AUTH_PROVIDER_IN_USE` | Admin: cannot delete, users are linked |

## Security Considerations

- **OAuth State** — Server-side, single-use, 10-minute TTL. Prevents CSRF attacks.
- **PKCE (S256)** — Code verifier stored server-side only; only the SHA-256 challenge is sent to the provider. Prevents authorization code interception.
- **Secrets Encrypted at Rest** — AES-256-GCM with a unique IV per value. Client secrets are never stored in plaintext.
- **No Secrets in Public Endpoints** — Public provider listing omits all sensitive fields.
- **Account Linking Requires Email Verification** — Existing accounts are never auto-linked. A verification email must be confirmed before linking completes.
- **Temp Token** — 5-minute TTL, single-use (deleted on consumption). Bridges the OAuth redirect and the secure JWT exchange.
- **Rate Limiting** — Authorization, exchange, and verify endpoints are rate-limited to prevent abuse.
- **Audit Logging** — All admin CRUD operations produce audit log entries.
- **Unlink Protection** — Users cannot remove their last authentication method, preventing account lockout.
