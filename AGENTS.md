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

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
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

Applies to all agents (`build`, `plan`, `reviewer`, `diagnostics`, `frontend-qa`). Skipping is a hard rule violation regardless of task size.

---
<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. 
Must ALWAYS use the code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore the codebase.** The graph is faster, cheaper (fewer tokens), and gives you structural context (callers, dependents, test coverage) that file scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.


## Agent Team

```
User task
  │
  ▼
┌──────┐  multi-file or  ┌──────┐
│build │── risky task? ─▶│ plan │── action plan ──▶ back to build
└──┬───┘  (mandatory)    └──────┘
   │ implements
   ▼
┌──────────┐               ┌─────────────┐
│ reviewer │◀── MANDATORY ─│ task output │
└──┬───────┘  before close └─────────────┘
   │ pass / fail
   ▼
┌─────────────┐
│ maintainer  │◀── Full/Light memory sync only
└─────────────┘
```

`diagnostics` is on-demand from `build`. `frontend-qa` is mandatory blocking gate for frontend-visible changes. `contract` and `integration` are documented workflow roles; not yet implemented as project-local OpenCode subagents.

### Agent Capabilities

| Agent | Trigger | Output | Blocks merge? |
|-------|---------|--------|---------------|
| `plan` | Multi-file, multi-slug, ambiguous, or contract/schema/arch change | Scoped action plan: files to touch, risk, memory tier, specialist calls | No (advisory) |
| `build` | Default coding agent | Code + verification | — |
| `reviewer` | Any code change | PASS/FAIL + findings (guidelines, correctness, security, performance) | Yes — FAIL on critical |
| `diagnostics` | Bug report (before edits), test gaps, flaky tests | Root cause + tests | No |
| `frontend-qa` | Frontend-visible UI/layout/interaction/runtime/a11y change | PASS/FAIL + browser evidence | Yes — FAIL on broken flows, console errors, failed requests |
| `contract` | `.proto` mod, gRPC endpoint change, REST schema change, cross-service mod | PASS/FAIL: proto consistency, stub validity, breaking changes, env/secret contract | Yes — FAIL on drift or unmitigated breaking change |
| `integration` | gRPC/REST contract change, multi-service change, post-`contract` PASS needing E2E | PASS/FAIL: connectivity, E2E flows, env consistency | Yes — FAIL on connectivity or schema mismatch |
| `maintainer` | Tasks passing `reviewer` with Full/Light memory tier | Vault updates + behavior-preserving refactors | No |

### `build` — Pre-coding Protocol

Mandatory steps before writing code:

1. Must always search the obsidian vault for module boundaries, imports, and dependencies relevant to the task, Must always use Fragment Search Strategies (  "strategy": "semantic")
2. Read relevant guideline file per Mandatory Guideline Loading table.
3. If `plan` criteria met (multi-file, multi-slug, contract/schema/arch change, ambiguity), delegate and wait. `plan` must also load guidelines.
4. Read vault notes — prioritize `Agent Quick Context`, index/MOC notes, notes matching `slug`/`source_paths`/tags.
5. Follow only directly relevant `[[Internal Links]]`. No broad recursive traversal.
6. Inspect code state to verify current implementation.
7. Confirm internally: decisions you're respecting, requirements addressed, new feature vs modification.

### `build` — Post-coding Protocol

1. Frontend-visible change? → `frontend-qa`. Task incomplete until PASS or user accepts risk. FAIL → fix, resubmit.
2. → `reviewer`. Task incomplete until PASS. FAIL → fix, resubmit.
3. Memory tier Full or Light? → `maintainer`. Skip for None tier.

### Delegation Triggers (during implementation)

- Unclear failure / vague bug → `diagnostics` before editing
- Frontend-visible change → `frontend-qa` after editing (mandatory, blocking)
- Proto/API/cross-service change → contract validation; if `contract` agent exists, use it
- Cross-service E2E verification → integration validation; if `integration` agent exists, use it
- Unclear current external library/framework/API behavior → context7 skill

### Hard Rules

- Destructive shell commands require user approval.
- Must always comment the generated code.
- Never skip pre-coding steps, even for small fixes.
- `reviewer` and `frontend-qa` are read-only; never modify code.

### Reviewer Output Format

```
## Verdict: PASS | FAIL

### Findings
1. [critical|major|minor] file:line — description

### Required actions (if FAIL)
- ...
```

FAIL on any critical. PASS-with-findings allowed for major/minor.

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

Available to `build`, `plan`, `diagnostics`, `reviewer`. Use only when the task depends on current external library/framework/SDK/API behavior.

```bash
npx ctx7@latest library <name> "<question>"
npx ctx7@latest docs <libraryId> "<question>"
```

- `library` first to get a valid ID.
- Full question as the query.
- Max 3 commands per question.
- Never include credentials.
- Quota errors → tell user to run `npx ctx7@latest login`.

**Use for:** adding/changing external API usage, version-specific behavior, unclear framework behavior, suspected library misuse.

**Not for:** refactoring, scripts from scratch, business-logic debugging, simple review, local test patterns, general concepts.

---

## Development Workflow

1. context7 only when current external library/framework docs are needed.
2. `plan` if criteria met → action plan.
3. `build` implements (pre-coding protocol mandatory).
4. Run verification: `npm test` / `npm run build` / `npm run lint` in `YellowStorm/back` or `YellowStorm/front`; `poetry run pytest` in `yellowstorm-adk`.
5. `frontend-qa` validates frontend-visible changes → must PASS.
6. `reviewer` validates → must PASS.
7. `diagnostics` if test gaps.
8. `maintainer` syncs Obsidian vault memory for Full/Light tier changes.

---

## Code Patterns

- **Python prompts:** Use f-strings (interpolation) over concatenation or `.format()`. Wrap variables in `{}`, prefix with `f`. Lets users edit prompt templates from the UI without breaking the code.
- **gRPC Struct fields (NestJS):** Always wrap with `toGrpcStruct()` before assigning. See §5.
- **Filters/sanitizers:** Log every drop at WARN with item id and rule. See §6.
- **Python guards:** Verify both sides of `A and B()` work. See §7.

---

**These guidelines work if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, fewer cross-boundary surprises, and clarifying questions come before implementation rather than after mistakes.
