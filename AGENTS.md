# YellowStorm agent instructions

`build` owns integration, user communication and the earliest verified testable result. Delegate bounded work only when it shortens delivery or resolves a concrete risk.

## Authority and context

- Current user decisions govern intent. Source, schemas, protos and tests establish behavior; reviewed branch docs establish approved constraints. Hindsight is fallible experience.
- Conversation means `http://localhost:5173/#/conversation`, unless v2 is requested. LLM inference uses a dedicated YellowStorm ADK agent configurable in the library.
- Route through [the context index](docs/agent-context/README.md), read matching feature/architecture records and scoped package instructions, then verify existing implementations before edits. Load only relevant sections; another branch's unmerged docs are provisional.
- Reuse current graph evidence; new investigations use minimal context and the absolute worktree root. Graph/Hindsight failures or pending checks never block coding: use source/tests and Git docs/checkpoints. Automatic health/recall needs no duplicate diagnostics; refresh for recovery or a concrete freshness gap.
- Set 2–5 observable criteria; use an inline plan unless design is unresolved. Ask only for consequential missing information. Routine edits/checks/delegation need no confirmation. Reuse the confirmed end-to-end or phase-pause choice, or ask once for substantial phases.
- Before a new schema/namespace, table, collection, frontend/backend module/service, runtime or microservice, obtain approval for the named design under [change control](docs/agent-context/architecture/change-control.md). Generic end-to-end approval is insufficient. Preserve the approval reference; continue independent work while awaiting a decision.

## Checkpoints and background handoff

- Before edits: `sdlc_checkpoint` goal/criteria/next action, read routed docs/code, then `sdlc_prepare` exact owned targets and reuse decision. Storage/ownership failures still block native edits. Use guarded tools; never bypass guards through shell writes.
- If `sdlc_prepare` reports a claim from a stopped process, use `sdlc_release` for the exact file, then re-read and prepare it. Never release a live owner's claim or a task's interrupted edit. After cancelling this session's task, create a new checkpoint generation before editing; completed/cancelled sessions may resume another task without opening a new chat.
- Save milestones, check inputs and child references before replies. Resume the matching checkpoint and reconcile source/environment; never guess among tasks. Unrelated requests use `newTask: true`; corrections reopen the same task with `status: active`. Commit approved instructions/docs before creating worktrees.
- Workers own disjoint files; `build` owns shared contracts, manifests, translations and integration. Preserve unrelated dirty/staged work. Separate browser contexts/page IDs, test data, reports and cleanup across runs; respect shared processes/ports. Recipes: [delivery workflow](tools/opencode-harness/docs/WORKFLOW.md).
- Prefer concurrent independent reads/checks. Delegate useful long work through native `Task(background: true)`: independent workers, diagnostics, frontend QA and required review. Foreground calls are for immediately required results. Default to at most two useful specialists; do small fixes directly.
- **Every maintainer invocation, including follow-ups on the same child, requires `background: true`.** Unsupported execution leaves docs pending with a recovery action; never use a foreground maintainer fallback. Continue coding.
- Save child/task ID, purpose, owned paths, source revision and pending result in checkpoint `pending`/`nextAction`. Continue independent integration. When none remains, return control with an honest progress reply so the user can message while children run. Completion notifications resume integration; don't poll, sleep, duplicate/relaunch tasks or mark pending checks passed. User feedback steers the active task without restarting discovery or abandoning children.

## Verification and delivery

| Risk | Required checks |
| --- | --- |
| Trivial text/formatting | lightweight check; no specialist |
| Local/standard behavior | focused checks, self-review, frontend QA for visible changes |
| Auth, permissions, billing/quotas, migrations/risky writes, breaking contracts, streaming, agent execution or cross-service behavior | both sides of boundaries, focused integration checks, required reviewer, frontend QA if visible |

- Deliver the smallest complete agreed flow first. **Preview available** is unvalidated. **Ready to test** requires focused checks and frontend QA; give the route/action/result. High-risk work may be **Ready for local testing; review pending**; full completion requires required review and critical/major fixes. Routine reviewer/maintainer work does not delay ready-to-test.
- Confirmed defects need the smallest meaningful regression when feasible; otherwise record reproduction and coverage gap. Preserve passed evidence for unchanged inputs; rerun affected checks. PASS/FAIL/BLOCKED/SKIPPED are outcomes; running work is PENDING. After two failed cycles, change approach or report the blocker.
- Check documentation impact on every task. Assign `maintainer` exact docs under `docs/agent-context/`, stable source/diff, branch, rationale and checks/review state, asynchronously. Update changed feature behavior, architecture and contracts in the implementation branch/PR. New durable decisions get proposed ADRs; preserve accepted records and supersede them. `build` owns instructions/module READMEs elsewhere. Full completion includes reviewed updates or a specific no-impact reason.
- Follow package conventions, frontend i18n, trust-boundary validation and error handling. Never hardcode/print secrets. Verify REST/gRPC/queue names, serialization, absence/default semantics and compatibility at both ends; Nest protobuf `Struct` uses `toGrpcStruct()`.

| Area | Entry / focused checks |
| --- | --- |
| Backend | `YellowStorm/back/AGENTS.md`; `npm test -- <pattern>` |
| Frontend | `YellowStorm/front/AGENTS.md`; focused tests and affected type/build checks |
| Python | conda `meta` non-interactively; `conda run -n meta pytest <path> -q`; no Poetry |
| Runtime logging | [logging contract](docs/observability/logging-contract.md); `node scripts/observability/check-policy.mjs`; SDK/contracts also `node scripts/observability/run-gates.mjs --suite unit` |

## Human replies

- Lead with status/route, checks and pending work; routine delivery stays under 12 lines. Internal specialists return compact evidence, not human completion reports.
- End every human reply with **Follow-up:** actor, next action/location and expected result. For background work, state what runs and that the user can keep messaging; no routine approval request. Notify on material findings/failures or promised completion without restarting the workflow.
- Missing QA authentication: request sign-in once in its private context, continue independent work, then resume the same child. Credentials/MFA stay in browser/password manager. Save only a verified non-secret login recipe; never claim persistence without confirmation. [Workflow details](tools/opencode-harness/docs/WORKFLOW.md).
