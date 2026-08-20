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
- No arbitrary SQL, PROD downgrades, or DEV→PROD row copies.
- Destructive migrations require explicit DEV confirmation; never auto-applied on PROD.

## Feature flags

| Env | Default | Effect |
|-----|---------|--------|
| `APP_DATA_ENABLED` | `false` | Master switch |
| `APP_DATA_MCP_ENABLED` | `false` | App Data MCP endpoint |
| `APP_DATA_PUBLIC_API_ENABLED` | `false` | Public HTTP CRUD |
| `APP_DATA_DATA_TAB_ENABLED` | `false` | Owner Data tab |

## Principals (policy MVP)

| Principal | Meaning |
|-----------|---------|
| `anonymous` | Unauthenticated browser visitor (deployed/preview app) |
| `public` | Any authenticated YellowMind user |
| `yellowmind_owner` | Conversation session owner |

Default deny-all until policies are applied per table.

## Error taxonomy

See `constants/app-data.errors.ts` — codes include `APP_DATA_POLICY_DENIED`,
`APP_DATA_VERSION_CONFLICT`, `APP_DATA_DESTRUCTIVE_BLOCKED`, `APP_DATA_PROD_DOWNGRADE_BLOCKED`.

## External contracts (documented only)

- **APImanus**: register second MCP URL from bind (`appDataMcpUrl`).
- **app-deployer**: receives non-secret `runtimeEnv` `{ appDataId, environment: 'prod', publicUrl }`.
- **microVM manager**: same DEV `runtimeEnv` as Nodepod when fallback is available.

## Control plane tables (`app_data.*`)

`apps`, `environments`, `schema_versions`, `migrations`, `policies`, `release_bindings`, `audit_events`.
