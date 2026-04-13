# Agent Instructions

## External File Loading

When you encounter a file reference (e.g., `@rules/general.md`), load it on demand using your Read tool. Treat loaded content as mandatory instructions that override defaults. Follow references recursively. Do NOT preemptively load all references.

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

---

## Agent Team

### Workflow

```
User task
  │
  ▼
┌──────┐   multi-file or    ┌──────┐
│ build │──  risky task?  ──▶│ plan │── action plan ──▶ back to build
└──┬───┘   (mandatory)      └──────┘
   │
   │  implements
   ▼
┌──────────┐                ┌─────────────┐
│ reviewer │◀── MANDATORY ──│ task output  │
└──┬───────┘  before close  └─────────────┘
   │
   │  pass / fail
   ▼
┌─────────────┐
│ maintainer  │◀── post-merge docs & cleanup
└─────────────┘
```

`diagnostics` and `frontend-qa` are called **on demand** by `build` when the situation requires them.

---

### Agent Definitions

#### `plan` — Strategic Analysis (read-only)

**Mandatory when:**
- Task touches 3+ files
- Task spans 2+ feature slugs
- Task modifies an API contract, data schema, or architectural boundary
- Task is ambiguous or underspecified

**Skip when:** Single-file fix with no interface change. Pure formatting/typo/comment edit.

**Outputs a scoped action plan:**
1. Files to touch (with rationale)
2. Risk assessment (what could break)
3. Doc impact tier (Full / Light / None — see Documentation Protocol)
4. Recommended specialist calls (e.g., "call `diagnostics` first — failure is unclear")

`build` must follow the plan. Deviations require re-invoking `plan`.

---

#### `build` — Implementation (default agent)

Primary coding agent. Has bash permissions, skill access, and delegation authority.

**Before writing code:**
1. Check if `plan` is required (see criteria above). If yes, delegate and wait.
2. Read `/docs/DOC_INDEX.md`. Identify related feature slugs.
3. Read the top 15 lines of `/docs/CHANGELOG.md`.
4. For each related slug, read its `Latest Doc Path`. Note architecture decisions, API contracts, and recent changes.
5. Confirm internally: which decisions you're respecting, which requirements you're addressing, and whether this modifies an existing feature or creates a new one.

**After writing code:**
1. Delegate to `reviewer`. **Task is not complete until `reviewer` returns PASS.**
2. If `reviewer` returns FAIL, fix the findings and re-submit.
3. Once passed, delegate to `maintainer` with: what changed, why, and which feature slugs were affected.

**Delegation triggers during implementation:**
- Unclear failure or vague bug → `diagnostics` before editing
- Frontend change affecting interaction/layout/runtime → `frontend-qa` after editing
- Need current library docs → context7 skill (see below)

**Hard rules:**
- Destructive shell commands require user approval.
- Never skip pre-coding steps, even for small fixes.

---

#### `reviewer` — Quality Gate (read-only, BLOCKING)

Single-pass review across three lenses:

| Lens | Focus |
|------|-------|
| **Correctness** | Bugs, regressions, missing edge cases, missing tests |
| **Security** | Auth flaws, input validation, injection/XSS/SSRF, secret leaks, unsafe trust boundaries, AI/tool safety |
| **Performance** | N+1s, unbounded queries, render churn, unnecessary re-renders, blocking calls |

**Output:**

```
## Verdict: PASS | FAIL

### Findings (if any)
1. [critical|major|minor] file:line — description

### Required actions (if FAIL)
- ...
```

- **FAIL** on any critical finding. `build` must fix before close.
- **PASS with findings** allowed for major/minor — logged but non-blocking.
- Read-only. Never modifies code.

---

#### `diagnostics` — Debug & Test

**Invoke when:**
- Bug report (before `build` edits anything)
- Test gaps flagged by `reviewer`
- Flaky or failing test investigation

**Does:**
- Reproduces failures, isolates minimal root cause
- Writes unit/integration/regression tests (Jest, Vitest, Pytest)
- Validates fixes by running relevant test suite

**Output:** Root cause analysis + test files. Hands back to `build` for code changes beyond tests.

---

#### `frontend-qa` — Browser Validation

**Invoke after:** Any frontend change affecting interaction, layout, or browser runtime behavior.

**Does:**
- Real-browser validation via `chrome-devtools` and `ai-elements` skills + project MCP browser tooling
- Visual regression, responsive behavior, interaction quality (focus, keyboard, a11y basics)

**Output:** Pass/fail with evidence. Findings go back to `build`.

---

#### `maintainer` — Docs & Refactoring

**Invoke:**
- After every task that passes `reviewer` (mandatory for doc sync)
- When `plan` identifies refactoring opportunities

**Does:**
- Documentation: feature READMEs, `DOC_INDEX.md`, `CHANGELOG.md`
- Behavior-preserving code refactoring and module cleanup

See the `maintainer` agent file for the full documentation procedure.

---

### Routing Cheat Sheet

| Signal | Action |
|--------|--------|
| Multi-file, multi-slug, or arch change | `plan` first (mandatory) |
| Vague bug or unclear failure | `diagnostics` first |
| Any code change | `reviewer` after (mandatory, blocking) |
| Frontend UI/interaction change | `frontend-qa` after |
| Task complete and reviewed | `maintainer` last |
| Need library/framework docs | context7 skill |
| Single-file, no interface change | `build` directly → `reviewer` → `maintainer` |

---

## Documentation Protocol

### Structure

```
docs/
├── DOC_INDEX.md
├── CHANGELOG.md
└── {feature_slug}/
    └── README.md     ← single living doc, versioned by git
```

### Change Tiers

| Tier | Trigger | Doc action |
|------|---------|------------|
| **Full** | API/contract change, new feature, architecture mod, requirement change | Update or create feature README + index + changelog |
| **Light** | Implementation-only change, no interface change | Changelog entry only |
| **None** | Typo, formatting, comment-only edit | No doc action |

`plan` determines the tier when invoked. Otherwise `build` determines it.

### Hard Rules

- One `README.md` per slug, updated in place, history tracked by git.
- Never create a duplicate slug — check `DOC_INDEX.md` first.
- Relative paths for cross-references.
- All timestamps UTC.
- `CHANGELOG.md` updated **last**.
- Content must be factual and code-derived.

### DOC_INDEX.md Format

```markdown
# Documentation Index

> Auto-maintained by the maintainer agent. Do not edit manually.
> Last updated: YYYY-MM-DD HH:MM UTC

| Feature Slug | Description | Doc Path | Status | Last Updated |
|--------------|-------------|----------|--------|--------------|
| `auth` | Authentication & session management | `/docs/auth/README.md` | ✅ stable | 2026-03-20 |
```

### CHANGELOG.md Format

```markdown
## [YYYY-MM-DD HH:MM UTC] — {short title}

- **Feature:** `{feature_slug}`
- **Type:** feat | fix | refactor | docs
- **Changed:** {what}
- **Why:** {rationale}
- **Impact:** {files/modules affected}
```

### Feature README Template

```markdown
# {Feature Name}

> **Slug:** `{feature_slug}` | **Status:** 🚧 draft | **Last Updated:** YYYY-MM-DD HH:MM UTC

## Purpose
{What this feature does and why it exists.}

## Scope
{Included and explicitly excluded.}

## Architecture
{Key modules, data flow. Mermaid diagram if non-trivial.}

## Requirements
- As a {role}, I want to {goal} so that {benefit}.
- [ ] {acceptance criterion}

## API / Interfaces
{Key signatures, endpoints, or schemas.}

## Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|

## Related Features
- [`{related_slug}`](/docs/{related_slug}/README.md)
```

---

## Library Documentation Lookup (context7)

**Available to:** `build`, `plan`, `diagnostics`.

When the task involves a library, framework, SDK, or API — even well-known ones — fetch current docs first. Training data may be outdated.

```bash
npx ctx7@latest library <name> "<question>"
npx ctx7@latest docs <libraryId> "<question>"
```

- Always `library` first to get a valid ID.
- Full question as the query.
- Max 3 commands per question.
- Never include credentials.
- On quota errors, inform user → `npx ctx7@latest login`.

**Not for:** refactoring, scripts from scratch, debugging business logic, code review, general concepts.

---

## Development Workflow

1. Branch from `main`
2. `plan` if criteria met → action plan
3. `build` implements (pre-coding protocol mandatory)
4. `reviewer` validates → **must PASS**
5. `diagnostics` if test gaps; `frontend-qa` if UI affected
6. `maintainer` syncs docs per tier
7. Test: `npm test` / `npm run build` (back/front), `poetry run pytest` (Python)

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
