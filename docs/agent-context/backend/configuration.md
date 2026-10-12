# Bootstrap and configuration

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 4. Bootstrap (`main.ts`)

Global config applied once — **do not** re-apply per-controller:
- `helmet()` with CSP (default-src `'self'`, style-src inline, img-src `'self' data: https:`).
- `compression()` is **disabled** (commented out) — it buffers SSE responses. Do not re-enable without verifying all SSE streams.
- Body parsers use a 10 MB JSON/urlencoded limit; increase only with an endpoint-specific reason and abuse-risk review.
- `cookieParser()`, CORS (origins from `CORS_ORIGIN`, `credentials: true`).
- CORS origin resolution also reads the admin-managed MongoDB whitelist through `SystemService`; keep env and DB whitelist behavior aligned.
- URI versioning `/v1/`, global prefix `api` → `/api/v1/<resource>`.
- Global `ValidationPipe` (see [related guidance](api-contracts.md)), `SwaggerModule.setup('docs', ...)` in non-prod only.
- Nest boots with `bufferLogs: true` and then installs `LoggerService`; do not add a second logger bootstrap path.
- HTTP server timeout is 5 minutes to support long-running orchestration requests; do not lower it without checking streaming and runtime callbacks.
- Graceful shutdown on `SIGTERM`, `SIGINT`, `uncaughtException`, `unhandledRejection`.

## 5. Configuration

Every config file uses `registerAs` in `src/config/<name>.config.ts`. Inject via **typed config**:

```ts
constructor(@Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>) {}
```

Or `ConfigService` for one-off values. **Never** read `process.env` directly in services.

All env vars go through Joi validation in `src/config/config.schema.ts`. The app refuses to boot with missing required vars. Production requires `JWT_SECRET`, `ENCRYPTION_KEY`, `MONGODB_URI`, storage + email secrets.

**Root-loaded config namespaces:** `app`, `jwt`, `auth`, `microsoft`, `health`, `workspace`, `litellm`, `conversation`, `conversation-v2`, `appRuntime`, `appData`, `playbook-flow`, `grpcSecurity`, `grpcSecurityV2`, `telegram`, `whatsapp`, `worky`, `memoryCards`, `dataRoom`, `governedConversations`, `semanticModel`. Additional namespaces may be owned by feature modules; verify their `ConfigModule.forFeature(...)` registration rather than assuming root availability.

Keep `src/config/*.config.ts`, `src/config/config.schema.ts`, `src/config/index.ts`, and `ConfigModule.forRoot({ load: [...] })` in sync. A config namespace loaded in `app.module.ts` but not exported from `src/config/index.ts` is a drift smell; a file exported but not loaded is likely dead code.

The **playbook-flow** config (`src/config/playbook-flow.config.ts`) is the most extensive: gRPC URLs, execution limits, token buffer, execution lease, delta patch, async design, and concurrency controls. Any new env var in this domain must be added to both the config file and `config.schema.ts` — missing entries cause silent fallback to defaults.

gRPC TLS/security is split by runtime: `grpcSecurity` covers shared services such as conversation v1, a2a-admin, and playbook-flow; `grpcSecurityV2` covers conversation-v2/Manus. Keep API keys, TLS mode, CA paths, and server-name overrides in the matching namespace.

All config keys read in services must be declared in the corresponding `<name>.config.ts`. If you find a service reading a key that is not in the config file (e.g. `playbook-flow.maxSseConnections`), add it — do not rely on fallback defaults.

**Load lifecycle:** most namespaces are root-loaded in `app.module.ts`. A small number are feature-loaded inside the owning module's imports (currently `browserSession` in `browser-session.module.ts`). When introducing a namespace, decide explicitly whether it must be available app-wide (root-load) or only when the owning module is registered (feature-load), and document that choice at the registration site so consumers do not assume availability when the feature module is absent.

**Namespace parity (load + Joi + export):** every loaded namespace must satisfy all three: (a) every env-derived key it reads must be present in `config.schema.ts` Joi validation, (b) it must be exported from `src/config/index.ts`, (c) it must be loaded exactly once. Current debt: `browserSession` reads env keys without Joi entries, and `appRuntimeConfig`, `memoryCardsConfig`, `governedConversationsConfig`, and `browserSessionConfig` are not re-exported from the barrel. Fix this debt when touching those areas; do not treat it as an approved pattern.

`dataRoom` and `governedConversations` are rollout-gate namespaces consumed across module boundaries (governance, workspace, knowledge-intelligence). Treat their flags as cross-module contracts: changing a flag's default or removing it requires tracing every consumer, not just the owning module.
