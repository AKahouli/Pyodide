# Playbook Rewrite — Coding Guidelines

> **Scope.** Applies to the new `playbook` module (backend NestJS), `flow_engine` package (Python / LangGraph), and the playbook frontend module. Supplements — does not replace — `FRONTEND_GUIDELINES.md` and `BACKEND_GUIDELINES.md`. On any conflict, the stricter rule wins.

## 1. Non-Negotiable Principles

- **SRP** — one file, one class, one function = one reason to change. If you can describe the unit with the word "and", split it.
- **DRY** — no copy-pasted logic across modules. Extract to a service, util, or hook *the second* time a pattern appears, not the third.
- **KISS** — prefer the boring solution. No premature abstraction, no generic-for-future-use, no plugin systems unless a second consumer exists today.
- **YAGNI** — do not add fields, params, options, or branches "in case we need them". Add them when a caller requires them.
- **Control ⊥ Data.** Control flow and data flow are independent concerns and live in independent collections. Conflating them is rejected in review.

## 2. Hard Size Limits

| Unit | Hard cap | Soft target |
|------|----------|-------------|
| File | **300 lines** | 200 |
| Function / method | **50 lines** (one screen) | 25 |
| Class | **150 lines** | 100 |
| Function parameters | **4** (use a typed object beyond that) | 3 |
| Cyclomatic complexity | **10** per function | 6 |
| Nesting depth | **3** levels | 2 |

Crossing a hard cap is a refactor trigger, not a style nit. Split by responsibility, not arbitrarily — splitting a 400-line file into two 200-line halves that always change together fails SRP and is rejected.

## 3. The Rewrite Has No Legacy

- **No `v2` suffixes, no compatibility shims, no migration code.** The new module *is* playbook.
- **No feature flags** for the rewrite itself. Flags only for genuinely incomplete features being shipped progressively.
- **No commented-out code.** Ever. Git is the history.
- **No "TODO: later" without a linked issue.** A TODO without an issue is dead code.
- **No dead exports.** If nothing imports it, delete it. CI must fail on unused exports.
- **No `// removed X`, `// was X`, `// legacy` markers.** Delete cleanly.

## 4. Control-Flow & Data-Flow Model (locked from day one)

Two independent collections on every flow. Every layer (frontend types, backend DTOs/schemas, gRPC contract, Python state) encodes this split identically.

### Control flow

- **`ControlEdge`** discriminated by `kind: 'sequential' | 'conditional'`. Conditional edges carry `routerLabel: string`.
- **`RouterNode`** is a first-class node kind. Its config declares `outputLabels: string[]` and `maxIterations: number`. Routers are *the* decision; the node returns `{ routerDecisions: { [nodeId]: label } }` as its state update, and `add_conditional_edges` reads it directly. No separate "router function" layer.
- **`__error__` is a reserved label.** Every node can emit it implicitly on failure; routers may route on it explicitly.
- **`human_approval` is a first-class node kind.** Backed by LangGraph's `interrupt_before` / `interrupt_after` primitives. State carries `pendingApproval: { nodeId, iteration, prompt } | null`.

### Data flow

- **`DataBinding`** declares "this node's input port reads from <source>". Source kinds: `node-output` (with optional `iteration: 'current' | 'previous' | <number>`), `trigger`, `state`, `constant`, `expression`.
- Data bindings live in their own collection, not on edges.
- The runtime resolves bindings at node entry from `ExecutionState`. The control graph builder never inspects bindings.
- Type checking on bindings is mandatory at save time.

### Iteration semantics — three distinct kinds

| Kind | Trigger | Counter scope | Guard |
|------|---------|---------------|-------|
| **Iterator** | foreach over known collection | iterator container | finite collection length |
| **Control loop** | router routes back to an earlier node | cycle in control graph | `maxIterations` on the router |
| **Step retry** | transient node failure | single node invocation | per-node `retryPolicy` |

Mixing iterator + control-loop on the same node is forbidden in v1.

### Validation rules (enforced on save)

1. Every node id unique; every edge endpoint and binding source references an existing node.
2. Every conditional edge's source is a router.
3. Every router's `outputLabels` is fully covered by outgoing conditional edges. No unmapped label, no extra.
4. Every router has at least one terminal route (reaches `END` without re-entering the same router).
5. Any cycle in the control graph includes at least one router with `maxIterations` set.
6. Every required input port has exactly one data binding; optional ports have ≤ 1.
7. `iteration: 'previous'` bindings are only legal when the source node lies on a cycle.
8. Data-binding source types match target input-port types.

## 5. State Model (Python / LangGraph)

- State is a single `TypedDict` in `state.py`. Iteration counters, router decisions, errors, pending approvals are first-class fields — never stuffed into a generic dict.
- **Every state field has an explicit reducer.** `Annotated[T, reducer]`. Parallel fan-out branches that race on plain `dict` updates are a bug.
- `task_outputs` is keyed by `(taskId, iteration)`. Its reducer is "set-by-key" — never overwrite, never merge silently.
- `router_decisions` records every label emitted at every iteration. This is the durable trace consumed by trace-replay.

## 6. Schema Versioning

- Every persisted document (flow, execution, task result, design-chat thread) carries `schemaVersion: number`.
- New documents are written at the current version. Reads tolerate older versions only when an explicit upgrader exists. No silent migrations.
- Initial version is `1`.

## 7. Idempotency

- `POST /executions` accepts an `Idempotency-Key` header. The execution service dedupes within a 24h window. Same key + same body ⇒ same execution id returned.
- Same pattern for any mutating endpoint where retries are likely (mail webhook ingestion, schedule fires).

## 8. Module Boundaries

- One module, one responsibility. If two modules import each other, the split is wrong.
- **No cross-module reach-ins.** Public surface via the barrel / `exports` only.
- **Services do not call other modules' repositories** — they call the owning service.
- **Controllers are thin.** Validate → call service → return. No business logic. Hard cap: 100 lines per controller.
- **Services are pure** of HTTP / gRPC / SSE concerns. Transport translation lives in controllers, gateways, or dedicated adapters.

## 9. Naming

- **Verbs for functions, nouns for data, adjectives for booleans.** `buildGraph`, `taskResult`, `isStale`.
- **No abbreviations** except universally understood (`id`, `url`, `dto`).
- **No Hungarian prefixes** (`strName`, `IFoo`). Interfaces are not `I`-prefixed.
- **Names encode role, not type.** `validatedAnswer`, not `answerString`.
- **A renamed concept is renamed everywhere** in the same PR — schema, DTO, service, frontend type, locale key, test fixture.

## 10. Comments

The default is **no comment**. Code names things, comments explain things code cannot.

- **Comment the WHY**, never the WHAT. `// retry once: gRPC stream drops on token refresh` is good. `// loop over tasks` is noise.
- **Public API documentation** (exported services, exported types, controllers, router nodes): JSDoc / docstring with purpose, params semantics, return semantics, and any non-obvious invariant. One paragraph max.
- **Inline comments** only for: non-obvious invariants, intentional workarounds, performance-critical decisions, references to external specs/issues.
- **No banner comments** (`// ===== HELPERS =====`). If a file needs sections, it's two files.
- **No commit-log comments** (`// added for feature X`, `// fixes bug Y`). That belongs in git.
- **No restating the signature** in the doc (`@param id The id`).

## 11. Errors

- **Never `catch {}`**. Never `catch (e) { /* ignore */ }`.
- **Never `throw new Error(...)`** in a reachable code path — always `AppException` subclasses with `ErrorCode` (backend) or typed domain errors (Python).
- **Validate at boundaries only** (DTO at HTTP, proto at gRPC, Zod at form). Internal callers are trusted — do not re-validate.
- **No defensive `if (!x)` for arguments the type system guarantees.** Trust your types.
- **Loop-specific:** every router must have a terminal label. The builder rejects router configs that can only loop.
- **Failure routing:** node failure auto-emits `__error__`. If the next router does not handle `__error__` explicitly, the execution fails with `ERR_PLAYBOOK_UNHANDLED_FAILURE`.

## 12. Concurrency & Limits

All limits are env-configurable via Joi-validated config:

```
PLAYBOOK_MAX_CONCURRENT_PER_USER=3
PLAYBOOK_EXECUTION_QUEUE_MAX_DEPTH=50
PLAYBOOK_MAX_PARALLELISM_PER_EXECUTION=5
PLAYBOOK_RECURSION_LIMIT_DEFAULT=25
PLAYBOOK_RECURSION_LIMIT_MAX=50
PLAYBOOK_PYTHON_WORKER_POOL_SIZE=8
PLAYBOOK_PYTHON_WORKER_MAX_INFLIGHT=4
```

- Per-user concurrent executions capped; overflow enters a FIFO queue per user.
- Queue beyond `MAX_DEPTH` ⇒ `ERR_1007` (Too Many Requests).
- Per-execution parallelism passed to LangGraph as `max_concurrency`.
- Python service runs a worker pool per replica; scale replicas for throughput.

## 13. Observability

- Every node entry/exit emits an OpenTelemetry span tagged `(executionId, flowId, taskId, iteration, routerDecision)`.
- Spans nest under an execution-level root span.
- The frontend execution timeline reads from the same persisted event stream; there is no second source of truth.
- No `console.log` / `print(` in production code paths.

## 14. Testing

- **Every service method**: at least one happy-path test, one error-path test.
- **Every router function path**: tests for every declared label + max-iterations exit + `__error__` route.
- **Graph builder**: golden-path tests per topology (linear, parallel, iterator, conditional-loop, recovery-branch, HITL).
- **No tests against mocks of code we own** when the real thing is trivial. Mock only I/O boundaries (Mongo, gRPC, axios, EventSource).
- **Tests live next to code** (`*.spec.ts`, `*.test.tsx`, `test_*.py`). One test file per source file.
- **Test names describe behaviour**, not implementation.

## 15. Frontend-Specific (in addition to `FRONTEND_GUIDELINES.md`)

The frontend is **refactored in place**, not rewritten. It stays at `front/src/modules/playbook/`.

- **Reuse, don't recreate.** When modifying an existing component, the agent must edit it in place. Building a parallel replacement and switching imports is rejected unless the existing component is explicitly marked `replace` in [UI_INVENTORY.md](UI_INVENTORY.md).
- **`preserve` rows in the inventory have zero visual change.** Only their type imports and prop shapes update. Screenshot regression must pass.
- **`extend` rows show only the affordances described in the inventory.** No spacing changes, no shadcn variant swaps, no copy rewrites, no icon changes outside the new region.
- **`replace` rows** follow a new design that reuses shared primitives from `components/ui/` — same design language as the rest of the app.
- **Canvas hook**: `usePlaybookCanvas` must not exceed 300 lines after the 4b surgery. Edge serialization, data-binding serialization, cycle/router validation each live in their own pure helper file.
- **Edge type is a discriminated union** (`ControlEdge`) from Phase 4a. Components branch on `kind` via exhaustive `switch` with a `never` default.
- **New node UIs** (router, human-approval) live in their own component files, not as branches inside `PlaybookNode.tsx`.
- **Two visual layers on the canvas**: control layer (solid sequential / dashed conditional with `routerLabel`) and data layer (thin, secondary, toggleable). Default view: control-only with data on hover or via toolbar toggle.
- **Locale lock**: existing keys keep their values. New keys only for new affordances. CI fails if an existing key's value changes without an explicit `replace` verdict in the inventory.

## 16. Backend-Specific (in addition to `BACKEND_GUIDELINES.md`)

- **One schema per file.** No multi-schema files.
- **No service exceeds 300 lines.** Split by sub-responsibility.
- **DTOs do not contain logic.** No methods, no computed getters. Pure shapes.
- **Mappers are pure functions** in `mappers/` files — no DI, no side effects.
- **Iteration-keyed results** use compound index `(executionId, taskId, iteration)` unique. Declared on the schema, not added later.

## 17. Python / LangGraph Specific

- **No monolithic `graph_builder.py`.** The `flow_engine.builder` package splits by topology: `sequential.py`, `conditional.py`, `iterator.py`, `parallel.py`, `guards.py`, `human_approval.py`. Each file ≤ 300 lines.
- **State is a single `TypedDict`** in `state.py` with explicit reducers (see §5).
- **Router nodes are pure step nodes** whose output is a `Literal[...]` label written to `routerDecisions`. No separate "router function" indirection.
- **No `Any` in public signatures.** Internal `Any` requires an inline `# why:` comment.
- **Every node function**: typed inputs, typed outputs, ≤ 50 lines.

## 18. Cross-Layer Contract

Any change touching the wire (DTO field, proto field, SSE event, edge shape, router config, data-binding shape) lands in **one PR** spanning frontend type + backend DTO + backend schema + proto + Python state + tests on both sides. CI must fail on a proto change without a matching frontend type change.

## 19. Pre-Commit Enforcement (must be automated)

- ESLint: `max-lines: 300`, `max-lines-per-function: 50`, `complexity: 10`, `max-depth: 3`, `max-params: 4`.
- TypeScript: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `exactOptionalPropertyTypes`.
- `ts-prune` in CI to fail on unused exports.
- Python: `ruff` with `PLR0912`, `PLR0913`, `PLR0915`, `C901` enabled; `mypy --strict`.
- No `console.log`, no `print(`, no `dbg!` — pre-commit rejects.
- No `TODO` / `FIXME` / `XXX` without `(#issue-number)` suffix.

## 20. Agent Instructions

When writing code in this module, the AI agent must:

1. **Read existing sibling files** before writing new ones. Match patterns. Do not invent.
2. **Stop and ask** if a file would exceed 300 lines, a function 50 lines, or a class 150 lines — propose the split before writing.
3. **Refuse to add** legacy compatibility, dead branches, "future-proof" parameters, or commented-out alternatives.
4. **Refuse to add a comment that restates the code.** If the comment and the line below say the same thing, delete the comment.
5. **Refuse to add a dependency** without checking `package.json` / `pyproject.toml` first.
6. **Touch every contract layer** when changing a contract field (see §18). Partial changes are rejected.
7. **Write the test alongside the code**, in the same response/PR. Code without tests is not done.
8. **Never conflate control and data flow.** New edge fields go on `ControlEdge` only if they affect routing; data concerns go on `DataBinding`.
9. **When in doubt between two designs**, pick the one with fewer lines, fewer files, fewer parameters, fewer branches.
