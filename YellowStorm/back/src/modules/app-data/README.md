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
- Generated apps use **app-scoped end-user auth** via `src/lib/yellowmind-auth.tsx`
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
| `APP_DATA_PUBLIC_RATE_LIMIT_PER_MINUTE` | `600` | Public GET rate limit (via `@RateLimit`, keyed by IP + `appDataId` + table). Writes stay at 120/min. |
| `APP_DATA_PUBLIC_BASE_URL_PROD` | (none) | Required in production deploys for App Data public URL |

## App end-user auth (generated apps)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/v1/app-data/public/:appDataId/auth/register` | Public + rate limit | Register app user (grants deny-all). Optional `inviteToken` binds the invited email. |
| `POST /api/v1/app-data/public/:appDataId/auth/login` | Public + rate limit | Login → JWT |
| `GET /api/v1/app-data/public/:appDataId/auth/me` | Bearer JWT | Current user |
| `GET /api/v1/app-data/public/:appDataId/invites/resolve?token=` | Public + rate limit | Resolve a share invite (email + title + expiry). `404` invalid, `410` expired/consumed, `403` token/app mismatch. |
| `GET/POST/PATCH/DELETE /api/v1/app-data/public/:appDataId/:environment/tables/...` | Bearer JWT on **prod** when `endUserAuthEnabled` | CRUD with owner-managed grants |

Owner management (JWT YellowMind + `ConversationV2OwnerGuard`, which also allows shared users):

- `GET /api/v1/conversation-v2/sessions/:id/app-data/end-users`
- `PUT /api/v1/conversation-v2/sessions/:id/app-data/end-users/:userId/grants`
- `PATCH /api/v1/conversation-v2/sessions/:id/app-data/end-users/:userId/status`

## Principals (MCP / public dev)

| Principal | Meaning |
|-----------|---------|
| `anonymous` | Unauthenticated browser visitor (dev policies / preview) |
| `public` | Reserved |
| `yellowmind_owner` | Conversation session owner (MCP + owner Data tab) |

When `endUserAuthEnabled=true`, **PROD public CRUD** uses per-user grants instead of table policies. Policies replicated to prod **strip `anonymous`**.

**Preview (Nodepod):** the starter skips the login gate when `vite dev` runs with
`VITE_YM_APP_DATA_ENV=dev` (injected by the runtime). Deployed production builds
always enforce auth regardless of that env var.

**DEV policies:** `schema_apply` auto-seeds default policies on new tables (`anonymous` + `yellowmind_owner`, full CRUD). Preview browser CRUD uses principal `anonymous`; MCP `row_*` uses `yellowmind_owner`. Manual override via `policy_apply`.

After `provision`, restart the Vite dev server (`yellowruntime_dev_server` `action=restart`) so `VITE_YM_*` reaches the preview.

Default deny-all grants for newly registered app users until the owner enables CRUD in App Marketplace.

App Builder share invites use an opaque token (hashed on the Mongo share row). The
deployed Register page calls `GET …/invites/resolve` to prefill and lock the email,
then `POST …/auth/register` with `inviteToken`. New App Builder sessions use
starter revision `starter_react_vite_v4` (`appbuilder/manifests/_system/starter_react_vite_v4.json`).
Existing deployed apps need a **redeploy** to pick up the Register prefill UI; the backend accepts the token immediately.

## React starter templates

Source of truth: [`templates/sources/`](templates/sources/) (valid TypeScript; copied into the v3 starter by `scripts/materialize-starter-v3.ts`).

`YellowStorm/starters/` is a **local generated artifact** (not git-tracked). Recreate it with `npx ts-node scripts/materialize-starter-v3.ts`.

| File | Purpose |
|------|---------|
| `templates/sources/yellowmind-data.ts` | App Data client (Bearer JWT) |
| `templates/sources/yellowmind-auth.tsx` | Register/login/session |
| `templates/sources/ProtectedRoute.tsx` | Login gate (skipped in dev preview) |
| `templates/sources/AuthPages.tsx` | Login/Register pages (Yellowsys landing layout) |
| `templates/sources/AppRouter.tsx` | Router + basename |
| `templates/sources/app-base.ts` | React Router basename + `/apps/{id}/` trailing-slash normalization |
| `templates/assets/` | Yellowsys logo + App Builder preview images copied to `public/brand/` |

### Ceph starter sync

```bash
cd YellowStorm/back
npx ts-node scripts/materialize-starter-v3.ts
# Upload to Ceph + regenerate embedded hashes:
npx ts-node scripts/publish-starter-to-ceph.ts --dir ../starters/starter-react-vite-v3 --revision starter_react_vite_v3
# Or regenerate hashes without upload:
node scripts/generate-starter-constants.mjs ../starters/starter-react-vite-v3 starter_react_vite_v3
```

V3 adds (on top of v1):

- `src/lib/yellowmind-data.ts`
- `src/lib/yellowmind-auth.tsx`
- `src/components/auth/ProtectedRoute.tsx`
- `src/pages/AuthPages.tsx`
- `src/AppRouter.tsx`
- `src/lib/app-base.ts`
- Tailwind + minimal UI components for auth pages

Wire `main.jsx` renders `<AppRouter />` (v3 only).

Deployed apps are served under `/apps/{sessionId}/`. Deploy injects `VITE_APP_BASE` into `.env.production`; the starter sets Vite `base` and React Router `basename` so `/login` and post-auth redirects stay under the app URL. React Router renders the basename without a trailing slash, so `AppUrlNormalizer` calls `ensureAppHomeTrailingSlash()` on every navigation to keep `/apps/{sessionId}/` in the address bar. Revisions missing `src/lib/app-base.ts` (pre-v3) are rejected at deploy time.

## Error taxonomy

See `constants/app-data.errors.ts` — codes include `APP_DATA_POLICY_DENIED`,
`APP_DATA_GRANT_DENIED`, `APP_DATA_AUTH_REQUIRED`, `APP_DATA_AUTH_INVALID`,
`APP_DATA_EMAIL_TAKEN`, `APP_DATA_USER_DISABLED`.

## Control plane tables (`app_data.*`)

`apps`, `environments`, `schema_versions`, `migrations`, `policies`, `release_bindings`,
`audit_events`, `end_users`, `end_user_grants`.
