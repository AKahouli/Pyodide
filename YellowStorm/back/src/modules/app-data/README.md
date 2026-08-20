# App Data Module

Persistent PostgreSQL storage for App Builder generated applications. Business data
lives in tenant schemas; Nodepod/microVM runtimes execute code only.

## Invariants

- Each workspace with persistence receives an opaque server-generated `appDataId`.
- Physical schemas: `ymapp_<appDataId>_dev` and `ymapp_<appDataId>_prod`.
- OpenCode uses **App Data MCP** (`POST /api/v1/mcp/app-data`) with the existing
  runtime `mcpToken` (resolved via `AppRuntimeBinding`).
- Generated React apps use **HTTPS only** via `src/lib/yellowmind-data.ts` and
  `VITE_YM_*` env vars — never DB credentials or MCP tokens.
- Generated apps use **app-scoped end-user auth** via `src/lib/yellowmind-auth.ts`
  (register/login JWT) — separate from YellowMind platform users.
- No arbitrary SQL, PROD downgrades, or DEV→PROD row copies.
- Destructive migrations require explicit DEV confirmation; never auto-applied on PROD.

## Feature flags

| Env | Default | Effect |
|-----|---------|--------|
| `APP_DATA_ENABLED` | `false` | Master switch |
| `APP_DATA_MCP_ENABLED` | `false` | App Data MCP endpoint |
| `APP_DATA_PUBLIC_API_ENABLED` | `false` | Public HTTP CRUD |
| `APP_DATA_DATA_TAB_ENABLED` | `false` | Owner Data tab |
| `APP_DATA_END_USER_AUTH_ENABLED` | `true` | App end-user register/login + PROD grant enforcement |
| `APP_DATA_END_USER_JWT_TTL` | `7d` | JWT lifetime for app users |
| `APP_DATA_PUBLIC_RATE_LIMIT_PER_MINUTE` | `120` | Public CRUD rate limit (via `@RateLimit`) |

## App end-user auth (generated apps)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /app-data/public/:appDataId/auth/register` | Public + rate limit | Register app user (grants deny-all) |
| `POST /app-data/public/:appDataId/auth/login` | Public + rate limit | Login → JWT |
| `GET /app-data/public/:appDataId/auth/me` | Bearer JWT | Current user |
| `GET/POST/PATCH/DELETE .../:environment/tables/...` | Bearer JWT on **prod** when `end_user_auth_enabled` | CRUD with owner-managed grants |

Owner management (JWT YellowMind + `ConversationV2OwnerGuard`):

- `GET /conversation-v2/sessions/:id/app-data/end-users`
- `PUT /conversation-v2/sessions/:id/app-data/end-users/:userId/grants`
- `PATCH /conversation-v2/sessions/:id/app-data/end-users/:userId/status`

## Principals (MCP / legacy public dev)

| Principal | Meaning |
|-----------|---------|
| `anonymous` | Unauthenticated browser visitor (legacy apps / dev policies) |
| `public` | Reserved |
| `yellowmind_owner` | Conversation session owner (MCP + owner Data tab) |

When `apps.end_user_auth_enabled=true`, **PROD public CRUD** uses per-user grants instead of table policies.

Default deny-all grants for newly registered app users until the owner enables CRUD in App Marketplace.

## React starter templates

Source of truth: [`templates/`](templates/)

| File | Purpose |
|------|---------|
| `yellowmind-data.starter.ts` | App Data client (Bearer JWT) |
| `yellowmind-auth.starter.ts` | Register/login/session |
| `yellowmind-auth-ui.starter.ts` | Login/Register pages, ProtectedRoute, AppRouter |

### Ceph starter sync

Canonical projects live under `YellowStorm/starters/`:

| Directory | Ceph revision |
|-----------|---------------|
| `starter-react-vite-v1` | `starter_react_vite_v1` (legacy) |
| `starter-react-vite-v3` | `starter_react_vite_v3` (default — auth + App Data) |

Source templates: [`templates/sources/`](templates/sources/) (valid TypeScript; synced into v3 via `scripts/materialize-starter-v3.ts`).

Publish:

```bash
cd YellowStorm/back
npx ts-node scripts/materialize-starter-v3.ts
npx ts-node scripts/publish-starter-to-ceph.ts --dir ../starters/starter-react-vite-v3 --revision starter_react_vite_v3
```

V3 adds (on top of v1):

- `src/lib/yellowmind-data.ts`
- `src/lib/yellowmind-auth.tsx`
- `src/components/auth/ProtectedRoute.tsx`
- `src/pages/AuthPages.tsx`
- `src/AppRouter.tsx`
- Tailwind + minimal UI components for auth pages

Wire `main.jsx` renders `<AppRouter />` (v3 only).

## Error taxonomy

See `constants/app-data.errors.ts` — codes include `APP_DATA_POLICY_DENIED`,
`APP_DATA_GRANT_DENIED`, `APP_DATA_AUTH_REQUIRED`, `APP_DATA_AUTH_INVALID`,
`APP_DATA_EMAIL_TAKEN`, `APP_DATA_USER_DISABLED`.

## Control plane tables (`app_data.*`)

`apps`, `environments`, `schema_versions`, `migrations`, `policies`, `release_bindings`,
`audit_events`, `end_users`, `end_user_grants`.
