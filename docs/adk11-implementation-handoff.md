# ADK 2.11 Root Delegation — Implementation Handoff

Handoff notes for the next AI coding agent continuing the **YellowStorm — ADK 2.11 Root Delegation Implementation Plan**.

- **Plan file:** `C:\Users\zadmi\Downloads\yellowstorm_adk211_root_delegation_implementation_plan.md` (sections WP00–WP10, acceptance matrix §16, file impact map §17)
- **Branch:** `adk11-migration` (repo root `C:\prog\agent-trees\vector-agent`)
- **Status:** WP00–WP04 **complete, reviewer-approved, browser-verified**. WP05–WP10 remain.
- **Standing user requirement:** every implemented requirement must be verified **through the browser** (YellowStorm UI), not just with unit tests. For browser automation use the `browser-use:control-browser` skill (in-app browser, Playwright surface).

---

## 1. Environment & operations

| Thing | Value |
|---|---|
| Backend | NestJS, `YellowStorm/back`, listens on **3002** (`/api/v1/...`), start: `node --enable-source-maps dist/src/main` after `npm run build` (nest build). Log: `back/back_start.log` |
| ADK runtime | Python 3.12 conda env **`meta`**, `yellowstorm-adk/`, gRPC on **50053** (`GRPC_PORT` in `yellowstorm-adk/.env`), FastAPI on 8003. Start: `nohup /c/Users/zadmi/.conda/envs/meta/python.exe main.py > adk_service.log 2>&1 &` — do NOT use `conda run` for the service (it buffers logs); do use `conda run -n meta` for pytest |
| Frontend | Vite on **5175** (CORS allowlist only accepts 5175) and 5176. A parallel agent session may own 5175 — it serves the same working tree, so it sees your changes after reload |
| Databases | Remote shared Postgres `poc.postgres.yellowmind.ai:3515`, DBs `agentstore` + `agentstore_test` (`.env`: `POSTGRES_*`) |
| Migration mechanism | `npm run db:migrate` (drizzle-kit) **records the journal row but does not execute the statements** on this setup (happened for 0042 and 0043). Always verify tables actually exist after migrating; apply idempotent SQL manually to BOTH DBs when drizzle fails silently, and refresh the `drizzle.__drizzle_migrations.hash` row if you edit a migration file afterwards |
| Python tests | `conda run -n meta python -m pytest @<argsfile> -q` — pytest argsfile syntax (`@file.txt` with one path per line). `conda run` cannot take multiline `-c` scripts; write scripts to files |
| Browser tests | Front at `http://localhost:5175/#/conversation`. Composer submit is flaky via synthetic Enter; use the exported token (from `localStorage.yellostorm_access_token`) for curl PATCHes, and dispatch a full pointer-event sequence on the "Send message" button via `evaluate` when Enter is swallowed |

**Critical shared-tree warning:** a parallel agent session actively edits the same working tree (lint/TS-strictness waves). Stage files **explicitly by path** when committing; never `git add -A`. Their WIP files were repeatedly broken at compile time — if `nest build` fails, check whether the failing file is one you never touched.

**Login:** user supplied `agara@yellowsys.fr` / password — the login API rejects them with 401 (ERR_1111) from curl; the browser session is already logged in as Amine GARA. Export the token from the page when API calls are needed. Never hardcode or commit credentials.

---

## 2. What is implemented (commits on `adk11-migration`)

| Commit | Content |
|---|---|
| `53b6ec731` | **WP00** — google-adk pinned to 2.11.0, compat fixtures, recorded limitations (see `docs/adk11-wp00-qualification.md`) |
| `7e6cb28f9` | **WP01** — `root_execution_policy` jsonb + allowlist junctions (`agent_root_delegate_agents`, `agent_root_delegate_teams`), `conversations.root_agent_id` + `root_work_epoch`, policy DTOs/service (`root-policy.service.ts`), `resolveRootForConversation` binding on conversation create, shared root editor UI (`RootExecutionPolicyFields.tsx` + admin variant, en/fr i18n) |
| `a608cb56b` | **WP02** — allowlist resolver (`root-delegate-resolver.service.ts`, `resolveForActor`/`resolveEffectivePool`, actor-grant checks, dedup, provenance), effective-pool endpoint `GET agents/:id/root-delegates/effective-pool`, UI save/pool-preview verified |
| `650eea9f4` + `27bbaa3cf` + `3c8d81e64` | **WP03** — ExecutionScope/ExecutionTrace proto (+role/lifecycle enums), `root_executions` + `root_evidence_records` tables (drizzle `0043`), root-work module (types/store/service), Stop-barrier transaction with UUIDv7-fenced stop ids, `AgentExecutionSnapshotService` (digests/snapshots/compact catalogs), `yellowstorm-adk/src/root_runtime/` (contracts, cancellation registry, compiler facade with resumable App for ROOT roles, event projector), servicer abort wiring + trace mapping, `CleanSessionPlugin` native-resume guard |
| `12913913b` + `a5dad8b4e` | **WP04** — library delegation vertical slice (details below) |
| `cf4752250` | Fix: `dict(part.function_call.args)` crashes the turn when the model sends a call with `args=None` (guarded 3 sites with `or {}`) |
| `15b783d60` | Fix: ADK 2.11 partial streaming events re-carry the in-progress function_call; the runner queued one activity per chunk (670 observations for 1 execution, 392-step UI explosion). All three event loops now observe calls only on the non-partial event (`not event.partial`), matching ADK's own execution gate (`flows/llm_flows/functions.py`) |

### WP04 architecture (the delegation loop, working end-to-end)

1. **Routing (§4.3):** an untagged standard chat turn resolves the conversation's **bound root** (`conversation.rootAgentId`) instead of the hidden system mono-agent. Explicit agent targets / Teams / governed / group flows keep precedence. Implementaed in `stream.service.ts buildAgentExecutionRequest` (`boundRootId`).
2. **Attach:** `buildRootDelegationContext` → `RootDelegateResolverService.resolveForActor` (actor-grant checks) → compact catalog (metadata + `snapshotDigest` only) → candidate `IGrpcAgent` definitions via `buildAgentsForStream`; `root_constrained` candidates scoped by `scopeCandidateToRootCeiling` (tools/knowledge/skills intersected with the root's; **empty intersection = deny**). Root execution registered durably in `conversation.root_executions` (failure degrades the turn, never breaks it).
3. **Wire:** `RunSingleAgentRequest` carries `delegate_candidates` (field 23), `root_context` (24), `execution_scope` (22).
4. **ADK dispatcher** (`src/root_runtime/dispatcher.py`): `delegate_to_agent` is a replayable Workflow (`input_schema=DelegateToAgentRequest`, `parameter_binding="node_input"`, `rerun_on_resume=True`) attached post-creation the same way the temporary-child tool attaches (`agent.tools = [...]` — proven pattern). Unknown/denied ids **fail closed** without compiling; the chosen candidate compiles **lazily** through `team.delegation_factory._create_agent_with_error_handling`; child runs via `ctx.run_node(child, node_input=packet, run_id=f"exec_{uuid5(parent_exec:agent_id:task)[:12]}", use_sub_branch=True, raise_on_wait=True)`; lifecycle chunks stamped with producer lineage; typed result `{status, agent_id, execution_id, text≤8000, citation_refs, artifact_refs, safe_error}`; exceptions → typed failed result.
5. **Runner gating** (`runner.py`): when `agent_config["_delegation_root"]`, text whose event author ≠ the root agent's name never streams (partial text skipped, final-response capture gated by author — a child's final event previously **terminated the root invocation**), child usage chunks are not attributed to the root.

**Browser-verified gate results:** simple question on a bound-root conversation → 1 step, no child; delegation request → only the allowlisted "Guide Agent" compiled, its answer returned through the tool, root synthesized "The specialist replied: …" (3 LLM calls); root execution row visible in DB.

**Test data state:** the user's personal root "Advisory Strategy Specialist" (`6aa851deab04c2c842b26879`, delegation enabled, 1 direct delegate "Guide Agent" `6a9da95cea816081bbc63b12`) had `isDefaultForType=true` set via API during WP04 testing so new conversations bind it. Leave or revert in the agent editor per user preference.

---

## 3. Recorded limitations / deferred debt (per reviewer gates)

- **WP00 (recorded in `docs/adk11-wp00-qualification.md`):** ADK 2.11 replay sequence-barrier divergence ("Timed out waiting for sequence key") — Worky multi-await HITL xfail'd (Worky out of plan scope). Child interrupt through NodeTool doesn't resume into the child → **design rule: any dispatcher driver must park itself (RequestInput + `rerun_on_resume=True`), never let a child interrupt bubble through.**
- **Deferred to WP05+ (reviewer minors, WP04 PASS):**
  - Child tool-activity components still carry the root's actor labels — need producer-lineage stamping via the dispatcher's projector (plan §9.3).
  - Producer-scoped usage reporting (child usage currently suppressed to avoid double-count, not attributed).
  - Barrier-reject regression test for the servicer path; runtime verification of a Stop-cancelled stream (WP08).
  - Candidate definitions are hydrated per turn (≤64, every message) — digest-gate/cache (WP10 perf).
  - Tool ceiling matches by tool **name**; config-aware comparison (sandbox/write scope) is WP10 hardening.
- **WP08 owns:** uuid backport SQL for other environments (commented inside `drizzle/0043_root_work_records.sql`), Stop controller, cross-replica stop-id single-writer.

---

## 4. Remaining work packages

All with the same per-WP workflow: **plan §-referenced implementation → python+jest tests → nest build + full suites → restart both services → browser verification of the WP gate → reviewer subagent (fix cycles until PASS) → commit (stage by explicit path only)**.

- **WP05 — Temporary worker slice** (plan §7, gate at §WP05): bypass mandatory legacy child behavior only on enrolled root routes; root-derived scoped profiles through the same dispatcher/compiler; atomic count reservations + unique input/output sandbox scopes; remove worker spawning/delegation routes incl. indirect execution tools; UI defaults + producer labels. Gate: no permanent agent records, no forced first worker, depth ≤ 1, caps hold under parallel calls/replay, parent tools remain available. Key existing code: `team_orchestrator._attach_required_temporary_child_tool`, `make_temporary_child_agent_tool`, `temporary_child_agent.py`.
- **WP06 — Foreground deterministic fan-out** (plan §8): root-facing fan-out operation, native driver node, explicit concurrency (max_concurrency excludes dynamic run_node children — use an explicit semaphore per WP00 finding), failure/interruption semantics, background fan-out stays depth 1.
- **WP07 — Durable background dispatcher** (plan §10): root-work jobs/leases/admission, dedicated native sessions (`rootbg:<workGroupId>:<jobId>`), fencing, recovery algorithm, side-effect safety; likely needs the internal ADK↔backend client (`adk-invocation-client.ts`) and `root-work-internal.controller.ts` proposed in §17.1.
- **WP08 — Stop-all + background live UI** (plan §11, §13): `StopRootWork(conversationId, stopRequestId)` controller using the WP03 `RootWorkService.stopRootWork` barrier (UUIDv7 `newStopRequestId()` mandatory), abort-signal fan-out via `get_root_cancellation_registry().cancel_all`, honest `cancelling` status, live activity UI (`RootWorkActivity.tsx` proposed), barrier-reject regression test.
- **WP09 — Consolidated follow-up + governed qualification** (plan §13.3, WP09 gate).
- **WP10 — Performance, fault injection, rollout** (plan §14, §18): candidate-definition caching, config-aware ceiling, qualification objectives §14.3.

---

## 5. Conventions the next agent must keep

- **Legacy byte-identity:** unset ExecutionScope/root_context/delegate_candidates/execution_trace ⇒ byte-identical legacy requests and streams. Every WP builds on this rule.
- **Fail-closed rules:** unknown/denied agent ids, empty capability intersections, stale snapshot digests (ConflictException), stale stop ids — all deny, never silently widen.
- **Worker roles never activate root behavior** (proto enum separation is the enforcement point).
- **Never** import ADK-internal `NodeTool`; expose Workflows via `LlmAgent.tools` (ADK auto-converts).
- **Exceptions:** backend uses `src/modules/exceptions` (ErrorCode enum), not `@nestjs/common` exceptions.
- **Migrations:** hand-written numbered SQL in `back/drizzle/` + journal entry in `meta/_journal.json`; contract mirror in `back/db/postgres/agent.schema.sql` (uses `object_id` domain; live DB lacks it — migration files use `char(24)`); always verify statements actually ran.
- **Tests:** pytest argsfiles live under `yellowstorm-adk/tests/wpNN/args*.txt`; scripted-LLM harness pattern in `tests/wp00/test_adk211_root_runtime_compat.py` (`_ScriptedLlm` with `yield LlmResponse(...)` — async generator, not return).
- **Reviewer gate:** use the `reviewer` subagent with: scope (explicit commit list), design constraints, verification evidence, numbered questions; fix CRITICAL/MAJOR until PASS.
- **Completion reports:** ≤ 25 lines; never claim a check that didn't run.
