# Branch Audit — feat/app-data-005

**Date:** 2026-09-10
**Scope:** Full branch diff vs `main` — 61 files, ~3005 insertions, ~1998 deletions
**Commits:** `94f0b1e6e feat(app-data): data persist app-builder`, `d5b67c1c9 feat(app-data): fixes app-data`

---

## Executive Summary

This branch delivers three major capabilities: (1) the **remote mode** — switching the App Data module from local Postgres to HTTP-proxied microservice calls, (2) a **seed UI** in the owner Data tab, and (3) **planner simplification** + connector tool schema improvements in the ADK. It also deletes ~700 lines of dead WhatsApp internal send code and the MCP JWT util. The changes are well-structured and the module-level toggle pattern is clean, but the diff introduces several architectural concerns, duplicated logic, and some risky behavior changes.

**Total findings: 18** (2 Critical, 5 High, 7 Medium, 4 Low)

---

## 1. What Changed

### 1.1 Backend — App Data Remote Mode (20 new/changed files)

| File | Change |
|------|--------|
| `app-data.module.ts` | Local/remote toggle via `APP_DATA_REMOTE` env; conditional controller/provider registration |
| `app-data-client.service.ts` | **New** (438 lines) — HTTP client for the microservice internal API |
| `remote-app-data-mcp-dispatcher.service.ts` | **New** (447 lines) — Remote MCP dispatcher, delegates tool calls via `AppDataClientService` |
| `remote-app-data-deployment.service.ts` | **New** (91 lines) — Remote deployment service |
| `remote-app-data-release-binding.service.ts` | **New** (49 lines) — Remote release binding |
| `controllers/remote/app-data-remote-owner.controller.ts` | **New** (262 lines) — Remote owner Data tab |
| `controllers/remote/app-data-remote-health.controller.ts` | **New** (38 lines) — Remote health endpoint |
| `services/app-data-client.service.spec.ts` | **New** (174 lines) — Unit tests for client service |
| `services/remote-app-data-mcp-dispatcher.service.spec.ts` | **New** (176 lines) — Unit tests for remote dispatcher |
| `utils/app-data-sql.util.ts` | New `normalizeSchemaManifest()` — LLM manifest repair |
| `utils/app-data-sql.util.spec.ts` | **New** (70 lines) — Tests for manifest normalization |
| `mcp/app-data-mcp.tools.ts` | New `seed` tool schema + fully-described manifest JSON Schema |
| `app-data-mcp-dispatcher.service.ts` | `seed` tool implementation + `normalizeSchemaManifest` integration |
| `constants/app-data.errors.ts` | New `REMOTE_UNAVAILABLE` error code |

### 1.2 Backend — Seed Feature

| File | Change |
|------|--------|
| `app-data-mcp.tools.ts` | `seed` tool added to tool names, descriptions, schemas |
| `app-data-mcp-dispatcher.service.ts` | `seed` case in `dispatchTool` — local per-row insert with 23505 handling |
| `controllers/remote/app-data-remote-owner.controller.ts` | `POST :environment/seed` endpoint |
| `controllers/app-data-owner.controller.ts` | `POST :environment/seed` endpoint (local) |

### 1.3 Backend — Config & Infrastructure

| File | Change |
|------|--------|
| `config/app-data.config.ts` | 7 new env vars for remote mode |
| `config/config.schema.ts` | Joi validation for new env vars + removed WhatsApp MCP config vars |
| `main.ts` | Added `import 'dotenv/config'` at top; changed unhandledRejection to `void shutdown('unhandledRejection')` |
| `app.module.ts` | Removed `whatsappMcpConfig` from config load array |
| `config/index.ts` | Removed `whatsappMcpConfig` export |
| `config/whatsapp-mcp.config.ts` | **Deleted** |
| `config/whatsapp.config.ts` | Removed `internalSendRateLimitPerMinute` |

### 1.4 Backend — Starter Revision v5

| File | Change |
|------|--------|
| `starter_react_vite_v5.ts` | **New** (159 lines) — New starter template with App Data support |
| `starter-revisions.ts` | v5 registered as default; v4 remains available |
| `app-runtime-binding.schema.ts` | Default `latestRevisionId` changed from v4 to v5 |

### 1.5 Backend — WhatsApp Cleanup (~700 lines deleted)

| File | Change |
|------|--------|
| `whatsapp-internal.controller.ts` | **Deleted** — service-to-service send endpoint |
| `whatsapp-internal.controller.spec.ts` | **Deleted** |
| `whatsapp-internal-send.service.ts` | **Deleted** (204 lines) — internal send + rate limiting |
| `whatsapp-internal-send.service.spec.ts` | **Deleted** (233 lines) |
| `internal-whatsapp-send.dto.ts` | **Deleted** |
| `internal-whatsapp-status.dto.ts` | **Deleted** |
| `whatsapp-chat-binding.schema.ts` | Removed `lastInboundText` field |
| `whatsapp-message.service.ts` | Removed `captureSelfChatText`, removed `selfJids` param, simplified fromMe handling |
| `whatsapp-message.service.spec.ts` | Removed 187 lines of self-chat tests |
| `whatsapp-session.manager.ts` | Removed `sendAgentMessage`, simplified `sendReply`, removed `botSentMessageIds` |
| `whatsapp.module.ts` | Removed internal controller + service from providers |
| `agent-mcp-jwt.util.ts` | **Deleted** — RS256 JWT signer |
| `agent-mcp-jwt.util.spec.ts` | **Deleted** |
| `http.exceptions.ts` | **Deleted** (10 lines) |
| `agent.service.ts` | Removed `agentId` param from `buildConnectorBindings` chain |
| `agent-connector-runtime.service.ts` | Removed `agentId` param (empty diff — param was unused) |

### 1.6 Frontend

| File | Change |
|------|--------|
| `api.ts` | New `SeedResult` type + `getAppDataTicket` + `seedAppData` endpoints |
| `AppDataPanel.tsx` | Seed UI: JSON textarea, apply button, error/result display |
| `locales/en.json` + `fr.json` | 7 new seed-related translation keys |
| `BrowserRuntimeHost.ts` | Owner data ticket relay: `acquireAppDataTicket`, `appDataIdFromUrl`, enhanced `isAppDataPublicUrl`, retry on 401 |
| `NodepodRuntimeAdapter.ts` | Kill stale dev process before restart (`currentDevProc`) |
| `preview-wrapper.html` | Accept `/v1/apps/` URLs (direct microservice) in proxy relay |
| `BrowserRuntimeHost.test.ts` | 5 new tests for `isAppDataPublicUrl` |

### 1.7 ADK (Python)

| File | Change |
|------|--------|
| `service.py` | Planner simplified: removed two-pass (structured + prompt) fallback, removed `_PLANNER_JSON_REMINDER`, always uses `output_schema=_PlannerOutput` |
| `langchain_factory.py` | New `_coerce_action_parameter_schema` (JSON string decode), `_format_schema_for_tool_description` (embed schema in tool desc), `workspace_id` conditional injection, null-field stripping |
| `test_service.py` | Removed 67 lines of schema-aware planner tests |

---

## 2. Critical Findings

### C1 — `main.ts` Unhandled Rejection Changed to Shutdown

**File:** `main.ts:245`

```typescript
// Before:
// Do not shut down: Baileys regularly raises transient internal "Timed Out"
// rejections ... Log loudly and keep serving.
// After:
void shutdown('unhandledRejection');
```

The previous code intentionally logged unhandled rejections without shutting down — Baileys WhatsApp sessions generate transient rejections during reconnection. The new code calls `shutdown('unhandledRejection')` which will terminate the process.

**Impact:** Production instances may crash during WhatsApp reconnections. Any unhandled promise rejection (including transient third-party library errors) now kills the server.

**Fix:** Restore the log-only behavior, or narrow the scope to only fatal rejection categories. If the intent was to catch the app-data related rejections, use a targeted handler.

---

### C2 — `dotenv/config` Import at Static Module Load Time

**File:** `main.ts:1`

```typescript
// Must stay the FIRST import: several modules read process.env at static
// import time (e.g. AppDataModule's controller selection) — before
// ConfigModule.forRoot() loads the same file later during bootstrap.
import 'dotenv/config';
```

This forces `dotenv` to load before NestJS bootstrap, so `process.env` is populated at static import time. The App Data module uses this:

```typescript
const APP_DATA_USE_REMOTE = process.env.APP_DATA_REMOTE === 'true';
```

This evaluates at module import time — before NestJS `ConfigModule` runs validation. If `APP_DATA_REMOTE` is set to an invalid value (e.g., `"yes"`, `"1"`, `"TRUE"`), the module silently falls back to local mode with no warning.

**Impact:** Misconfiguration goes undetected; no validation on the remote toggle; the module selects a provider set at import time and never re-evaluates.

**Fix:** Either add explicit validation (`process.env.APP_DATA_REMOTE === 'true' || process.env.APP_DATA_REMOTE === 'false'`) or use NestJS `ConfigModule.forRoot({ isGlobal: true })` with dynamic module registration instead of static process.env reads.

---

## 3. High Findings

### H1 — `RemoteAppDataMcpDispatcherService` Duplicates `AppDataMcpDispatcherService` Seed Logic

**Files:** `remote-app-data-mcp-dispatcher.service.ts:347-374` vs `app-data-mcp-dispatcher.service.ts:288-343`

Both dispatchers have a `seed` case that:
1. Validates the `tables` argument
2. Iterates table entries
3. Inserts rows
4. Returns `{ environment, message, total, inserted, skipped, tables }`

The remote version delegates to `client.seedRows()`, while the local version inserts row-by-row. However, the input validation, table iteration, and response shape are nearly identical — ~40 lines duplicated.

**Impact:** DRY violation; any change to seed behavior must be synchronized between two files.

**Fix:** Extract the shared validation and response shape into a helper, or have the local dispatcher use a similar `seedRows` abstraction.

---

### H2 — `safeSqlDefault` and `SAFE_SQL_DEFAULTS` Duplicated

**Files:** `remote-app-data-mcp-dispatcher.service.ts:64-89` vs `app-data-sql.util.ts`

The remote dispatcher defines its own `SAFE_SQL_DEFAULTS` regex and `safeSqlDefault()` function. This same pattern was extracted to `app-data-sql.util.ts` for the local mode (fix H1 from previous audit). But the remote dispatcher still has its own copy.

**Impact:** Divergence risk; two implementations of the same safety check.

**Fix:** Import from `app-data-sql.util.ts` in the remote dispatcher.

---

### H3 — `seed` Tool in Local Dispatcher Inserts Row-by-Row

**File:** `app-data-mcp-dispatcher.service.ts:291-343`

The local seed implementation inserts one row at a time in a for loop:

```typescript
for (const row of rows as Record<string, unknown>[]) {
  const { id: explicitId, ...rest } = row ?? {};
  try {
    await this.rows.insertRow({ ... });
    inserted++;
  } catch (err) { ... }
}
```

For a 100-row seed, this is 100 sequential DB round-trips. The remote version delegates to `client.seedRows()` which presumably batches.

**Impact:** Performance cliff for large seeds in local mode; timeout risk on production databases.

**Fix:** Batch inserts in a single transaction, or use `INSERT INTO ... VALUES (...), (...), ...`.

---

### H4 — `nodepod/dev-server:spawn` Kill-Then-Respawn Race

**File:** `NodepodRuntimeAdapter.ts:326-337`

```typescript
if (this.currentDevProc) {
  try {
    this.currentDevProc.kill();
  } catch {
    // Already exited between the check and the kill.
  }
  this.currentDevProc = null;
}
```

The kill is fire-and-forget — the code immediately proceeds to spawn a new process without waiting for the old one to exit. If the old process takes time to release the port, the new Vite process may fail to bind.

**Impact:** Intermittent dev-server startup failures; stale process holding port 5173.

**Fix:** Wait for the old process `exit` event before spawning, or add a short delay/port-check.

---

### H5 — `BrowserRuntimeHost` Ticket Fetcher Leaks to Next Host Instance

**File:** `BrowserRuntimeHost.ts:30-44`

```typescript
let appDataTicketFetcher: AppDataTicketFetcher | null = null;

export function setAppDataTicketFetcher(fetcher: AppDataTicketFetcher | null): void {
  appDataTicketFetcher = fetcher;
}
```

This is a module-level variable set by `BrowserRuntimeHost.start()`. If a host is destroyed and a new one starts, the old fetcher is replaced — but if two hosts briefly overlap (e.g., during a session switch), both write to the same module-level variable. The comment acknowledges this ("keyed by appDataId so two concurrently open previews can never swap tickets"), but the `setAppDataTicketFetcher` function is module-scoped, not instance-scoped.

**Impact:** Low risk due to appDataId-keyed caching, but the architectural pattern is fragile — a second host instance silently overwrites the fetcher.

**Fix:** Make the fetcher instance-scoped, or use a WeakMap keyed by host instance.

---

### H6 — `preview-wrapper.html` Indentation Broken

**File:** `preview-wrapper.html:73-79`

```javascript
iw.fetch = function (input, init) {
var url = typeof input === 'string' ? input : (input && input.url) || '';
var isAppDataUrl =
  url.indexOf('/app-data/public/') !== -1 || url.indexOf('/v1/apps/') === 0;
if (isAppDataUrl && init && init.body) {
```

The `var url` and `var isAppDataUrl` lines lost their indentation inside the function body. This is a copy-paste artifact.

**Impact:** No runtime impact (JS ignores whitespace), but the code is harder to read and维护.

**Fix:** Restore proper indentation.

---

## 4. Medium Findings

### M1 — `normalizeSchemaManifest` Silently Drops Malformed Entries (Carried Forward)

**File:** `app-data-sql.util.ts:144-195`

Non-object table entries are silently discarded. The caller receives no indication of data loss. This was identified as M4 in the previous audit and not yet fixed.

**Impact:** Schema applied with fewer tables than intended.

**Fix:** Return dropped entries in the `warnings` array.

---

### M2 — `mapUpstreamError` Maps All 409 to `EMAIL_TAKEN` (Carried Forward)

**File:** `app-data-client.service.ts:406-429`

```typescript
case HttpStatus.CONFLICT:
  return new AppDataException(AppDataErrorCode.EMAIL_TAKEN, message, HttpStatus.CONFLICT);
```

A 409 from the microservice could be a schema version conflict, unique constraint violation, or any other conflict — not just email taken.

**Impact:** Incorrect error code propagated; callers may handle the wrong error case.

**Fix:** Parse upstream body for the specific `appDataCode`, or use a generic `CONFLICT` code.

---

### M3 — `throwUpstreamError` Exported But Unused in Module (Carried Forward)

**File:** `app-data-client.service.ts:436-438`

Exported helper function `throwUpstreamError` is not imported anywhere in the module.

**Impact:** Dead code.

**Fix:** Remove or verify callers.

---

### M4 — `AppDataMcpAuthService` Is a Trivial Wrapper (Carried Forward)

**File:** `app-data-mcp-auth.service.ts`

12-line pass-through service registered in both LOCAL_PROVIDERS and REMOTE_PROVIDERS.

**Impact:** Unnecessary indirection.

**Fix:** Inline or add meaningful logic.

---

### M5 — Local Seed Error Handling Differs From Remote

**Files:** `app-data-mcp-dispatcher.service.ts:306-319` vs remote microservice

Local seed catches `23505` per-row and counts as skipped. Remote seed delegates to `client.seedRows()` which handles this server-side. If the microservice's behavior diverges, seed results will differ.

**Impact:** Inconsistent seed behavior between modes.

**Fix:** Document the contract; add integration tests for parity.

---

### M6 — `workspaceId()` Does N+1 Query Pattern (Carried Forward)

**File:** `app-data-remote-owner.controller.ts:57-63`

Every endpoint calls `workspaceId()` then `requireRemoteAppId()`, resulting in 2+ DB/microservice calls per request.

**Impact:** Latency multiplier on every request.

**Fix:** Combine into a single lookup or cache per request scope.

---

### M7 — `schema_get` Remote Returns Incomplete Data (Carried Forward)

**File:** `remote-app-data-mcp-dispatcher.service.ts:253-263`

Remote `schema_get` returns only table names (no column definitions). Agent code generation relying on column info will fail silently.

**Impact:** Agent generates code with wrong column types/names.

**Fix:** Add column introspection to microservice, or make limitation explicit (done in tool description, but not in the MCP tool return value to the model).

---

## 5. Low Findings

### L1 — `main.ts` UnhandledRejection Comment Mismatch

**File:** `main.ts:242-245`

The comment says "Do not shut down" was the previous behavior, but the code now calls `void shutdown(...)`. The deleted comment is no longer accurate documentation.

**Impact:** Confusing for maintainers.

---

### L2 — `preview-wrapper.html` Indentation Lost

**File:** `preview-wrapper.html:73-79`

Indentation inside the fetch override function body was lost during the edit.

**Impact:** Readability only.

---

### L3 — `starter_react_vite_v5.ts` Default Starter Changed Without Migration

**File:** `starter-revisions.ts:69-70`, `app-runtime-binding.schema.ts:44`

New bindings default to v5, but existing v4 bindings are not migrated. This is probably intentional (backward compatible), but the schema change should be documented.

**Impact:** Existing bindings remain on v4; new bindings use v5.

---

### L4 — WhatsApp Cleanup Removes `lastInboundText` Schema Field

**File:** `whatsapp-chat-binding.schema.ts:29-32`

The `lastInboundText` field is removed from the schema. Existing MongoDB documents may still have this field (MongoDB is schemaless). Mongoose won't remove it unless explicitly cleaned.

**Impact:** Stale data in existing documents; no functional impact.

---

## 6. Architectural Observations

### 6.1 Module-Level Toggle Pattern

```typescript
const APP_DATA_USE_REMOTE = process.env.APP_DATA_REMOTE === 'true';
// ...
controllers: APP_DATA_USE_REMOTE ? REMOTE_CONTROLLERS : LOCAL_CONTROLLERS,
```

This is evaluated once at import time. The alternative — NestJS `ConfigModule.forRoot()` with dynamic module registration — would allow runtime reconfiguration but adds complexity. The current approach is fine for a feature flag that doesn't change at runtime, but the `dotenv/config` import requirement is a code smell.

### 6.2 Remote Mode Architecture

The remote architecture is clean:
- `AppDataClientService` — thin HTTP client, no business logic
- `RemoteAppDataMcpDispatcherService` — mirrors the local dispatcher's tool interface
- `RemoteAppDataDeploymentService` / `RemoteAppDataReleaseBindingService` — thin wrappers

The DI token aliasing pattern (`{ provide: AppDataMcpDispatcherService, useClass: RemoteAppDataMcpDispatcherService }`) is idiomatic NestJS.

### 6.3 WhatsApp Cleanup

The WhatsApp internal send endpoint, MCP JWT util, and self-chat capture logic were cleanly removed. The `agent.service.ts` param removal was handled correctly. The `whatsapp-session.manager.ts` simplification is good — fewer moving parts.

### 6.4 ADK Planner Simplification

The removal of the two-pass (structured + prompt) planner fallback simplifies the code significantly (~60 lines removed). The planner now always uses `output_schema=_PlannerOutput`. This assumes all providers support structured output — if a model doesn't, the run will fail. This is a reasonable tradeoff given the complexity the fallback introduced.

### 6.5 Connector Tool Schema Improvements

The `_coerce_action_parameter_schema` function handles the protobuf overflow issue (deeply nested MCP schemas). The `_format_schema_for_tool_description` function injects the full schema into the tool description so the model can see nested key names. The `workspace_id` conditional injection avoids sending unexpected keys to third-party MCP servers. The null-field stripping prevents FastMCP strict-mode rejections.

These are all well-motivated fixes for real production issues.

---

## 7. Security Summary

| Category | Status | Notes |
|----------|--------|-------|
| SQL Injection | ✅ | `SET statement_timeout` parameterized (fix from prior audit) |
| Rate Limiting | ✅ | `@RateLimit` added to MCP controller (fix from prior audit) |
| Auth Failures | ✅ | Audit logging added for failed logins (fix from prior audit) |
| Error Leakage | ✅ | `sanitizeUpstreamError` applied (fix from prior audit) |
| New: Process Crash | ❌ | `void shutdown('unhandledRejection')` — C1 |
| New: Config Validation | ⚠️ | `APP_DATA_REMOTE` not validated — C2 |
| New: Stale Process | ⚠️ | Dev server kill-before-respawn race — H4 |
| WhatsApp | ✅ | Internal send surface fully removed |

---

## 8. Prioritized Remediation Strategy

### Phase 1 — Critical (Immediate)

| ID | Action | Effort | Risk |
|----|--------|--------|------|
| C1 | Revert `void shutdown('unhandledRejection')` to log-only or narrow scope | 15 min | Production crash |
| C2 | Validate `APP_DATA_REMOTE` env value at startup (must be `'true'`, `'false'`, or unset) | 15 min | Silent misconfiguration |

### Phase 2 — High (This Sprint)

| ID | Action | Effort | Risk |
|----|--------|--------|------|
| H1 | Extract shared seed validation/response shape | 1 hr | DRY violation |
| H2 | Import `safeSqlDefault` from `app-data-sql.util` in remote dispatcher | 15 min | Divergence risk |
| H3 | Batch local seed inserts | 2 hrs | Performance cliff |
| H4 | Wait for old dev process exit before respawn | 1 hr | Port conflict |
| H5 | Make ticket fetcher instance-scoped | 30 min | Fragile pattern |
| H6 | Fix `preview-wrapper.html` indentation | 5 min | Readability |

### Phase 3 — Medium (Next Sprint)

| ID | Action | Effort | Risk |
|----|--------|--------|------|
| M1 | Return dropped entries in `normalizeSchemaManifest` warnings | 30 min | Silent data loss |
| M2 | Propagate upstream `appDataCode` in error mapping | 1 hr | Error accuracy |
| M3 | Remove or use `throwUpstreamError` | 10 min | Dead code |
| M4 | Inline or remove `AppDataMcpAuthService` wrapper | 30 min | Unnecessary indirection |
| M5 | Document seed behavioral parity | 30 min | Behavioral drift |
| M6 | Combine session→app lookup | 1 hr | Performance |
| M7 | Add column introspection to microservice or improve tool description | 2 hrs | Agent confusion |

---

## 9. Files Summary

### New Files (8)
- `services/app-data-client.service.ts` (438 lines)
- `services/remote-app-data-mcp-dispatcher.service.ts` (447 lines)
- `services/remote-app-data-deployment.service.ts` (91 lines)
- `services/remote-app-data-release-binding.service.ts` (49 lines)
- `controllers/remote/app-data-remote-owner.controller.ts` (262 lines)
- `controllers/remote/app-data-remote-health.controller.ts` (38 lines)
- `services/app-data-client.service.spec.ts` (174 lines)
- `services/remote-app-data-mcp-dispatcher.service.spec.ts` (176 lines)
- `utils/app-data-sql.util.spec.ts` (70 lines)
- `app-runtime/constants/starter_react_vite_v5.ts` (159 lines)

### Deleted Files (8)
- `config/whatsapp-mcp.config.ts`
- `common/runtime/agent-mcp-jwt.util.ts`
- `common/runtime/agent-mcp-jwt.util.spec.ts`
- `whatsapp/controllers/whatsapp-internal.controller.ts`
- `whatsapp/controllers/whatsapp-internal.controller.spec.ts`
- `whatsapp/services/whatsapp-internal-send.service.ts`
- `whatsapp/services/whatsapp-internal-send.service.spec.ts`
- `whatsapp/dto/internal-whatsapp-send.dto.ts`
- `whatsapp/dto/internal-whatsapp-status.dto.ts`
- `conversation-v2/exceptions/exceptions/http.exceptions.ts`

### Significantly Modified Files (15)
- `app-data.module.ts` — local/remote toggle
- `app-data-mcp-dispatcher.service.ts` — seed + normalize
- `app-data-mcp.tools.ts` — seed schema + manifest JSON Schema
- `app-data-sql.util.ts` — normalizeSchemaManifest
- `config/app-data.config.ts` — 7 new env vars
- `config/config.schema.ts` — validation + WhatsApp cleanup
- `main.ts` — dotenv import + unhandledRejection change
- `app-runtime/constants/starter-revisions.ts` — v5 default
- `app-runtime/schemas/app-runtime-binding.schema.ts` — v5 default
- `BrowserRuntimeHost.ts` — ticket relay + enhanced proxy
- `NodepodRuntimeAdapter.ts` — dev process management
- `preview-wrapper.html` — /v1/apps/ URL support
- `service.py` (ADK) — planner simplification
- `langchain_factory.py` (ADK) — schema improvements
- `whatsapp-session.manager.ts` — removed sendAgentMessage

---

*Audit performed by: opencode (mimo-v2.5-free)*
*Files analyzed: 61 changed files across backend, frontend, and ADK*
*Guidelines referenced: `BACKEND_GUIDELINES.md`*
