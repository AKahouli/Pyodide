# Runtime Scope Context Propagation — Design Spec

**Date:** 2026-08-20
**Status:** Approved design, pending spec review
**Sub-project:** 1 of N in the YellowStorm CubeSandbox/MCP-Manus remediation
**Source plans:** `docs/YS_REMIDATION_PLAN.md` (§C-1, §D-1, §1.1, §1.2, §2), `docs/CUBE_SANDBOX_REMIDATION_.md` (§6, §7, §42, §43, Phase 1)

---

## 1. Purpose

Make YellowStorm originate the **canonical runtime scope identity** for every agent turn
that carries the Code Interpreter (MCP Manus) connector, and stamp it into that connector's
`auth_headers` so MCP Manus forwards it downstream as `x-sandbox-*` HTTP headers. This is the
Phase-1 "enabling" P0 that all later remediation work (publication, downloads, leases) depends
on — without it the Coordinator returns 422/403 on runtime routes.

This sub-project covers **C-1** (Conversation scope) and **D-1** (Playbook scope) only. It is the
emit side of the contract; MCP Manus (separate repo) forwards the headers, and the Coordinator
(done) enforces them.

### Non-goals (explicitly deferred to later sub-projects)
- C-3 / D-3 publication adapters (WorkspaceDocument / FlowTaskResult.artifacts hardening).
- C-4 / §6 download hardening (signed URLs).
- C-5 lease lifecycle (store/release `leaseId`).
- C-6 / D-8 runtime input updates, D-6 Input Manifest.
- D-2 parallel lane derivation and D-4 artifact-commit gate — both **runtime-owned** (the Python
  playbook runtime schedules nodes; the Node backend cannot enforce them). We emit `laneId="main"`
  and, where available, `x-node-id`; anything beyond that is out of scope here.

---

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sequencing | Foundational first: C-1 + D-1 only | Smallest safe increment; everything else depends on it. |
| Transport | Inject `x-sandbox-*` into the connector's `auth_headers` map | No proto change; mirrors the existing `playbook-mcp` precedent (`agent.service.ts:944`); directly produces the HTTP headers MCP Manus forwards. |
| Rollout | Always on (no feature flag) | Extra headers are inert if downstream ignores them; avoids flag plumbing. |

---

## 3. Contract (fixed by the Coordinator — spec §1.1/§1.2)

Header keys stamped onto the `code-interpreter` binding's `auth_headers`:

```
x-user-id             = <userId>
x-sandbox-scope-type  = "conversation" | "playbook"
x-sandbox-scope-id    = "conversation:<sessionId>" | "playbook:<executionId>"
x-sandbox-lane-id     = "main"                       (this sub-project)
x-node-id             = <nodeId>      (optional, playbook, when building per-node bindings)
x-node-iteration      = <iteration>   (optional, playbook, when available)
```

Scope id formats (spec §1.1) — note the `conversation:` / `playbook:` prefix is part of the value:
- Conversation `scopeId = "conversation:" + String(session._id)` — the **product session `_id`**,
  NOT `aiSessionId`.
- Playbook `scopeId = "playbook:" + executionId` where `executionId = String(execution._id)`.

---

## 4. Architecture

Single choke point + two thin call-site integrations.

```
                    ┌─────────────────────────────────────────────┐
                    │ common/runtime/sandbox-scope.ts (new)        │
                    │  - CODE_INTERPRETER_CONNECTOR_SLUG           │
                    │  - SandboxRuntimeContext (type)              │
                    │  - buildSandboxScopeHeaders(ctx)  → headers  │
                    │  - applySandboxScopeHeaders(bindings, ctx)   │
                    └─────────────────────────────────────────────┘
                          ▲                              ▲
        Conversation (C-1)│                              │Playbook (D-1)
   connector.service.ts   │                              │  agent.service.ts
   findByIdsForGrpc()      │                             │  buildGrpcAgentsForPlaybook()
   (gate on connector.slug)│                             │  (gate on binding.connector_slug)
```

### 4.1 New shared unit — `back/src/common/runtime/sandbox-scope.ts`

Purpose: own the header contract in exactly one place; pure and unit-testable.

```ts
export const CODE_INTERPRETER_CONNECTOR_SLUG = 'code-interpreter';

export interface SandboxRuntimeContext {
  userId: string;
  scopeType: 'conversation' | 'playbook';
  scopeId: string;      // already prefixed, e.g. "conversation:<id>"
  laneId: string;       // "main" for this sub-project
  nodeId?: string;
  iteration?: number;
}

/** Pure: the x-sandbox-* header map for a given context. */
export function buildSandboxScopeHeaders(ctx: SandboxRuntimeContext): Record<string, string>;

/**
 * Merge scope headers into the auth_headers of every binding whose slug is the
 * code-interpreter connector. Mutates/returns bindings; non-CI bindings untouched.
 * `slugOf` lets callers supply the slug when the binding shape doesn't carry it.
 */
export function applySandboxScopeHeaders<T extends { auth_headers?: Record<string, string> }>(
  bindings: T[],
  ctx: SandboxRuntimeContext,
  slugOf: (binding: T) => string | undefined,
): T[];
```

Header-merge rule (mirrors `agent.service.ts:944`): spread existing `auth_headers` first, then set
the `x-sandbox-*` keys — scope keys are authoritative. Optional keys (`x-node-id`,
`x-node-iteration`) are only emitted when present in the context. `x-node-iteration` is stringified.

### 4.2 Conversation integration (C-1)

- **`conversation-v2-stream.service.ts` `startStream`**: build the context immediately after the
  session is resolved and `session._id` is known:
  ```ts
  const runtimeContext: SandboxRuntimeContext = {
    userId,
    scopeType: 'conversation',
    scopeId: `conversation:${String(session._id)}`,
    laneId: 'main',
  };
  ```
  Thread it into the connector resolution call (currently
  `this.connectorService.findByIdsForGrpc(req.connectorIds, userId)`).

- **`connector.service.ts` `findByIdsForGrpc(ids, userId, ctx?)`**: widen the signature with an
  optional `ctx?: SandboxRuntimeContext`. `IGrpcConnector` has no `connector_slug` field, but
  `connector.slug` is in scope inside the loop — so gate directly:
  ```ts
  let authHeaders = { ...resolvedAuth, ...dynamicHeaders };
  if (ctx && connector.slug === CODE_INTERPRETER_CONNECTOR_SLUG) {
    authHeaders = { ...authHeaders, ...buildSandboxScopeHeaders(ctx) };
  }
  ```
  When `ctx` is omitted (all other callers), behaviour is unchanged.

### 4.3 Playbook integration (D-1)

- **`playbook-flow-execution.service.ts`**: at the `buildGrpcAgentsForPlaybook(...)` call
  (~line 1227), pass a scope context:
  ```ts
  {
    // existing tracing fields preserved:
    tenantId, conversationId, correlationId,
    // new scope fields:
    userId: ownerId,
    scopeType: 'playbook',
    scopeId: `playbook:${executionId}`,
    laneId: 'main',
  }
  ```
- **`agent.service.ts` `buildGrpcAgentsForPlaybook`**: widen the `runtimeContext` param type from
  `{ tenantId?; conversationId?; correlationId? }` to additionally carry
  `{ userId?; scopeType?; scopeId?; laneId?; nodeId?; iteration? }` (all optional to preserve
  existing callers). The existing `playbook-mcp` header injection (`:944-951`) stays **exactly
  as-is**. Add a parallel injection for the `code-interpreter` slug using
  `applySandboxScopeHeaders(connectorBindings, ctx, b => b.connector_slug)` — the playbook binding
  shape (`agent-connector-runtime.service.ts:200`) does carry `connector_slug`. Only run the new
  injection when `runtimeContext.scopeId` is present.
- Where per-node bindings are built (`buildNodeRuntimeAgentMetadata`), pass `nodeId` into the
  context so `x-node-id` is emitted; `laneId` stays `"main"`.

---

## 5. Data flow

**Conversation turn:**
```
startStream(session) → ctx{conversation:<_id>, main} → findByIdsForGrpc(ids, userId, ctx)
  → per connector: if slug==code-interpreter, merge x-sandbox-* into auth_headers
  → grpcClient.chat(ChatRequest{ connectors:[…binding.auth_headers…] })
  → (MCP Manus forwards headers → Coordinator)
```

**Playbook run:**
```
execution.service run-build → ctx{playbook:<executionId>, main} → buildGrpcAgentsForPlaybook(..., ctx)
  → applySandboxScopeHeaders(bindings, ctx, slug) on code-interpreter bindings
  → RunRequest snapshot (per-node connector_bindings carry x-sandbox-* in auth_headers)
  → (Python runtime → MCP Manus forwards → Coordinator)
```

---

## 6. Error handling & edge cases

- **No code-interpreter connector on the turn:** helper is a no-op; nothing is stamped. Correct —
  non-runtime turns need no scope.
- **`ctx` omitted (legacy/other callers of `findByIdsForGrpc`):** unchanged behaviour, no headers.
- **Header collision:** `x-sandbox-*` / `x-user-id` are reserved namespaces unlikely to collide
  with resolved auth; on collision the scope value wins (spread-last), matching the `playbook-mcp`
  precedent. Documented in the helper.
- **Missing `session._id` / `executionId`:** these are always present at the call sites (the session
  and execution are already persisted). No defensive fallback that would emit a malformed scope;
  if absent it is a programming error surfaced by tests, not silently defaulted.
- **`playbook-mcp` unaffected:** its existing headers and injection path are untouched; a test locks
  this in.

---

## 7. Testing (TDD — tests first)

Unit tests only (downstream MCP Manus/Coordinator are out of this repo; emit side is fully
unit-verifiable).

`back/src/common/runtime/sandbox-scope.spec.ts`:
1. `buildSandboxScopeHeaders` returns exactly the required keys for a conversation context; no
   optional keys when `nodeId`/`iteration` absent.
2. Emits `x-node-id` / `x-node-iteration` (stringified) when present.
3. `applySandboxScopeHeaders` stamps only bindings whose slug matches; leaves others byte-identical.
4. Existing `auth_headers` keys are preserved; scope keys win on collision.

`connector.service.spec.ts` (extend):
5. With a `ctx`, a `code-interpreter` connector binding gains the `x-sandbox-*` headers with
   `conversation:<id>` scope; a non-CI connector does not.
6. Without a `ctx`, output is unchanged (regression guard for existing callers).

`agent.service.spec.ts` (extend) / playbook build test:
7. `buildGrpcAgentsForPlaybook` with a playbook scope context stamps `playbook:<executionId>` onto
   the `code-interpreter` binding.
8. The existing `playbook-mcp` `X-YellowStorm-*` headers are still present and unchanged.

Run the module's existing suite to confirm no regressions.

---

## 8. Files touched

| File | Change |
|------|--------|
| `back/src/common/runtime/sandbox-scope.ts` | **new** — type + helpers |
| `back/src/common/runtime/sandbox-scope.spec.ts` | **new** — unit tests |
| `back/src/modules/connector/connector.service.ts` | widen `findByIdsForGrpc` with optional `ctx`; slug-gated injection |
| `back/src/modules/conversation-v2/services/conversation-v2-stream.service.ts` | build conversation `ctx`, pass to `findByIdsForGrpc` |
| `back/src/modules/agent/agent.service.ts` | widen `runtimeContext` type; add `code-interpreter` injection |
| `back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts` | build playbook `ctx`, pass to `buildGrpcAgentsForPlaybook` |
| relevant `*.spec.ts` | extend per §7 |

No proto changes. No schema/migration changes. No new config.

---

## 9. Acceptance

- A Conversation turn carrying the `code-interpreter` connector emits
  `x-sandbox-scope-type=conversation`, `x-sandbox-scope-id=conversation:<session._id>`,
  `x-sandbox-lane-id=main`, `x-user-id` on that binding's `auth_headers`.
- A Playbook run emits the same shape with `playbook:<executionId>` scope on inherited
  `code-interpreter` bindings.
- Two Conversations for the same user carry **distinct** `scopeId`s (enables the Coordinator's
  isolation guarantee — spec acceptance C1).
- Non-CI connectors and the `playbook-mcp` binding are unchanged.
- All existing tests pass.
