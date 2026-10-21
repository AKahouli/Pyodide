# YellowStorm agent instructions

`build` owns integration, user communication and the earliest verified testable result. Delegate bounded work only when it shortens delivery or resolves a concrete risk.

## Authority and context

- Current user decisions govern intent. Source, schemas, protos and tests establish behavior; reviewed branch docs establish approved constraints. Hindsight is fallible experience.
- Use recalled memory for reusable causes, fixes, decisions and stable preferences. Historical task status, session/page IDs and old QA results do not establish current state; reconcile task progress with checkpoints and verify technical lessons against current source/ADRs. Capture concise cause -> remedy -> evidence lessons; avoid retaining progress narration as knowledge.
- Conversation means `http://localhost:5173/#/conversation`, unless v2 is requested. LLM inference uses a dedicated YellowStorm ADK agent configurable in the library.
- Route through [the context index](docs/agent-context/README.md), read matching feature/architecture records and scoped package instructions, then verify existing implementations before edits. Load only relevant sections; another branch's unmerged docs are provisional.
- Before the first code edit, consult the [platform ADR index](docs/agent-context/decisions/README.md), or the [harness ADR index](tools/opencode-harness/docs/decisions/README.md) for tooling work. Read applicable current records and record IDs plus concrete constraints in the inline plan/checkpoint decisions; briefly state when none apply. Reuse current evidence for unchanged scope, pass the selection to workers, and check it during review. Proposed/superseded records do not override approved current decisions. This adds no edit gate.
- Every code investigation starts with one bounded `graphify query "<question>" --budget 1500` from the absolute worktree root before any glob/grep/source read; reuse graph evidence the caller supplies instead of repeating it, and continue with `graphify explain/path/affected` (skill `graphify-navigation`) only for unanswered follow-ups. Skip the graph only for prose, git-only chores, or a missing/stale graph — then say so and fall back to focused search. Graph failures or pending checks never block coding: use source/tests and Git docs/checkpoints. Automatic health needs no duplicate diagnostics; refresh for recovery or a concrete freshness gap.
- Set 2–5 observable criteria; use an inline plan unless design is unresolved. Ask only for consequential missing information. Routine edits/checks/delegation need no confirmation. Reuse the confirmed end-to-end or phase-pause choice, or ask once for substantial phases.
- Before a new schema/namespace, table, collection, frontend/backend module/service, runtime or microservice, obtain approval for the named design under [change control](docs/agent-context/architecture/change-control.md). Generic end-to-end approval is insufficient. Preserve the approval reference; continue independent work while awaiting a decision.

## Checkpoints and background handoff

- Checkpoints are advisory memory. Save goal/criteria/next action and meaningful progress; editing requires no SDLC permission, read receipt, reservation or task cancellation. Resume creates an independent continuation and preserves existing tasks. Coordinate overlapping edits through normal agent handoffs and source checks.
- Save milestones, check inputs and child references before replies. Resume the matching checkpoint and reconcile source/environment; never guess among tasks. Unrelated requests use `newTask: true`; corrections reopen the same task with `status: active`. Commit approved instructions/docs before creating worktrees.
- Workers own disjoint files; `build` owns shared contracts, manifests, translations and integration. Preserve unrelated dirty/staged work. Separate browser contexts/page IDs, test data, reports and cleanup across runs; respect shared processes/ports. Recipes: [delivery workflow](tools/opencode-harness/docs/WORKFLOW.md).
- Prefer concurrent independent reads/checks. Delegate useful long work through native `Task(background: true)`: independent workers, diagnostics, frontend QA and required review. Foreground calls are for immediately required results. Default to at most two useful specialists; do small fixes directly.
- Prefer background maintainer tasks when the current Task schema supports them. If background execution is unavailable, the primary completes the exact scoped documentation directly using the existing handoff and evidence; a bounded foreground maintainer is also allowed when useful. Do not invent unsupported arguments, ask for authorization again, or leave documentation pending solely because background routing is unavailable.
- Save child/task ID, purpose, owned paths, source revision and pending result in checkpoint `pending`/`nextAction`. Continue independent integration. When none remains, return control with an honest progress reply so the user can message while children run. Completion notifications resume integration; don't poll, sleep, duplicate/relaunch tasks or mark pending checks passed. User feedback steers the active task without restarting discovery or abandoning children.

## Verification and delivery

- Keep test output concise: use a machine-readable or quiet reporter where available, save full output to a unique local log/report, and inspect counts plus the first relevant failure and location (normally at most 120 lines). Expand only for an unresolved error; avoid loading full DOM dumps or repeated successful output. Preserve the real exit status and verification evidence; never hide failures by filtering output. Read bounded source sections rather than whole files when the relevant location is known.

| Risk | Required checks |
| --- | --- |
| Trivial text/formatting | lightweight check; no specialist |
| Local/standard behavior | focused checks, self-review, frontend QA for visible changes |
| Auth, permissions, billing/quotas, migrations/risky writes, breaking contracts, streaming, agent execution or cross-service behavior | both sides of boundaries, focused integration checks, required reviewer, frontend QA if visible |

- Deliver the smallest complete agreed flow first. **Preview available** is unvalidated. **Ready to test** requires focused checks and frontend QA; give the route/action/result. High-risk work may be **Ready for local testing; review pending**; full completion requires required review and critical/major fixes. Routine reviewer/maintainer work does not delay ready-to-test.
- Confirmed defects need the smallest meaningful regression when feasible; otherwise record reproduction and coverage gap. Preserve passed evidence for unchanged inputs; rerun affected checks. PASS/FAIL/BLOCKED/SKIPPED are outcomes; running work is PENDING. After two failed cycles, change approach or report the blocker.
- Check documentation impact on every task. Assign `maintainer` exact docs under `docs/agent-context/`, stable source/diff, branch, rationale and checks/review state, asynchronously when supported; otherwise the primary completes those docs directly. Update changed feature behavior, architecture and contracts in the implementation branch/PR. New durable decisions get proposed ADRs; preserve accepted records and supersede them. `build` owns instructions/module READMEs elsewhere. Full completion includes reviewed updates or a specific no-impact reason.
- Follow package conventions, frontend i18n, trust-boundary validation and error handling. Never hardcode/print secrets. Verify REST/gRPC/queue names, serialization, absence/default semantics and compatibility at both ends; Nest protobuf `Struct` uses `toGrpcStruct()`.

| Area | Entry / focused checks |
| --- | --- |
| Backend | `YellowStorm/back/AGENTS.md`; `npm test -- <pattern>` |
| Frontend | `YellowStorm/front/AGENTS.md`; focused tests and affected type/build checks |
| Python | conda `meta` non-interactively; `conda run -n meta pytest <path> -q`; no Poetry |
| Runtime logging | [logging contract](docs/observability/logging-contract.md); `node scripts/observability/check-policy.mjs`; SDK/contracts also `node scripts/observability/run-gates.mjs --suite unit` |

## Human replies

- When a necessary question requires a user decision, use simple words, explain why the choice matters, and give a short concrete example. Offer 2–3 clear choices when useful and recommend a default with a brief reason. Avoid unexplained technical terms. Reuse settled decisions and reversible defaults; this adds no questions or step-by-step approvals for routine work.
- Every bug-fix delivery explains the verified root cause, how it produced the symptom, how the change addresses it, and the relevant verification result. Briefly identify decisive evidence. If the cause is uncertain or the change is a workaround, say so explicitly. Keep the explanation concise and understandable to the user.
- Lead with status/route, checks and pending work; routine delivery stays under 12 lines. Internal specialists return compact evidence, not human completion reports.
- End every human reply with **Follow-up:** actor, next action/location and expected result. For background work, state what runs and that the user can keep messaging; no routine approval request. Notify on material findings/failures or promised completion without restarting the workflow.
- Missing QA authentication: request sign-in once in its private context, continue independent work, then resume the same child. Credentials/MFA stay in browser/password manager. Save only a verified non-secret login recipe; never claim persistence without confirmation. [Workflow details](tools/opencode-harness/docs/WORKFLOW.md).
