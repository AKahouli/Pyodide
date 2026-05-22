Behavioral guidelines to reduce common LLM coding mistakes. Bias toward caution over speed; use judgment for trivial tasks.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- 200 lines that should be 50 → rewrite.


## Non-Negotiable Principles

- **SRP** — one file, one class, one function = one reason to change. If you can describe the unit with the word "and", split it.
- **DRY** — no copy-pasted logic across modules. Extract to a service, util, or hook *the second* time a pattern appears, not the third.
- **KISS** — prefer the boring solution. No premature abstraction, no generic-for-future-use, no plugin systems unless a second consumer exists today.
- **YAGNI** — do not add fields, params, options, or branches "in case we need them". Add them when a caller requires them.

## Hard Size Limits

| Unit | Hard cap | Soft target |
|------|----------|-------------|
| File | **300 lines** | 200 |
| Function / method | **50 lines** (one screen) | 25 |
| Class | **150 lines** | 100 |
| Function parameters | **4** (use a typed object beyond that) | 3 |
| Cyclomatic complexity | **10** per function | 6 |
| Nesting depth | **3** levels | 2 |


Crossing a hard cap is a refactor trigger, not a style nit. Split by responsibility, not arbitrarily — splitting a 400-line file into two 200-line halves that always change together fails SRP and is rejected.

## Architecture Boundaries

**Create new units to isolate responsibilities, not to look organized. Keep related code together until a real seam appears.**

### When to Create a Function

- Extract a function when a named step makes the caller easier to read.
- Extract a function when the same logic appears twice or is likely to be tested independently.
- Extract a function when the current function would exceed 50 lines, nesting depth 3, or cyclomatic complexity 10.
- Do not extract one-line wrappers unless they encode a domain concept or hide an external API boundary.

### When to Create a Class or Service

- Create a service when behavior owns one domain capability with state, dependencies, persistence, IO, or orchestration.
- Split a service when it has more than one reason to change, such as validation and persistence, mapping and transport, orchestration and formatting, or permissions and business rules.
- Do not create generic `Manager`, `Helper`, `Util`, or `Common` classes. Name services by capability: `PlaybookFlowValidator`, `QuotaAllocator`, `WorkspaceDocumentIndexer`.
- Keep services behind existing framework/module boundaries. Do not bypass controllers, stores, repositories, guards, or API clients to save a call.

### When to Create a File

- Create a file when a cohesive unit has a stable name and can be understood without reading unrelated code.
- Split a file before adding new behavior that would push it over 300 lines unless the task is a tiny targeted fix and refactoring would be riskier.
- Do not split a file into arbitrary halves. A split is valid only if each new file has a clear owner responsibility and imports flow in one direction.
- Co-locate tests, DTOs, schemas, hooks, and mappers according to the package's existing conventions.

### When to Add New Code to Existing Units

- Add to an existing function only when the new logic is part of the same step and keeps the function within limits.
- Add to an existing service only when it belongs to the same domain capability and uses the same dependencies for the same reason.
- Add to an existing file only when it preserves cohesion and does not make unrelated callers import more than they need.
- If adding a branch creates a second workflow, extract the workflow instead of growing conditionals.

### Refactor Triggers

- Before adding code to a file over 250 lines, check whether a cohesive extraction is safer.
- Before adding code to a function over 35 lines, check whether named private functions or a mapper/validator would reduce complexity.
- Before adding a third dependency to a function or a fifth dependency to a service, check whether responsibilities are mixed.
- If a change requires editing the same concept in three places, introduce one owning abstraction or state why duplication is safer.
- If the smallest correct fix touches an oversized unit, keep the fix surgical and note the refactor follow-up unless the refactor is necessary for correctness.

## Naming

- **Verbs for functions, nouns for data, adjectives for booleans.** `buildGraph`, `taskResult`, `isStale`.
- **No abbreviations** except universally understood (`id`, `url`, `dto`).
- **No Hungarian prefixes** (`strName`, `IFoo`). Interfaces are not `I`-prefixed.
- **Names encode role, not type.** `validatedAnswer`, not `answerString`.
- **A renamed concept is renamed everywhere** in the same PR — schema, DTO, service, frontend type, locale key, test fixture.

## Comments

The default is **no comment**. Code names things, comments explain things code cannot.

- **Comment the WHY**, never the WHAT. `// retry once: gRPC stream drops on token refresh` is good. `// loop over tasks` is noise.
- **Public API documentation** (exported services, exported types, controllers, router functions): JSDoc / docstring with purpose, params semantics, return semantics, and any non-obvious invariant. One paragraph max.
- **Inline comments** only for: non-obvious invariants, intentional workarounds, performance-critical decisions, references to external specs/issues.
- **No banner comments** (`// ===== HELPERS =====`). If a file needs sections, it's two files.
- **No commit-log comments** (`// added for feature X`, `// fixes bug Y`). That belongs in git.
- **No restating the signature** in the doc (`@param id The id`).

## Errors

- **Never `catch {}`**. Never `catch (e) { /* ignore */ }`.
- **Never `throw new Error(...)`** in a reachable code path — always `AppException` subclasses with `ErrorCode` (backend) or typed domain errors (Python).
- **Validate at boundaries only** (DTO at HTTP, proto at gRPC, Zod at form). Internal callers are trusted — do not re-validate.
- **No defensive `if (!x)` for arguments the type system guarantees.** Trust your types.
- **Loop-specific:** every router must have a terminal label (one route to `END` or a non-router node). The builder rejects router configs that can only loop.


## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Match existing style.
- If you notice unrelated dead code, mention — don't delete.
- Remove imports/variables/functions YOUR changes orphaned. Don't remove pre-existing dead code unless asked.

Test: every changed line traces directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

Strong success criteria let you loop independently. Weak criteria ("make it work") force constant clarification.

---

## 5. Cross-Boundary Contracts

**Wire contracts are the source of truth. Verify both sides.**

When data crosses a serialization or process boundary (gRPC, REST, message queue, DB schema), confirm three things on **both** sender and receiver before declaring the work done:

1. **Field names match** across case conventions (camelCase ↔ snake_case).
2. **Field shapes match** — especially "any-JSON" types like `google.protobuf.Struct`, which need explicit conversion, not plain JS objects.
3. **Presence semantics agree** — optional / required / default-empty.

A field appearing on the sender's payload does NOT prove it arrives on the receiver. Log the field at the boundary on both sides and confirm with eyes on the actual log line.

### Project-specific: `google.protobuf.Struct`

`@grpc/proto-loader` does **NOT** auto-convert plain JS objects into `Struct` wire format. Always wrap with `toGrpcStruct()` (defined in `playbook-execution.service.ts`) before assigning to any Struct-typed field.

Current Struct fields: `task_metadata`, `evaluation_config`, `trigger_context`. Symptom of a missed wrap: the field arrives `None` / empty fields on the Python side, with no error and no log — silent drop on the wire.

When adding a new Struct field to `chatbot.proto`, add the corresponding `toGrpcStruct()` call at the call site in the same PR.

## 6. Silent Drops Are Bugs

**Filters, sanitizers, and `else None` branches must be loud.**

- Log every drop at WARN with the item id and the rule that fired.
- Prefer "keep + flag" over "drop" when possible.
- Default rules to permissive; require explicit allow-listing only when there's a security or correctness reason.

A silent drop turns a 5-minute debug into an hour. Today's iterator bug had three layers of silent drops stacked: the proto-loader wire drop, the `_struct_has_fields` short-circuit, and a sanitizer rule that rejected legitimate edges with no log.

## 7. Don't Trust Short-Circuited Guards (Python)

In `A and B()`, Python only evaluates `B` when `A` is truthy. If `A` is reliably falsy in current usage, `B` can be undefined or broken indefinitely with no error. When you add such a guard:

- Verify the right-hand side actually exists and works.
- Run pyright/mypy on touched files before submitting.
- If the guard exists to protect against an empty proto Struct, write the truthiness check explicitly (`hasattr` or field count) instead of relying on protobuf's `__bool__`.

## 8. Debugging Protocol

**When a behavior is wrong but the cause isn't obvious, log first.**

1. Identify every layer the data crosses (frontend → backend → gRPC → ADK → subgraph, etc.).
2. Add structured logs at each boundary capturing the field/state in question.
3. Run once. Confirm what each layer actually sees.
4. Patch the layer where reality diverges from expectation.
5. Remove the diagnostic logs in the same PR as the fix.

Don't guess from symptoms. One round of boundary logging beats three rounds of speculative patches. Today's iterator bug surfaced in a single log round — earlier guesses cost more time.

---

## Repository & Stack

**Monorepo:** `YellowStorm/back`, `YellowStorm/front`, `yellowstorm-adk`

| Layer | Stack |
|-------|-------|
| Backend | NestJS 10, Mongoose, gRPC, Jest |
| Frontend | React 18, Vite, TypeScript, Radix UI, Tailwind CSS, Vitest |
| Agent Runtime | Python 3.12+, LangGraph, Google ADK, Pytest |
| Database | MongoDB (NestJS); subsystem-specific stores in Python |
| Infra | Docker, Docker Compose, Git |
| Docs | MkDocs (user-facing), internal Markdown |

**Package managers:** npm (back/front), Poetry (Python).

---

## Coding Standards

- **TypeScript:** Follow existing NestJS/React patterns in the package being edited.
- **Python:** PEP 8, type hints mandatory on function signatures, docstrings on public APIs.
- **Localization:** Every user-facing string must use the project's i18n layer (`i18`). Hardcoded UI text is forbidden.
- **Error handling:** Graceful exceptions with proper wrapping and structured logging (`logging` module in Python).
- **Secrets:** Never hardcode. Use `.env` or secrets management.
- **Comments:** Sparingly — code should be self-documenting.
- **Commits:** Conventional format: `<type>(<scope>): <subject>` — types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.

### Mandatory Guideline Loading (HARD RULE)

Before writing or reviewing any code, agents **must** read the relevant guidelines based on the paths being changed:

| Paths being changed | Required reading |
|---|---|
| `YellowStorm/front/**` | `YellowStorm/front/FRONTEND_GUIDELINES.md` |
| `YellowStorm/back/**` | `YellowStorm/back/BACKEND_GUIDELINES.md` |
| Both `front/` and `back/` | **Both** files, plus §5 Cross-Boundary Contracts |
| `*.proto`, gRPC stubs, or NestJS↔ADK paths | §5 Cross-Boundary Contracts (mandatory) |

Applies to all agents (`build`, `plan`, `reviewer`, `frontend-qa`). Skipping is a hard rule violation regardless of task size.


## Agent Team

The main agent implements. Sub-agents provide bounded specialist work. Their local agent files are authoritative for execution details; this file only routes work and defines blocking gates.

- `explore`: read-only codebase discovery, dependency tracing, and file search.
- `plan`: read-only implementation planning for ambiguous, risky, multi-file, cross-module, API/schema/architecture, or contract work.
- `frontend-qa`: browser QA gate for frontend-visible UI, runtime, interaction, responsive, accessibility, console, or network changes.
- `reviewer`: final quality gate for non-trivial code changes.
- `maintainer`: Obsidian memory updates and explicitly delegated behavior-preserving refactors.

Blocking gates:
- `frontend-qa` blocks frontend-visible changes until PASS or the user accepts the risk.
- `reviewer` blocks non-trivial code changes until PASS.
- `maintainer` does not block functional correctness, but should run for Full/Light memory tiers after reviewer PASS.

Read-only agents may use explicitly allowed read-only shell commands such as `git status`, `git diff`, `git log`, or Context7 lookup when their agent config permits it. They must never modify repository state.

`contract` and `integration` are documented workflow roles; not yet implemented as project-local OpenCode subagents.

### Workflow Tiers

#### Tier 0: Trivial

Use for typo, formatting, comment-only, config text, or single-line non-runtime edits.

Process:
- Inspect the target file.
- Make the smallest safe change.
- Skip `plan`, `frontend-qa`, `reviewer`, and `maintainer` unless risk appears.

#### Tier 1: Local Code Change

Use for one-file or localized changes with no contract, schema, auth, permission, quota, streaming, or cross-module impact.

Process:
- Inspect relevant code.
- Use `explore` only if file ownership or call sites are unclear.
- Run the narrowest useful verification.
- Use `reviewer` if behavior changed.

#### Tier 2: Standard Change

Use for multi-file feature work, bugfixes, state changes, tests, backend service changes, or frontend behavior changes.

Process:
- Search relevant context.
- Use `plan` if the task touches 3+ files, spans domains, or has unclear implementation.
- Implement the smallest correct change.
- Run focused tests, build, or lint.
- Use `frontend-qa` for frontend-visible changes.
- Use `reviewer` before final response.

#### Tier 3: High-Risk Change

Use for API contracts, schemas, auth, permissions, quota, streaming/SSE, gRPC/proto, database writes, agent runtime, or cross-service behavior.

Process:
- Use `plan` before implementation.
- Investigate unclear bugs directly before editing.
- Verify both sides of any boundary contract.
- Run targeted plus integration-level verification where feasible.
- Use `frontend-qa` if browser-visible.
- Use `reviewer`.
- Use `maintainer` for Full/Light memory updates.

### Sub-Agent Routing

#### `explore`

Use when:
- File locations, ownership, call paths, or dependencies are unclear.
- A task needs broad search before editing.

Do not use for:
- Known file paths and simple local edits.

#### `plan`

Use when:
- The task touches 3+ files.
- The task spans frontend/backend/ADK or multiple feature slugs.
- The task changes APIs, schemas, proto/gRPC, auth, permissions, quota, streaming, or architecture.
- The task is ambiguous or has multiple plausible implementations.

Skip when:
- Single-file fix with no interface change.
- Pure typo, formatting, comment, or mechanical config edit.

#### `frontend-qa`

Use after implementation when:
- UI, layout, styling, routing, forms, browser runtime, responsive behavior, accessibility, or visible interaction changed.
- when you don't support image, must always Use `frontend-qa` for testing through browser
Skip when:
- Frontend files changed but no visible runtime behavior changed, such as type-only edits or dead code cleanup.

#### `reviewer`

Use before final response for:
- Non-trivial code changes.
- Security, auth, permission, quota, streaming, API, schema, DB, or cross-service changes.

Skip for:
- Docs-only, typo-only, formatting-only, comment-only, or clearly mechanical config edits.

#### `maintainer`

Use after reviewer passes when:
- Memory tier is Full or Light.
- The task changed durable feature behavior, architecture, contracts, conventions, or implementation details future agents need.

Skip when:
- Memory tier is None.

### `build` — Pre-coding Protocol

Before editing:

1. Classify the task tier.
2. Must always search the obsidian vault for module boundaries, imports, and dependencies relevant to the task, Must always use Fragment Search Strategies (  "strategy": "semantic")
3. Read relevant guideline file per Mandatory Guideline Loading table.
4. Inspect relevant code directly.
5. Use `explore` if ownership, call paths, or dependencies are unclear.
6. Use `plan` when routing rules require it.
7. For bug reports with unclear cause, investigate and reproduce before production edits.
8. Read vault notes — prioritize `Agent Quick Context`, index/MOC notes, notes matching `slug`/`source_paths`/tags.
9. Follow only directly relevant `[[Internal Links]]`. No broad recursive traversal.
10. Confirm internally: decisions you're respecting, requirements addressed, new feature vs modification, and the smallest correct implementation path.

### `build` — Post-coding Protocol

After editing:

1. Run the narrowest reliable verification command.
2. If frontend-visible behavior changed, call `frontend-qa`.
3. If the change is non-trivial, call `reviewer`.
4. If reviewer fails, fix and re-run required verification/review.
5. If memory tier is Full or Light, call `maintainer`.
6. Final response must include changed files, verification performed, and any skipped gate with reason.

### Delegation Triggers

- Unclear failure or vague bug → investigate and reproduce before production edits.
- Frontend-visible change → `frontend-qa` after editing.
- Proto/API/cross-service change → contract validation; if `contract` agent exists, use it.
- Cross-service E2E verification → integration validation; if `integration` agent exists, use it.
- Unclear current external library/framework/API behavior → Context7 lookup.

### Hard Rules

- Destructive shell commands require user approval.
- Comments are rare. Add comments only for non-obvious intent, invariants, workarounds, external constraints, or performance/security decisions.
- Do not skip tier-required pre-coding steps.
- `reviewer`, `frontend-qa`, `plan`, and `explore` never modify code.

---

## Memory Protocol

- The Obsidian vault is the canonical long-term memory. Repository markdown is human reference; agent workflows retrieve and update implementation context through the vault.
- Must always use Fragment Search Strategies (  "strategy": "semantic")

### Vault Structure

```
YellowStorm/
├── Index.md
├── Features/{feature_slug}.md
├── Architecture/{topic}.md
├── Decisions/ADR-{number}-{topic}.md
├── Conventions/{topic}.md
└── Timeline/YYYY-MM.md
```

### Change Tiers

| Tier | Trigger | Memory action |
|------|---------|------------|
| **Full** | API/contract change, new feature, architecture mod, requirement change | Update/create vault note(s), frontmatter, `Agent Quick Context`, 3-7 high-value links, tags, timeline entry (timestamp `YYYY-MM-DD HH:MM:SS UTC`) |
| **Light** | Implementation-only change, no interface change | Append concise recent-change memory to relevant note |
| **None** | Typo, formatting, comment-only edit | No memory action |

`plan` determines tier when invoked; otherwise `build` does.

### Hard Rules

- Search before writing — avoid duplicate notes.
- Stable feature notes at `YellowStorm/Features/{feature_slug}.md`.
- 3-7 high-value `[[Internal Links]]` on Full-tier notes; quality over quantity.
- Reading a feature note: `Agent Quick Context` first, then only directly relevant links.
- All timestamps UTC.
- Content factual and code-derived.
- Vault interactions go through Obsidian MCP tools, never direct filesystem.
- `docs/` is passive human reference. Agents must not read or write `docs/` during normal workflow.

### Feature Note Frontmatter

```markdown
---
project: YellowStorm
type: feature
slug: {feature_slug}
status: active | draft | deprecated
updated: YYYY-MM-DD HH:MM UTC
source_paths:
  - YellowStorm/front/src/modules/{module}
  - YellowStorm/back/src/modules/{module}
tags:
  - yellowstorm
  - feature/{feature_slug}
---
```

### Feature Note Template

```markdown
# {Feature Name}

## Agent Quick Context
- Entry points: `{primary source paths}`
- Runtime flow: {short request/data flow}
- Contracts: {endpoints, DTOs, proto messages, or none}
- Invariants: {rules future agents must preserve}
- Pitfalls: {known failure modes or testing gotchas}

## Purpose
{What this feature does and why.}

## Current Implementation
{Modules, data flow, runtime behavior.}

## Key Files
- `{path}` — {purpose}

## API / Interfaces
{Endpoints, schemas, gRPC contracts, events, tool contracts.}

## Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|

## Known Pitfalls
- {Failure mode, invariant, migration warning, testing gotcha.}

## Recent Changes
### YYYY-MM-DD HH:MM UTC
- Changed: {what}
- Why: {rationale}
- Impact: {files/modules affected}

## Related Notes
- [[Related Architecture]]
- [[Related Contract]]
- [[Related Decision]]
- [[Related Convention]]
- [[Known Pitfall]]
```

---

## Library Documentation Lookup (context7)

Available to `build`, `plan`, `reviewer`. Use only when the task depends on current external library/framework/SDK/API behavior.

```bash
npx ctx7@latest library <name> "<question>"
npx ctx7@latest docs <libraryId> "<question>"
```

- `library` first to get a valid ID.
- Full question as the query.
- Max 3 commands per question.
- Never include credentials.
- Quota errors → tell user to run `npx ctx7@latest login`.

**Use for:** adding/changing external API usage, version-specific behavior, unclear framework behavior, suspected library misuse, etc ...

---

## Development Workflow

1. Context7 only when current external library/framework docs are needed.
2. Follow the Workflow Tiers and Sub-Agent Routing rules above.
3. `build` implements after completing tier-required pre-coding steps.
4. Run the narrowest reliable verification: `npm test` / `npm run build` / `npm run lint` in `YellowStorm/back` or `YellowStorm/front`; `poetry run pytest` in `yellowstorm-adk`.
5. Must always activate the Python virtual env through `conda activate meta` before running any python test or process.
6. `frontend-qa` validates frontend-visible changes and must PASS unless the user accepts the risk.
7. `reviewer` validates non-trivial code changes and must PASS before close.
8. `maintainer` syncs Obsidian vault memory for Full/Light tier changes.

---

## Code Patterns

- **Python prompts:** Use f-strings (interpolation) over concatenation or `.format()`. Wrap variables in `{}`, prefix with `f`. Lets users edit prompt templates from the UI without breaking the code.
- **gRPC Struct fields (NestJS):** Always wrap with `toGrpcStruct()` before assigning. See §5.
- **Filters/sanitizers:** Log every drop at WARN with item id and rule. See §6.
- **Python guards:** Verify both sides of `A and B()` work. See §7.

---

**These guidelines work if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, fewer cross-boundary surprises, and clarifying questions come before implementation rather than after mistakes.
