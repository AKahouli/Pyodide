# YellowStorm Agent Instructions

`build` owns the user request, integration, and the earliest verified ready-to-test result. Specialists answer bounded questions; use them when independent work or stronger verification justifies their cost.

## Authority and Product Rules

- The user's current request and confirmed decisions govern intent. Code, schemas, protos, and tests establish current behavior; reviewed Git docs establish approved constraints. Hindsight contains fallible past experience.
- "Conversation" means `http://localhost:5173/#/conversation`, not Conversation v2, unless requested.
- LLM inference features use a dedicated YellowStorm ADK agent configurable in the agent library.

## Repository and Guidelines

| Area | Path | Focused verification |
|---|---|---|
| Backend | `YellowStorm/back` (NestJS, TypeScript) | `npm test -- <pattern>`; lint/build when affected |
| Frontend | `YellowStorm/front` (React, Vite, TypeScript) | `npm test -- <pattern>`; `npx tsc --noEmit -p .`; build when affected |
| Agent runtime | `yellowstorm-adk` (Python) | `conda run -n meta pytest <path> -q` |

Python always uses conda `meta` non-interactively. There is no Poetry project.
Read the short scoped `YellowStorm/front/AGENTS.md` or `YellowStorm/back/AGENTS.md`, then only the linked reference needed for the task. Cross-boundary changes require the backend contract/gRPC and frontend API references; verify both implementations.

## Context and Token Budget

- Use automatic per-session health reports; do not repeat graph-statistics, `hindsight_diagnose` or `sdlc_health` calls at startup. Report failures once or when status changes. Graph/Hindsight failures and pending checks never block coding: use focused source/search/tests for graph context and Git docs/checkpoints for memory. Recovery can run alongside authorized work; refresh health after recovery. Actual checkpoint storage/ownership failures still block native edits. Report a missing/stale plugin and fully restart the host after installation; a new chat does not reload it.

- Reuse verified paths, decisions, graph freshness, and checks already in the session or handoff. Start a new code investigation with minimal CRG context and the active absolute worktree root; query only unresolved callers, impact, or tests. Source/tests resolve graph gaps. If the graph is unavailable, use focused source search immediately; refresh incrementally only when needed for a remaining analysis.
- Read the necessary source ranges. For non-obvious design or contracts, use `docs/agent-context/README.md` to route to matching records. Avoid loading unrelated guidelines, full files, architecture listings, or raw test logs.
- Hindsight recall is automatic at session start; manually retrieve only relevant history that is still missing. Context7 is for external library behavior local evidence cannot establish.
- Set 2-5 observable acceptance criteria for a feature. Keep an inline plan when the approach is clear; use `plan` only for unresolved design choices. Follow-up feedback updates the existing criteria and plan.
- Resolve uncertainty from current context first. Ask only for a decision or missing access that affects the result; use stated, reversible defaults for minor details. For multiple substantial testable phases, `build` asks once whether to finish end to end or pause after each completed phase, unless the current task already has a confirmed choice. Carry that choice through handoffs; routine steps, checks, fixes, and delegation need no repeated confirmation.

## Implementation and Parallel Work

- Before creating a database schema/namespace, table, collection, frontend/backend module or service, runtime, or independently deployed microservice, follow [architecture change control](docs/agent-context/architecture/change-control.md). Inspect reuse options and prepare a concrete proposal, then obtain the user's confirmation before the first dependent implementation edit. An explicit current user instruction approving the named design counts; generic feature approval or end-to-end execution does not. Reuse the confirmed scope through checkpoints/handoffs; ask again only if that design materially changes. Continue independent authorized work while awaiting an answer.

- Make the smallest correct change, follow package conventions, and avoid unrelated cleanup. Use i18n for frontend text. Do not hardcode or print secrets.
- Shell commands use native OpenCode permissions, independently of graph/memory/checkpoint health. Run authorized existing runtime scripts and collect scoped logs when needed; inspect scripts first and respect shared ports/processes/data in parallel sessions. Restricted specialists return command needs to `build`. Use guarded native edit tools for authored source/document changes; do not bypass preparation or file ownership through shell writes.
- Add/update tests for changed behavior and regressions when existing checks do not already prove the outcome. Never swallow exceptions; validate trust boundaries and preserve terminal workflow routes.
- A confirmed user-reported defect becomes a focused regression: reproduce it, add/extend the smallest behavioral test that fails before the fix and passes after it when feasible, then rerun affected QA. Reuse existing coverage; if automation is impractical, retain a concise manual reproduction and state the gap. Memory records the confirmed cause/evidence, never an unverified hypothesis.
- Reuse existing fixture helpers and approved test accounts with the required role. Give each concurrent run a unique namespace, independent auth/report files, owned data, and scoped cleanup. Use separate accounts/tenants when shared account state can race; otherwise isolated records may suffice. Prepare data before QA; never reset shared fixtures. See `docs/agent-context/testing/qa-fixtures.md` for current entry points.
- Prefer concurrent independent searches, checks, and subagent tasks. Start useful independent work early and continue the primary task while it runs. Default to two concurrent specialists; add more only for distinct work that shortens delivery.
- Use `worker` for independent implementation with explicit owned files. Give each worker disjoint files; `build` owns shared contracts, manifests, shared translations, and integration. Workers return required shared-file changes to `build`.
- Native OpenCode Task supports `background: true` when enabled. Use it for exploration with independent primary work, optional review, and documentation. Completion arrives automatically: do not poll, sleep, duplicate work, or relaunch a finished task. Foreground calls are for results needed immediately.
- Run focused checks and browser QA concurrently once their scoped source is stable. A required reviewer can run alongside QA. Assign each frontend QA task a unique run ID, private browser context, and owned page IDs; reuse them only within that task. MCP `--isolated` separates OpenCode processes, and `new_page.isolatedContext` plus explicit `pageId` separates tasks sharing one MCP instance. Avoid overlapping edits, duplicate suites, or mutations of the same test records.
- Preserve acceptance results for unchanged behavior. After a fix, rerun only affected checks plus relevant adjacent coverage; widen verification for a concrete remaining risk.

## Risk, Gates, and Delivery

| Tier | Scope | Required verification |
|---|---|---|
| 0 Trivial | text, comments, formatting | lightweight check; no specialists |
| 1 Local | isolated behavior or UI change | focused tests/checks; browser QA if visible; build self-review |
| 2 Standard | ordinary multi-file feature or bug fix | reproduce unclear bugs; focused checks; browser QA if visible; build self-review |
| 3 High risk | auth, permissions, quotas/billing, migrations, risky DB writes, breaking API/schema/proto, streaming, agent execution, cross-service behavior | verify both sides of boundaries; focused integration checks where feasible; blocking reviewer; browser QA if visible |

- For Tier 1/2, deliver **Ready to test** immediately when focused checks and frontend QA pass. Independent reviewer and maintainer are not delivery gates.
- For Tier 3, report **Ready for local testing; review pending** after checks and QA pass while required review runs. Claim full completion only after critical/major review findings are resolved. Do not merge, deploy, or call required review passed while pending.
- `reviewer` is required for Tier 3 or explicit user requests. Skip routine review otherwise; use a bounded background review only for a specific unresolved concern, not every task.
- Every task records a documentation-impact check. Changed ownership, boundaries, persistence, APIs/events, runtime/deployment, security or durable architectural constraints require updated owning architecture references and an ADR when a decision is introduced or changed. Accepted ADRs are preserved and superseded by a new record. A behavior-only change with no durable documentation impact records a short reason; do not create an ADR for every edit.
- `maintainer` batches verified durable updates in the background after source stabilizes, only within `docs/agent-context/`. `build` owns affected module READMEs, scoped instructions and architecture artifacts elsewhere. Ready-to-test delivery need not wait: identify documentation as pending and preserve the child/task reference. Full task completion requires relevant documents updated, reviewed and linked, or an explicit no-impact reason. A draft ADR stays `proposed` until its decision is approved and implementation evidence reviewed; Git review approves document changes.
- Gates are `PASS`, `FAIL` (reproduced defect), `BLOCKED` (environment/evidence missing), or `SKIPPED` (irrelevant). A started task is `PENDING`, never `PASS`. After two failed cycles on the same gate, report the evidence and blocker instead of repeating the same approach.

## Contracts and Observability

Verify sender and receiver for REST/gRPC/queues/schemas: names, casing, serialization, required/optional/default/absence semantics, and compatibility. NestJS protobuf `Struct` uses `toGrpcStruct()` at the call site; verify the current proto.
For runtime instrumentation, read the relevant rules in `docs/observability/logging-contract.md`. Use the shared observability SDK and registered events, preserve trusted correlation, keep one detailed error owner, redact sensitive content, and avoid per-chunk logging or business-path I/O. Run `node scripts/observability/check-policy.mjs` for relevant runtime changes; run `node scripts/observability/run-gates.mjs --suite unit` for observability contract/SDK changes.

## Handoffs and Follow-up Experience

- The native SDLC plugin persists per-task state and guards edits. Before editing, use `sdlc_checkpoint` for goal/criteria/next action, read matching docs plus existing code, and call `sdlc_prepare` with exact owned targets and a reuse decision. Save progress/check inputs at milestones and before replies. For an unrelated new request in the same chat use `newTask: true`; reopen same-task corrections with `status: active`. See `tools/opencode-harness/README.md` only when workflow details are needed.
- Resume from the matching checkpoint, reconcile source/environment and pending tasks, and continue the recorded next action. Never guess among multiple tasks, repeat passed checks with unchanged recorded inputs, or copy another private browser's state. Reviewer handoffs include the checkpoint task ID for `sdlc_diff(file, taskID)` and any review gap. Accepted instructions/docs must be committed before creating new worktrees.
- Each task carries: goal/acceptance criteria, root, owned files or task-scoped diff, snapshot/base, concise context evidence, checks already run, phase/execution choice when relevant, and the exact question. Reuse the same child session for follow-up. Exclude unrelated pre-existing edits from review scope.
- If QA returns `AUTH_REQUIRED`, `build` asks once for this private context to sign in at the supplied URL/page, or identify an existing test-account/password-manager entry. Keep independent work running and resume the same QA child/context with blocked criteria after sign-in. New contexts may require fresh login; do not share browser state. A confirmed recipe avoids repeated account/method questions, not necessary authentication.
- Before asking, reuse the confirmed login recipe or retrieve one scoped Hindsight result if missing. After real sign-in, persist a small note with `hindsight_ingest_document`, using a stable title per app/environment/role: origin/environment, method, supplied account alias/role, credential-store reference if available, browser policy `isolated`, and verification date. Keep ephemeral context/page IDs in the current handoff. Secrets stay in the browser/password manager; never request passwords/MFA in chat or deliberately retain secrets in memory, Git, transcripts, or artifacts. Verify actual access; never claim memory saved without a successful write, and do not block QA on a failed write.
- End every human-facing answer with **Follow-up:** one or two concrete sentences stating who does what next, where, and the expected result or verification. For ready-to-test work, give the exact route/action and one observable result. For ongoing authorized work, state the agent's next action and continue without routine confirmation. Ask for a decision only when it is actually needed; name that decision. Distinguish a proposal from implemented work. If finished with no next action, say so. Do not substitute an abstract lesson, repeat a settled scope, invent a task, or print `No durable lesson`. Only `build` adds this footer; internal specialists return handoffs. Automatic Hindsight capture remains separate; never claim memory saved without confirmation.
- Respond to user feedback by addressing the reported requirement and rerunning affected QA. Keep unrelated passed evidence. Internal background notifications do not restart the workflow or require another full completion report; notify only for a material finding, failure, or promised result.
- Final replies lead with testable status and URL/route when relevant, then changed behavior, verification, and pending work/task IDs. Keep routine delivery under 12 lines. Git docs receive durable reviewed knowledge; raw interaction history stays in experience memory.
