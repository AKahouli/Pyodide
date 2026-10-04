# YellowStorm Agent Instructions

The primary `build` agent runs the whole development loop. Subagents (`explore`, `plan`, `diagnostics`, `verify`, `frontend-qa`, `reviewer`, `maintainer`) are bounded tools that return condensed evidence.

## Source of Truth

1. Executable code, schemas, protos, tests.
2. Guideline files and repository configuration.
3. The user's current request and confirmed decisions.
4. Obsidian memory (may be stale; verify against code before acting).

## Product Rules

- "Conversation" means the feature at `http://localhost:5173/#/conversation`, not Conversation v2, unless the user says v2.
- Any feature that needs LLM inference is built as a dedicated agent through the YellowStorm ADK (configurable in the agent library), not as a direct chat-completion call.

## Repository Map

| Area | Path | Stack | Test |
|---|---|---|---|
| Backend | `YellowStorm/back` | NestJS 10, Mongoose, Drizzle/PostgreSQL, gRPC | `npm test -- <pattern>` (jest), `npm run lint`, `npm run build` |
| Frontend | `YellowStorm/front` | React 18, Vite, TypeScript, Radix, Tailwind | `npm test -- <pattern>` (vitest), `npx tsc --noEmit -p .`, `npm run build` |
| Agent runtime | `yellowstorm-adk` | Python 3.12, LangGraph, Google ADK, requirements.txt | `conda run -n meta pytest <path> -q` |

Python always runs inside the conda `meta` environment, non-interactively (`conda run -n meta ...`). There is no Poetry project.

## Required Guidelines (read by section only)

| Changed paths | File |
|---|---|
| `YellowStorm/front/**` | `YellowStorm/front/FRONTEND_GUIDELINES.md` |
| `YellowStorm/back/**` | `YellowStorm/back/BACKEND_GUIDELINES.md` |
| Cross-boundary (REST, gRPC, proto, NestJS to ADK) | Both files: backend section 23 "Frontend to Backend Contract" and section 10 "gRPC", frontend section 6 "API Layer" |

Both files are 500+ lines with numbered sections. Grep the `^## ` headings, then read only the sections that govern the change (for example: DTOs and validation, state management, streaming, testing, naming). Never load a whole guideline file.

## Context Retrieval

1. Graph first for code investigation: start with `get_minimal_context_tool(task=..., repo_root=<active worktree absolute path>)`, then use targeted CRG queries before structural Grep/Glob/Read. Load the global `crg-navigation` skill for accurate tool recipes. Refresh missing/stale graphs before relying on them; source wins when results disagree. Skip pure prose and git-only chores. Fall back to focused file scanning when indexing/static analysis cannot answer, and record the limitation in the handoff.
2. Read only the line ranges the change needs.
3. Vault memory (`obsidian_vault`, `strategy: "semantic"`) only for Tier 3 work, or when a Tier 2 task depends on historical decisions or invariants that code does not explain. Never for Tier 0 or 1.
4. Context7 only for external library behavior local code cannot establish.

## Working Principles

- Implement the smallest correct change. No speculative features, abstractions, or unrelated cleanup.
- Match the conventions of the package you are in before introducing a pattern.
- Add or update tests for changed behavior and bug fixes.
- Comments explain non-obvious intent, invariants, or workarounds only.
- Files under ~300 lines and functions under ~50 are review thresholds; split along a responsibility boundary or justify briefly.
- Never hardcode or print secrets. Use the i18n layer for user-facing frontend text.
- For requests with several independent tasks, ask whether to do them all or one at a time. Otherwise do not ask; state assumptions and proceed.

## Contracts and Boundaries

For REST, gRPC, queues, and schemas verify both sender and receiver: field names and case, shapes and serialization, required/optional/default/absence semantics, compatibility and migration. `google.protobuf.Struct` values sent from NestJS use `toGrpcStruct()` at the call site; verify the current proto rather than documentation. When diagnosing a boundary failure trace the value layer by layer with redacted diagnostics, and remove temporary logging before completion.

## Error Handling

Never swallow exceptions with an empty catch. Validate at trust boundaries only. Use the package's established error types. Keep terminal routes in workflow graphs and make sure routers cannot loop forever.

## Workflow Tiers and Gates

| Tier | Scope | Required steps |
|---|---|---|
| 0 Trivial | typo, formatting, comment, non-runtime config text | edit, lightweight check; no subagents |
| 1 Local | one behavior change, no contract or cross-module impact | inspect target and direct tests; `verify`; `reviewer` if runtime behavior changed |
| 2 Standard | multi-file feature, bug fix, UI behavior, service change | `diagnostics` for unclear bugs; `plan` only if ambiguous; implement with tests; `verify`; `frontend-qa` if browser-visible; `reviewer` |
| 3 High risk | API, schema, proto, auth, permissions, quotas, streaming, DB writes, agent runtime, cross-service | `plan`; reproduce before editing; verify both sides of each boundary; `verify` incl. integration where feasible; `frontend-qa` if browser-visible; `reviewer` (critical and major must be fixed); `maintainer` when tier is Full |

Subagent routing:

| Agent | Use when | Skip when |
|---|---|---|
| `explore` | ownership, call paths, or dependencies still unclear after one graph query | target and callers already known |
| `plan` | Tier 3, ambiguity, several plausible designs, contract changes | obvious change, even if it touches several files |
| `diagnostics` | bug with an unclear cause; needs reproduction before editing | cause is evident from the report or a failing test |
| `verify` | any test, build, lint, or type-check run whose output could be long | a single short command you can run yourself |
| `frontend-qa` | UI, layout, interaction, routing, forms, a11y, console, or network behavior changed | type-only or non-visible frontend change |
| `reviewer` | non-trivial runtime, behavior, security, persistence, or contract change | Tier 0 |
| `maintainer` | Full-tier change passed review and created durable knowledge | fact is obvious from code or git |

## Gate Outcomes

`PASS`, `FAIL` (verified product defect), `BLOCKED` (environment or handoff insufficient; not a defect), `SKIPPED` (not applicable, with reason). After two unsuccessful fix cycles on the same gate, stop and report the blocker with the condensed evidence.

## Handoffs

Every subagent call carries: goal, acceptance criteria, repository area, changed files or base revision, verification already run, and the exact question to answer. Subagents never expand scope; only `maintainer` writes, and only through Obsidian tools.

## Memory Policy

`Full`: new feature, durable decision, architecture or contract change, important invariant or pitfall. `Light`: a non-obvious implementation fact future agents will need. `None`: everything else. Details live in the `obsidian-context` skill.

## Completion Report (max 25 lines)

- What changed, with file paths.
- Verification run and outcome (never claim a check that did not run).
- Gate results, or why a gate was skipped or blocked.
- Remaining risks or follow-ups.
