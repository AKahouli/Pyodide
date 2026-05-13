# Playbook Rewrite — Coding Guidelines

> **Scope.** Applies to the new `playbook` module (backend NestJS), `flow_engine` package (Python / LangGraph), and the playbook frontend module. Supplements — does not replace — `FRONTEND_GUIDELINES.md` and `BACKEND_GUIDELINES.md`. On any conflict, the stricter rule wins.

## 1. Non-Negotiable Principles

- **SRP** — one file, one class, one function = one reason to change. If you can describe the unit with the word "and", split it.
- **DRY** — no copy-pasted logic across modules. Extract to a service, util, or hook *the second* time a pattern appears, not the third.
- **KISS** — prefer the boring solution. No premature abstraction, no generic-for-future-use, no plugin systems unless a second consumer exists today.
- **YAGNI** — do not add fields, params, options, or branches "in case we need them". Add them when a caller requires them.

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

## 4. Control-Flow Model (locked from day one)

These are the data invariants. Every layer (frontend types, backend DTOs/schemas, gRPC contract, Python state) encodes them identically.

- **Edge** has a discriminator: `kind: 'sequential' | 'conditional'`. Conditional edges carry `routerLabel: string`.
- **Router node** is a first-class node kind. Its config declares `outputLabels: string[]` and `maxIterations: number`.
- **Task results are iteration-keyed.** Storage key is `(taskId, iteration)`, not `taskId`. `iteration` defaults to 0 for non-looped nodes.
- **Loop guard is engine-level**, not user code. The builder injects an iteration counter; routers can read it; recursion limit is enforced at `.ainvoke` / `.astream` call.
- **Validation rules** (backend, on save): every router covers all its declared labels; every conditional edge originates from a router; cycles must pass through a router with `maxIterations` set.

## 5. Module Boundaries

- One module, one responsibility. If `playbook-flow` ends up importing from `playbook-execution-results` *and* vice-versa, the split is wrong.
- **No cross-module reach-ins.** Public surface via the barrel/exports only.
- **Services do not call other modules' repositories** — they call the owning service.
- **Controllers are thin.** Validate → call service → return. No business logic. Hard cap: 100 lines per controller.
- **Services are pure** of HTTP / gRPC / SSE concerns. Transport translation lives in controllers, gateways, or dedicated adapters.

## 6. Naming

- **Verbs for functions, nouns for data, adjectives for booleans.** `buildGraph`, `taskResult`, `isStale`.
- **No abbreviations** except universally understood (`id`, `url`, `dto`).
- **No Hungarian prefixes** (`strName`, `IFoo`). Interfaces are not `I`-prefixed.
- **Names encode role, not type.** `validatedAnswer`, not `answerString`.
- **A renamed concept is renamed everywhere** in the same PR — schema, DTO, service, frontend type, locale key, test fixture.

## 7. Comments

The default is **no comment**. Code names things, comments explain things code cannot.

- **Comment the WHY**, never the WHAT. `// retry once: gRPC stream drops on token refresh` is good. `// loop over tasks` is noise.
- **Public API documentation** (exported services, exported types, controllers, router functions): JSDoc / docstring with purpose, params semantics, return semantics, and any non-obvious invariant. One paragraph max.
- **Inline comments** only for: non-obvious invariants, intentional workarounds, performance-critical decisions, references to external specs/issues.
- **No banner comments** (`// ===== HELPERS =====`). If a file needs sections, it's two files.
- **No commit-log comments** (`// added for feature X`, `// fixes bug Y`). That belongs in git.
- **No restating the signature** in the doc (`@param id The id`).

## 8. Errors

- **Never `catch {}`**. Never `catch (e) { /* ignore */ }`.
- **Never `throw new Error(...)`** in a reachable code path — always `AppException` subclasses with `ErrorCode` (backend) or typed domain errors (Python).
- **Validate at boundaries only** (DTO at HTTP, proto at gRPC, Zod at form). Internal callers are trusted — do not re-validate.
- **No defensive `if (!x)` for arguments the type system guarantees.** Trust your types.
- **Loop-specific:** every router must have a terminal label (one route to `END` or a non-router node). The builder rejects router configs that can only loop.

## 9. Testing

- **Every service method**: at least one happy-path test, one error-path test.
- **Every router function**: tests for every declared label + max-iterations exit.
- **Graph builder**: golden-path tests per topology (linear, parallel, iterator, conditional-loop, recovery-branch).
- **No tests against mocks of code we own** when the real thing is trivial. Mock only I/O boundaries (Mongo, gRPC, axios, EventSource).
- **Tests live next to code** (`*.spec.ts`, `*.test.tsx`, `test_*.py`). One test file per source file.
- **Test names describe behaviour**, not implementation: `'rejects when max iterations exceeded'`, not `'calls incrementIteration twice'`.

## 10. Frontend-Specific (in addition to `FRONTEND_GUIDELINES.md`)

- **One Zustand slice per concern** within the playbook store, but still a single `store.ts` file. If `store.ts` exceeds 300 lines, split into composed sub-stores (`store.canvas.ts`, `store.execution.ts`) re-exported from `store.ts`.
- **Canvas hook**: `usePlaybookCanvas` must not exceed 300 lines. Edge serialization, cycle/loop validation, and node serialization each live in their own pure helper file under `hooks/` or `utils/`.
- **Edge type is a discriminated union** from day one. Components branch on `edge.kind` via exhaustive `switch` with a `never` default.
- **Router node UI is its own component file**, not a branch inside the generic step node.

## 11. Backend-Specific (in addition to `BACKEND_GUIDELINES.md`)

- **One schema per file.** No multi-schema files.
- **No service exceeds 300 lines.** Split by sub-responsibility: `playbook-flow-builder.service.ts`, `playbook-flow-validator.service.ts`, `playbook-flow-executor.service.ts`, etc.
- **DTOs do not contain logic.** No methods, no computed getters. Pure shapes.
- **Mappers are pure functions** in `mappers/` files — no DI, no side effects. Trivially unit-testable.
- **Iteration-keyed results** are an indexed compound `(executionId, taskId, iteration)`. Declared on the schema, not added later.

## 12. Python / LangGraph Specific

- **`graph_builder.py` is forbidden from existing as a single file.** The new `flow_engine` is split: `builder/sequential.py`, `builder/conditional.py`, `builder/iterator.py`, `builder/parallel.py`, plus a `builder/__init__.py` that composes them. Each file ≤ 300 lines.
- **State is a single `TypedDict`** in `state.py`. Iteration counters and route outputs are first-class fields, not stuffed into a generic dict.
- **Router functions are pure**: `(state) -> Literal[...]`. No I/O, no side effects, no logging beyond a single structured debug line.
- **No `Any` in public signatures.** Internal `Any` requires an inline `# why:` comment.
- **Every node function**: typed inputs, typed outputs, ≤ 50 lines. Longer ⇒ extract to a helper module.

## 13. Cross-Layer Contract

Any change touching the wire (DTO field, proto field, SSE event, edge shape, router config) lands in **one PR** spanning frontend type + backend DTO + backend schema + proto + Python state + tests on both sides. CI must enforce that a proto change without a matching frontend type change fails.

## 14. Pre-Commit Enforcement (must be automated, not vibes)

- ESLint rule: `max-lines: 300`, `max-lines-per-function: 50`, `complexity: 10`, `max-depth: 3`, `max-params: 4`.
- TypeScript: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `exactOptionalPropertyTypes`.
- `ts-prune` (or equivalent) in CI to fail on unused exports.
- Python: `ruff` with `PLR0912` (too many branches), `PLR0913` (too many args), `PLR0915` (too many statements), `C901` (complexity) all enabled; `mypy --strict`.
- No `console.log`, no `print(`, no `dbg!` — pre-commit hook rejects.
- No `TODO` / `FIXME` / `XXX` without `(#issue-number)` suffix.

## 15. Agent Instructions

When asked to write code in this module, the AI agent must:

1. **Read existing sibling files** before writing new ones. Match patterns. Do not invent.
2. **Stop and ask** if a file would exceed 300 lines, a function 50 lines, or a class 150 lines — propose the split before writing.
3. **Refuse to add** legacy compatibility, dead branches, "future-proof" parameters, or commented-out alternatives.
4. **Refuse to add a comment that restates the code.** If the comment and the line below it say the same thing, delete the comment.
5. **Refuse to add a dependency** without checking `package.json` / `pyproject.toml` first.
6. **Touch every contract layer** when changing a contract field (see §13). Partial changes are rejected.
7. **Write the test alongside the code**, in the same response/PR. Code without tests is not done.
8. **When in doubt between two designs**, pick the one with fewer lines, fewer files, fewer parameters, fewer branches.
