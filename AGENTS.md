# YellowStorm Agent Instructions

These instructions apply to the YellowStorm workspace. The primary `build` agent implements changes; subagents provide bounded planning, discovery, QA, review, and memory support.

## Source of Truth

When sources disagree, use this order:

1. Executable code, schemas, protocol definitions, and tests.
2. Repository guidelines and configuration.
3. The user's current request and confirmed decisions.
4. Obsidian memory notes.

Memory is useful context, but it may be stale. Verify important claims against the repository before changing code.

## Repository Map

| Area | Path | Stack |
|---|---|---|
| Backend | `YellowStorm/back` | NestJS 10, Mongoose, gRPC, Jest |
| Frontend | `YellowStorm/front` | React 18, Vite, TypeScript, Radix UI, Tailwind, Vitest |
| Agent runtime | `yellowstorm-adk` | Python 3.12+, LangGraph, Google ADK, Pytest |

Package managers:

- Backend/frontend: npm.
- Python: Poetry. When the `meta` Conda environment is required, prefer non-interactive execution such as `conda run -n meta poetry run pytest`.

## Required Guidelines

Before writing or reviewing code, read the guidelines for the affected area:

| Changed paths | Required reading |
|---|---|
| `YellowStorm/front/**` | `YellowStorm/front/FRONTEND_GUIDELINES.md` |
| `YellowStorm/back/**` | `YellowStorm/back/BACKEND_GUIDELINES.md` |
| Both frontend and backend | Both files and the cross-boundary rules below |
| Proto, gRPC, or NestJS-to-ADK paths | Cross-boundary rules below |

Do not load unrelated guidelines.

## Context Retrieval

Use vault memory to establish durable feature context, then verify it against live repository sources before changing code.
- When searching the vault with `obsidian_vault`, use `strategy: "semantic"` instead of the default `"auto"` for better relevance ranking.
- Tier 0 tasks do not require vault retrieval unless risk or ambiguity appears.
- Before Tier 2 or Tier 3 implementation, search the vault using task terms, likely feature slugs, modules or source paths, endpoint or contract names, and relevant error terms. Locate and read the owning canonical note when one exists before changing code.
- For Tier 1 work, retrieve vault context when historical decisions, invariants, pitfalls, or cross-file behavior may affect correctness.
- Prefer the owning feature, architecture, contract, decision, or convention note. Read `Agent Quick Context` first when present, then follow only directly relevant internal links.
- Use Timeline notes only to locate canonical notes or recent routing context. Never treat a Timeline entry as the primary implementation specification.
- After retrieval, inspect the affected code, schemas, protocols, tests, and both sides of changed boundaries. Resolve disagreement using the Source of Truth order above.

## Working Principles

- when it comes to implement multiple tasks, Must ask me choose betwwen : finishing the work until the end without stopping unless you need to ask me for clarification OR Work step by step
- State assumptions that affect correctness, scope, safety, or external contracts.
- Ask only when an unresolved choice would materially change the result.
- Implement the smallest correct change. Do not add speculative features or abstractions.
- Keep changes surgical. Do not reformat, rename, or clean up unrelated code.
- Match established package conventions before introducing a new pattern.
- Add or update tests for changed behavior and bug fixes when feasible.
- Comments explain non-obvious intent, invariants, workarounds, or risk. Do not narrate the code.
- Treat 300-line files and 50-line functions as review triggers, not automatic refactor mandates. Split only along a real responsibility boundary.
- Never hardcode secrets. Never print credentials, tokens, or sensitive payloads.
- Use the project's i18n layer for user-facing frontend text.

## Contracts and Boundaries

For REST, gRPC, queues, database schemas, and other serialized boundaries, verify both sender and receiver:

1. Field names and case conversion.
2. Field shapes and serialization.
3. Required, optional, default, and absence semantics.
4. Compatibility and migration behavior.

For `google.protobuf.Struct` values sent from NestJS, use the repository's `toGrpcStruct()` helper at the sending call site. Verify the current proto rather than relying on a list copied into documentation.

When diagnosing a boundary failure, trace the value across each layer. Use redacted structured diagnostics and remove temporary logging before completion. Do not log full payloads, secrets, or personal data. Rate-limit or aggregate repeated drop events.

## Error Handling

- Never swallow an exception with an empty `catch`.
- Validate at trust boundaries; avoid redundant validation of typed internal calls.
- Use the established application/domain error types for the affected package.
- Preserve terminal routes in workflow graphs and verify that routers cannot loop forever.

## Workflow Tiers

### Tier 0 — Trivial

Typo, formatting, comment-only, or non-runtime configuration text.

- Inspect and make the smallest change.
- Skip subagents unless risk or ambiguity appears.
- Run a lightweight syntax or formatting check when relevant.

### Tier 1 — Local

Localized behavior change with no contract, schema, authorization, or cross-module impact.

- Inspect the implementation and direct tests/callers.
- Use `explore` only when ownership or dependencies are unclear.
- Run focused verification.
- Use `reviewer` for runtime or behavioral changes.

### Tier 2 — Standard

Multi-file feature, bug fix, frontend behavior, backend service, or meaningful state change.

- Use `plan` when the task touches three or more files or has multiple plausible implementations.
- Use `explore` for broad dependency tracing.
- Implement and run focused tests, build, or lint.
- Use `frontend-qa` for browser-visible changes.
- Use `reviewer` before completion.
- Use `maintainer` only when durable memory should change.

### Tier 3 — High Risk

API/schema/proto changes, authentication, permissions, quotas, streaming, database writes, agent runtime, or cross-service behavior.

- Use `plan` before implementation.
- Reproduce unclear failures before editing production logic.
- Verify both sides of every changed boundary.
- Run targeted and integration-level verification where feasible.
- Use `frontend-qa` when browser-visible.
- Use `reviewer`; critical and major findings must be resolved.
- Use `maintainer` after review passes for durable decisions, contracts, invariants, or pitfalls.

## Subagent Routing

| Agent | Invoke when | Do not invoke when |
|---|---|---|
| `explore` | File ownership, call paths, dependencies, or architecture are unclear | Target and callers are already known |
| `plan` | Three or more files, architectural/high-risk work, ambiguity, or contract changes | Trivial or obvious single-file change |
| `frontend-qa` | UI, layout, interaction, routing, forms, accessibility, responsive, console, or browser network behavior changed | Type-only or non-visible frontend cleanup |
| `reviewer` | Non-trivial runtime, behavior, security, persistence, or contract changes | Pure typo, formatting, or comment-only work |
| `maintainer` | A verified change creates durable architectural, feature, contract, convention, or operational knowledge | The change is obvious from code/git or is purely mechanical |

Subagents return evidence and uncertainty; they do not silently expand scope. `plan`, `explore`, `reviewer`, and `frontend-qa` never modify source code. `maintainer` writes only through the Obsidian tools.

## Gate Outcomes

Every blocking agent returns one outcome:

- `PASS`: required checks completed; no blocking findings.
- `FAIL`: a verified product/code issue blocks completion.
- `BLOCKED`: the environment, handoff, or evidence is insufficient to run the gate.
- `SKIPPED`: the gate is not applicable, with a reason.

`FAIL` and `BLOCKED` are different. An unavailable test environment is not a product defect. After two unsuccessful fix/review cycles, summarize the blocker and ask the user for direction instead of looping indefinitely.

## Handoffs

When invoking a subagent, provide:

- Task goal and acceptance criteria.
- Repository root and affected area.
- Changed files or base revision when applicable.
- Relevant constraints and known memory context.
- Verification already performed and its result.
- Exact question the subagent must answer.

## Verification

Use the narrowest reliable command first:

- Backend/frontend: focused `npm test`, then `npm run build` or `npm run lint` when relevant.
- Python: focused `poetry run pytest`, using the required environment wrapper when applicable.
- Cross-boundary work: add integration verification or inspect both runtime sides.

Do not claim a check passed unless it ran successfully. Report unavailable checks explicitly.

## Memory Policy

Use Obsidian memory selectively:

- `Full`: new feature, durable decision, architecture or contract change, important invariant/pitfall.
- `Light`: a non-obvious implementation change future agents are likely to need.
- `None`: typo, formatting, routine refactor, or behavior already clear from code and tests.

Search before writing. Memory must be factual, concise, timestamped in UTC, and linked only when the link materially helps future work. Vault access always goes through Obsidian tools, never direct filesystem access.

Canonical feature, architecture, contract, decision, and convention notes describe the current system and are the primary context for future coding. Full-tier maintenance must update at least one owning canonical note before any optional Timeline entry. Light-tier maintenance updates an existing owning canonical note and does not update Timeline. Timeline is a concise routing index and must not be the sole output of Full-tier maintenance.

## Completion

The final response states:

- What changed and which files were affected.
- Verification performed and its outcome.
- Gate results or why a gate was skipped/blocked.
- Remaining risks or follow-up work, if any.
