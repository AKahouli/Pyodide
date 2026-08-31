# Runtime Scope Context Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make YellowStorm stamp the canonical runtime scope identity (`x-sandbox-*` headers) onto the Code Interpreter (MCP Manus) connector's `auth_headers` on every Conversation turn (C-1) and Playbook run (D-1), so MCP Manus forwards it to the Coordinator.

**Architecture:** One new pure shared unit (`common/runtime/sandbox-scope.ts`) owns the header contract and two helpers. Two call-site integrations pass a `SandboxRuntimeContext` into the connector builders (`connector.service.findByIdsForGrpc` for Conversation, `agent.service.buildGrpcAgentsForPlaybook` for Playbook), which stamp the headers onto bindings whose connector slug is `code-interpreter`. No proto, schema, or config changes.

**Tech Stack:** NestJS (TypeScript), Jest (ts-jest, `rootDir: src`, `testRegex: .*\.spec\.ts$`). Run tests from the `back/` directory.

**Spec:** `docs/superpowers/specs/2026-08-20-runtime-scope-context-propagation-design.md`

## Global Constraints

- **All commands run from `C:/Users/Yellowsys/Desktop/YellowStorm-poc/YellowStorm/back`** (the NestJS project root; `rootDir` is `src`).
- **Run a single spec:** `npx jest <pathOrPattern>` (e.g. `npx jest sandbox-scope`).
- **Imports are relative** (repo convention, e.g. `../../common/...`), not `@common/*` aliases.
- **Connector slug constant value is exactly `code-interpreter`** (matches `worky-turn-context.service.ts:24`).
- **Header keys are exactly** (lowercase, verbatim): `x-user-id`, `x-sandbox-scope-type`, `x-sandbox-scope-id`, `x-sandbox-lane-id`, `x-node-id`, `x-node-iteration`.
- **Scope id values carry their prefix:** `conversation:<sessionId>` and `playbook:<executionId>`.
- **Merge rule:** spread existing `auth_headers` first, then set scope keys (scope keys win) — mirrors the existing `playbook-mcp` injection at `agent.service.ts:944`.
- **Do NOT modify** the existing `playbook-mcp` header injection; add the `code-interpreter` injection alongside it.
- **Commit messages:** no `Co-Authored-By` / AI-attribution trailer.
- **Branch:** work is on `feature/runtime-scope-context`.

---

### Task 1: Shared unit — `sandbox-scope.ts` (type + helpers)

**Files:**
- Create: `back/src/common/runtime/sandbox-scope.ts`
- Test: `back/src/common/runtime/sandbox-scope.spec.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (later tasks rely on these exact names/types):
  - `export const CODE_INTERPRETER_CONNECTOR_SLUG = 'code-interpreter'`
  - `export interface SandboxRuntimeContext { userId: string; scopeType: 'conversation' | 'playbook'; scopeId: string; laneId: string; nodeId?: string; iteration?: number }`
  - `export function buildSandboxScopeHeaders(ctx: SandboxRuntimeContext): Record<string, string>`
  - `export function applySandboxScopeHeaders<T extends { auth_headers?: Record<string, string> }>(bindings: T[], ctx: SandboxRuntimeContext, slugOf: (binding: T) => string | undefined): T[]`

- [ ] **Step 1: Write the failing test**

Create `back/src/common/runtime/sandbox-scope.spec.ts`:

```ts
import {
  CODE_INTERPRETER_CONNECTOR_SLUG,
  SandboxRuntimeContext,
  buildSandboxScopeHeaders,
  applySandboxScopeHeaders,
} from './sandbox-scope';

const convCtx: SandboxRuntimeContext = {
  userId: 'user-1',
  scopeType: 'conversation',
  scopeId: 'conversation:sess-1',
  laneId: 'main',
};

describe('buildSandboxScopeHeaders', () => {
  it('emits exactly the required keys for a conversation context (no optional keys)', () => {
    expect(buildSandboxScopeHeaders(convCtx)).toEqual({
      'x-user-id': 'user-1',
      'x-sandbox-scope-type': 'conversation',
      'x-sandbox-scope-id': 'conversation:sess-1',
      'x-sandbox-lane-id': 'main',
    });
  });

  it('emits x-node-id and stringified x-node-iteration when present', () => {
    const headers = buildSandboxScopeHeaders({
      ...convCtx,
      scopeType: 'playbook',
      scopeId: 'playbook:exec-9',
      nodeId: 'node-A',
      iteration: 0,
    });
    expect(headers['x-node-id']).toBe('node-A');
    expect(headers['x-node-iteration']).toBe('0');
  });
});

describe('applySandboxScopeHeaders', () => {
  const slugOf = (b: { connector_slug?: string }) => b.connector_slug;

  it('stamps only the code-interpreter binding and leaves others byte-identical', () => {
    const other = { connector_slug: 'gmail', auth_headers: { authorization: 'Bearer x' } };
    const ci = { connector_slug: CODE_INTERPRETER_CONNECTOR_SLUG, auth_headers: {} as Record<string, string> };
    const before = JSON.stringify(other);

    applySandboxScopeHeaders([other, ci], convCtx, slugOf);

    expect(JSON.stringify(other)).toBe(before);
    expect(ci.auth_headers['x-sandbox-scope-id']).toBe('conversation:sess-1');
  });

  it('preserves existing auth_headers keys; scope keys win on collision', () => {
    const ci = {
      connector_slug: CODE_INTERPRETER_CONNECTOR_SLUG,
      auth_headers: { authorization: 'Bearer x', 'x-user-id': 'STALE' } as Record<string, string>,
    };
    applySandboxScopeHeaders([ci], convCtx, slugOf);
    expect(ci.auth_headers.authorization).toBe('Bearer x');
    expect(ci.auth_headers['x-user-id']).toBe('user-1');
  });

  it('initializes auth_headers when a matching binding has none', () => {
    const ci: { connector_slug: string; auth_headers?: Record<string, string> } = {
      connector_slug: CODE_INTERPRETER_CONNECTOR_SLUG,
    };
    applySandboxScopeHeaders([ci], convCtx, slugOf);
    expect(ci.auth_headers?.['x-sandbox-scope-type']).toBe('conversation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest sandbox-scope`
Expected: FAIL — `Cannot find module './sandbox-scope'`.

- [ ] **Step 3: Write minimal implementation**

Create `back/src/common/runtime/sandbox-scope.ts`:

```ts
/**
 * Canonical runtime scope identity forwarded to the Code Interpreter (MCP Manus)
 * connector as x-sandbox-* headers. YellowStorm originates these values; MCP Manus
 * forwards them to the Runtime Coordinator, which enforces (scopeId, laneId) ownership.
 * See docs/superpowers/specs/2026-08-20-runtime-scope-context-propagation-design.md.
 */
export const CODE_INTERPRETER_CONNECTOR_SLUG = 'code-interpreter';

export interface SandboxRuntimeContext {
  userId: string;
  scopeType: 'conversation' | 'playbook';
  /** Already prefixed, e.g. "conversation:<sessionId>" or "playbook:<executionId>". */
  scopeId: string;
  /** "main" today; parallel-lane derivation is runtime-owned. */
  laneId: string;
  nodeId?: string;
  iteration?: number;
}

/** Pure: the x-sandbox-* header map for a given context. */
export function buildSandboxScopeHeaders(ctx: SandboxRuntimeContext): Record<string, string> {
  const headers: Record<string, string> = {
    'x-user-id': ctx.userId,
    'x-sandbox-scope-type': ctx.scopeType,
    'x-sandbox-scope-id': ctx.scopeId,
    'x-sandbox-lane-id': ctx.laneId,
  };
  if (ctx.nodeId !== undefined) headers['x-node-id'] = ctx.nodeId;
  if (ctx.iteration !== undefined) headers['x-node-iteration'] = String(ctx.iteration);
  return headers;
}

/**
 * Merge scope headers into the auth_headers of every binding whose slug is the
 * code-interpreter connector. Mutates and returns `bindings`; non-matching bindings
 * are untouched. Existing headers are preserved except that scope keys win on collision.
 */
export function applySandboxScopeHeaders<T extends { auth_headers?: Record<string, string> }>(
  bindings: T[],
  ctx: SandboxRuntimeContext,
  slugOf: (binding: T) => string | undefined,
): T[] {
  const scopeHeaders = buildSandboxScopeHeaders(ctx);
  for (const binding of bindings) {
    if (slugOf(binding) !== CODE_INTERPRETER_CONNECTOR_SLUG) continue;
    binding.auth_headers = { ...(binding.auth_headers || {}), ...scopeHeaders };
  }
  return bindings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest sandbox-scope`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/runtime/sandbox-scope.ts src/common/runtime/sandbox-scope.spec.ts
git commit -m "feat(runtime): add sandbox scope context + x-sandbox header helpers"
```

---

### Task 2: Conversation integration (C-1)

**Files:**
- Modify: `back/src/modules/connector/connector.service.ts` (`findByIdsForGrpc`, ~line 228 signature; injection inside the loop after `authHeaders` is assembled, ~line 277 before the `bindings.push`)
- Modify: `back/src/modules/conversation-v2/services/conversation-v2-stream.service.ts` (`startStream`, connector resolution at lines 200-202)
- Test: `back/src/modules/connector/connector.service.spec.ts` (extend)

**Interfaces:**
- Consumes from Task 1: `SandboxRuntimeContext`, `CODE_INTERPRETER_CONNECTOR_SLUG`, `buildSandboxScopeHeaders`.
- Produces: `findByIdsForGrpc(ids: string[], userId: string, ctx?: SandboxRuntimeContext): Promise<IGrpcConnector[]>` (widened, backward-compatible — `ctx` optional).

- [ ] **Step 1: Write the failing test**

In `back/src/modules/connector/connector.service.spec.ts`, add a describe block. Match the file's existing setup for constructing the service and mocking `findByIds` / `connectorAuthService`. The assertions:

```ts
// import at top of file:
// import { SandboxRuntimeContext } from '../../common/runtime/sandbox-scope';

describe('findByIdsForGrpc — sandbox scope injection', () => {
  const ctx: SandboxRuntimeContext = {
    userId: 'user-1',
    scopeType: 'conversation',
    scopeId: 'conversation:sess-1',
    laneId: 'main',
  };

  it('stamps x-sandbox-* onto a code-interpreter connector when ctx is provided', async () => {
    // Arrange: mock findByIds to return one connector with slug 'code-interpreter'
    // and at least one enabled action (so it is not dropped), authSourceType 'none'.
    const bindings = await service.findByIdsForGrpc(['c1'], 'user-1', ctx);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].auth_headers['x-sandbox-scope-id']).toBe('conversation:sess-1');
    expect(bindings[0].auth_headers['x-sandbox-scope-type']).toBe('conversation');
    expect(bindings[0].auth_headers['x-user-id']).toBe('user-1');
  });

  it('does not stamp a non-code-interpreter connector', async () => {
    // Arrange: mock findByIds to return one connector with slug 'gmail' + an enabled action.
    const bindings = await service.findByIdsForGrpc(['c1'], 'user-1', ctx);
    expect(bindings[0].auth_headers['x-sandbox-scope-id']).toBeUndefined();
  });

  it('is unchanged when ctx is omitted (regression guard)', async () => {
    // Arrange: mock findByIds to return one 'code-interpreter' connector + enabled action.
    const bindings = await service.findByIdsForGrpc(['c1'], 'user-1');
    expect(bindings[0].auth_headers['x-sandbox-scope-id']).toBeUndefined();
  });
});
```

> Note for the implementer: reuse the existing spec's mock scaffolding for `ConnectorService` (the file already tests `findByIdsForGrpc` — see the `Code Interpreter` / `mcpServerConfig` cases around its existing describe blocks). Each connector mock needs `actions: [{ key, isEnabled: true, ... }]` and `authSourceType: 'none'` so the binding is emitted with an empty resolved `auth_headers`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest connector.service`
Expected: FAIL — `findByIdsForGrpc` ignores the 3rd arg; `x-sandbox-scope-id` is `undefined`.

- [ ] **Step 3: Implement — widen `findByIdsForGrpc` and inject**

In `connector.service.ts`:

Add the import near the other relative imports:

```ts
import {
  SandboxRuntimeContext,
  CODE_INTERPRETER_CONNECTOR_SLUG,
  buildSandboxScopeHeaders,
} from '../../common/runtime/sandbox-scope';
```

Widen the signature (line 228):

```ts
async findByIdsForGrpc(
  ids: string[],
  userId: string,
  ctx?: SandboxRuntimeContext,
): Promise<IGrpcConnector[]> {
```

Inside the loop, immediately AFTER the dynamic-headers block assigns `authHeaders` and BEFORE `bindings.push({...})` (around line 277), add:

```ts
if (ctx && connector.slug === CODE_INTERPRETER_CONNECTOR_SLUG) {
  authHeaders = { ...authHeaders, ...buildSandboxScopeHeaders(ctx) };
}
```

(`connector.slug` is available on the loop's `connector` object; the `IGrpcConnector` binding shape has no slug field, so we gate on the source connector here rather than on the binding.)

- [ ] **Step 4: Run connector tests to verify they pass**

Run: `npx jest connector.service`
Expected: PASS (new block + all existing tests).

- [ ] **Step 5: Wire the context in `startStream`**

In `conversation-v2-stream.service.ts`, add the import:

```ts
import { SandboxRuntimeContext } from '../../../common/runtime/sandbox-scope';
```

Replace the connector resolution (lines 200-202):

```ts
const runtimeContext: SandboxRuntimeContext = {
  userId,
  scopeType: 'conversation',
  scopeId: `conversation:${sessionId}`,
  laneId: 'main',
};
const connectors = req.connectorIds?.length
  ? await this.connectorService.findByIdsForGrpc(req.connectorIds, userId, runtimeContext)
  : [];
```

(`sessionId` is the product session id — the event-store / pointer `_id` — which is the correct Conversation scope id per the spec.)

- [ ] **Step 6: Typecheck / build the affected module**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new type errors from the two modified files.

- [ ] **Step 7: Run the conversation-v2 stream suite (regression)**

Run: `npx jest conversation-v2-stream`
Expected: PASS (behavior unchanged for turns without a `code-interpreter` connector).

- [ ] **Step 8: Commit**

```bash
git add src/modules/connector/connector.service.ts \
        src/modules/connector/connector.service.spec.ts \
        src/modules/conversation-v2/services/conversation-v2-stream.service.ts
git commit -m "feat(conversation): emit sandbox scope headers on code-interpreter turns (C-1)"
```

---

### Task 3: Playbook integration (D-1)

**Files:**
- Modify: `back/src/modules/agent/agent.service.ts` (`buildGrpcAgentsForPlaybook`: widen `runtimeContext` param type at line 854; add `code-interpreter` injection alongside the existing `playbook-mcp` block at ~944-951)
- Modify: `back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts` (the `buildGrpcAgentsForPlaybook(...)` call at lines 1227-1232)
- Test: `back/src/modules/agent/agent.service.spec.ts` (extend)

**Interfaces:**
- Consumes from Task 1: `SandboxRuntimeContext` (used structurally), `CODE_INTERPRETER_CONNECTOR_SLUG`, `applySandboxScopeHeaders`.
- Produces: `buildGrpcAgentsForPlaybook(userId, agentIds, fallbackModelId?, sessionId?, runtimeContext?)` where `runtimeContext` is widened to `{ tenantId?; conversationId?; correlationId?; userId?; scopeType?: 'conversation' | 'playbook'; scopeId?; laneId?; nodeId?; iteration? }`.

- [ ] **Step 1: Write the failing test**

In `back/src/modules/agent/agent.service.spec.ts`, add a describe block. Reuse the file's existing scaffolding that already exercises `buildGrpcAgentsForPlaybook` (agent repo mock returning an agent whose connectors include a `code-interpreter` connector and the `playbook-mcp` connector). Assertions:

```ts
describe('buildGrpcAgentsForPlaybook — sandbox scope injection', () => {
  it('stamps playbook scope onto the code-interpreter binding', async () => {
    const agents = await service.buildGrpcAgentsForPlaybook(
      'owner-1',
      ['agent-1'],
      undefined,
      'exec-42',
      {
        userId: 'owner-1',
        scopeType: 'playbook',
        scopeId: 'playbook:exec-42',
        laneId: 'main',
      },
    );
    const ci = agents[0].connector_bindings.find(
      (b: any) => b.connector_slug === 'code-interpreter',
    );
    expect(ci.auth_headers['x-sandbox-scope-id']).toBe('playbook:exec-42');
    expect(ci.auth_headers['x-sandbox-scope-type']).toBe('playbook');
  });

  it('leaves the existing playbook-mcp X-YellowStorm-* headers intact', async () => {
    const agents = await service.buildGrpcAgentsForPlaybook(
      'owner-1',
      ['agent-1'],
      undefined,
      'exec-42',
      { userId: 'owner-1', scopeType: 'playbook', scopeId: 'playbook:exec-42', laneId: 'main' },
    );
    const pb = agents[0].connector_bindings.find(
      (b: any) => b.connector_slug === 'playbook-mcp',
    );
    expect(pb.auth_headers['X-YellowStorm-Agent-Id']).toBeDefined();
    expect(pb.auth_headers['x-sandbox-scope-id']).toBeUndefined();
  });
});
```

> Note for the implementer: if the existing spec has no `buildGrpcAgentsForPlaybook` scaffolding to borrow, mock `agentRepository.findByIds` to return one active agent, `hydrate` to pass it through, and `buildConnectorBindings` (on `agentConnectorRuntimeService`) to return two bindings with `connector_slug` `'code-interpreter'` and `'playbook-mcp'`, each with `auth_headers: {}`. Assert on the returned `connector_bindings`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest agent.service`
Expected: FAIL — the `code-interpreter` binding has no `x-sandbox-scope-id`.

- [ ] **Step 3: Implement — widen the param type and add injection**

In `agent.service.ts`, add the import:

```ts
import {
  SandboxRuntimeContext,
  applySandboxScopeHeaders,
} from '../../common/runtime/sandbox-scope';
```

Widen the `runtimeContext` param type (line 854):

```ts
runtimeContext?: {
  tenantId?: string;
  conversationId?: string;
  correlationId?: string;
  userId?: string;
  scopeType?: 'conversation' | 'playbook';
  scopeId?: string;
  laneId?: string;
  nodeId?: string;
  iteration?: number;
},
```

Immediately AFTER the existing `for (const binding of connectorBindings) { ... 'playbook-mcp' ... }` block (ends ~line 951), add the code-interpreter injection — guarded so it is a no-op for callers that pass no scope:

```ts
if (runtimeContext?.scopeId && runtimeContext.scopeType && runtimeContext.userId && runtimeContext.laneId) {
  const scopeCtx: SandboxRuntimeContext = {
    userId: runtimeContext.userId,
    scopeType: runtimeContext.scopeType,
    scopeId: runtimeContext.scopeId,
    laneId: runtimeContext.laneId,
    nodeId: runtimeContext.nodeId,
    iteration: runtimeContext.iteration,
  };
  applySandboxScopeHeaders(
    connectorBindings as Array<{ connector_slug?: string; auth_headers?: Record<string, string> }>,
    scopeCtx,
    (b) => b.connector_slug,
  );
}
```

Do NOT touch the existing `playbook-mcp` block.

- [ ] **Step 4: Run agent tests to verify they pass**

Run: `npx jest agent.service`
Expected: PASS (new block + existing tests, including the untouched `playbook-mcp` behavior).

- [ ] **Step 5: Pass the context from the playbook run-build**

In `playbook-flow-execution.service.ts`, update the `buildGrpcAgentsForPlaybook` call (lines 1227-1232) to supply the 5th arg:

```ts
const resolved = await this.agentService.buildGrpcAgentsForPlaybook(
  normalizedOwnerId,
  [...agentIds],
  undefined,
  executionId,
  {
    userId: normalizedOwnerId,
    scopeType: 'playbook',
    scopeId: `playbook:${executionId}`,
    laneId: 'main',
  },
);
```

(`executionId` is `String(execution._id)` here; `laneId` stays `'main'` — parallel-lane derivation is runtime-owned per the spec. Per-node `nodeId` is intentionally not threaded in this sub-project because bindings are resolved once per agent, not per node, at this call site.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new type errors.

- [ ] **Step 7: Run the playbook-flow execution suite (regression)**

Run: `npx jest playbook-flow-execution`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/agent/agent.service.ts \
        src/modules/agent/agent.service.spec.ts \
        src/modules/playbook-flow/services/playbook-flow-execution.service.ts
git commit -m "feat(playbook): emit sandbox scope headers on inherited code-interpreter bindings (D-1)"
```

---

### Task 4: Full-suite regression + spec acceptance check

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `npm test`
Expected: PASS (no regressions). If unrelated pre-existing failures appear, capture them and confirm they are unrelated to the three modified modules before proceeding.

- [ ] **Step 2: Manual acceptance trace (per spec §9)**

Confirm by reading the diff (no runtime needed):
- Conversation turn with a `code-interpreter` connector → binding `auth_headers` include `x-sandbox-scope-type=conversation`, `x-sandbox-scope-id=conversation:<sessionId>`, `x-sandbox-lane-id=main`, `x-user-id`.
- Playbook run → inherited `code-interpreter` binding includes `x-sandbox-scope-id=playbook:<executionId>`.
- Two different `sessionId`s produce two different `scopeId`s (distinct-scope isolation enabler).
- `playbook-mcp` binding and non-CI connectors are unchanged.

- [ ] **Step 3: Commit (only if any doc/status tweak was needed; otherwise skip)**

```bash
git commit --allow-empty -m "test(runtime): verify sandbox scope propagation acceptance (C-1/D-1)"
```

---

## Self-Review

**Spec coverage:**
- §3 header contract → Task 1 (`buildSandboxScopeHeaders`). ✔
- §4.1 shared unit → Task 1. ✔
- §4.2 Conversation (C-1) → Task 2. ✔
- §4.3 Playbook (D-1) → Task 3. ✔
- §6 edge cases (no-CI no-op, ctx-omitted unchanged, collision→scope wins, playbook-mcp untouched) → Task 1 tests + Task 2 regression test + Task 3 playbook-mcp test. ✔
- §7 testing → Tasks 1-4. ✔
- §9 acceptance → Task 4. ✔
- Non-goals (publication/downloads/leases/lanes/D-4) → correctly absent. ✔

**Placeholder scan:** No TBD/TODO; all code steps include full code. The two "Note for the implementer" callouts point at existing spec scaffolding to reuse rather than leaving test bodies blank — the assertions themselves are fully written. ✔

**Type consistency:** `SandboxRuntimeContext`, `CODE_INTERPRETER_CONNECTOR_SLUG`, `buildSandboxScopeHeaders`, `applySandboxScopeHeaders` names and signatures are identical across Tasks 1→2→3. `findByIdsForGrpc(ids, userId, ctx?)` and the widened `runtimeContext` param match their call sites. ✔
