# Root delegation runtime qualification

Implementation checkpoint: 2026-10-05. This is a qualification checklist, not a production enablement record.

## Current deployment

- Frontend: `http://localhost:5175`; backend: port `3002`; ADK gRPC: `50053`; ADK HTTP: `8003`.
- WP07 source build deployed to backend/ADK on 2026-10-04 with background explicitly disabled. Startup and capability checks passed; full live background qualification remains pending.
- ADK `/health/ready` and backend `/api/v1/health/ready` returned 200 after the authorized Python upgrade and restart. Real browser foreground smoke completed with `VECTOR_PY312_RUNTIME_OK`; evidence: `docs/vector-python312-smoke.png`. The running services do not yet contain all later WP09/capacity edits.
- Latest WP09/capacity source rebuilt and default-off services restarted on 2026-10-05; both readiness endpoints returned200. Qualification evidence and measured real-model load are in `docs/vector-root-qualification.md`;172 synthetic tasks and one actual-provider fenced checkpoint passed. Enabled backend/connector/governed rollout remains unqualified.
- Latest additional gates: actual factory/provider synthesis and fresh native checkpoint2PASS; real Nest HTTP/PG reader suite10PASS with synthetic profile/source lookup; cross-process capacity8PASS; bounded500-call fixture stressPASS. Live capabilities protocol1/Python3.12.14/ADK2.11.0 verified, default-off readinessfalse. Matching backend/native gRPC keys are currently absent and must be configured before enablement.
- Later isolated qualification: governed library worker, two finite fanout items and one sealed followup completed in three native/provider cycles with zero occupied slots and no duplicate publication. Native fault/recovery/capacity19PASS; disabled-flags native dispatch rehearsalPASS. Actual public input/native Workflow WAIT-resume passed146.631s, including rejected actor/input/version and typedfalse with retained invocation identity. Authentication and the parked Workflow node remain explicit test seams. Waiting coordinator input guard fixb293a7a38 passed real PostgreSQL38 tests and source review. Public Stop/native new-epoch recovery passed; final strict lateinput404 repeatPASS87.418s.
- Approved storage CORS origin5175 addition applied; existing Chrome3 citation renders page11/27 (docs/vector-governed-pdf-qualified.png). Existing CORS rule retained, GET/HEAD only; no object ACL changed.
- Preserve the entire dirty worktree. Do not reset, commit unrelated work, or apply migrations to the shared database during qualification.
- PostgreSQL integration fixtures use explicitly isolated `agentstore_test`. Never substitute the application database when that configuration is missing.
- User-authorized shared Conda `meta` upgrade completed: Python3.12.14/google-adk2.11.0. ABI checks and75 native regression tests passed; user-site packages are excluded with environment-scoped `PYTHONNOUSERSITE=1`. Before inventories, Conda revision, wheels and logs are under `TEMP/vector-meta-python312`.

## Qualification gates

1. Run production backend TypeScript compilation with `npx tsc --noEmit -p tsconfig.build.json` from `YellowStorm/back`.
2. Run relevant backend job admission, event, ownership, approval, result authorization and transport tests with Jest. Run PostgreSQL capacity fixtures serially; native fixtures share the isolated database and can skew live-lease counts.
3. Run `conda run -n meta pytest tests/wp07 -q` from `yellowstorm-adk`, plus the foreground fan-out and dispatcher regression suites.
4. Require matching proto assets and regenerated native stubs. Backend `npm run build` invokes the runtime proto copy script; the active output is `dist/src`.
5. Reviewer is enabled. Bounded native coordinator, Stop/replay, scheduling seal, atomic follow-up persistence and synthesis/capacity integration source reviews passed. Review later changes and keep executed qualification separate from source review.
6. Complete background fan-out, conversation replay/input UI, Stop, synthesis, cross-replica recovery and capacity gates before production qualification. A passing leaf suite does not qualify these remaining features.
7. Browser-check the Conversation feature on port 5175, including reload, pending inputs, Stop after foreground completion, and reconnection. If primary browser testing is blocked, ask the user, as requested.

## Deployment prerequisites

- Review `0044_root_background_jobs.sql` and `0045_root_model_capacity.sql` plus journal entries before requesting approval for the shared database. Neither shared migration is authorized. Both were applied only in explicitly isolated fixtures.
- The backend root-work control tables and fenced ADK native session tables must use the same PostgreSQL database. Set the ADK `ROOT_WORK_DATABASE_URL` accordingly through the established secret configuration; do not print it.
- Backend `conversation.rootBackgroundEnabled`, ADK `ROOT_WORK_BACKGROUND_ENABLED` and `ROOT_WORK_LLM_CAPACITY_ENABLED` default off. Qualified background readiness requires the capacity control and exactly30 shared provider slots. Review environment mappings before configuring them.
- Configure the existing internal HTTP secret and gRPC API key on both services. Empty or mismatched credentials must fail closed.
- Verify `GetRootWorkCapabilities`: background/fan-out/follow-up protocol1 and readiness, qualified SDK/Python versions, and the same database control singleton UUID as the backend. New Root background flags require follow-up readiness. An old receiver must never fall back to ordinary foreground invocation RPC.
- Configure bounded global/per-user background limits, retaining each ROOT's frozen policy limits. Opt-in saved profiles and grants require separate, explicit qualification; do not change them merely to make a test pass.

## Recovery checks

- Browser or gRPC observer disconnect must leave the owned native Runner and durable sink alive. EOF must never publish completion by itself.
- Backend lease expiry or owner takeover fences all stale native state, output, evidence, event and action-receipt writes. Attach/reconcile persisted native history before starting another Runner.
- Initial input and native invocation correlation must commit together. Resume an existing invocation without appending the original user message again.
- For WAIT, queue only currently authorized matching native input responses. Approval response event identity and content must commit with native history; duplicate approval must not repeat an external effect.
- A foreground ROOT terminal outcome does not cancel admitted background work. Explicit Stop, epoch changes, revoked bindings, deadline or lease loss remain authoritative.
- Reuse durable successful action receipts. An unresolved action intent requires reconciliation and must not trigger automatic external-write retry.
- Verify new admission at outstanding capacity rolls back both the child execution and job, including lifetime-budget consumption.
- A model permit belongs to one provider call, not the parent invocation. Release only after a confirmed nonstream response or stream EOF, before ADK invokes child tools. Qualified transport retries are disabled.
- Provider timeout, cancellation or premature stream close retains `outcome_unknown` occupancy. Never reclaim it on a timer or process restart. Reconcile with definitive provider completion/termination evidence before an operator clears the exact slot owner/fence; a disconnected HTTP stream alone does not prove provider termination.
- Root completion/failure seals finite result membership. WAIT/unknown members cannot trigger synthesis. A follow-up reserves the existing shared Conversation writer; a pending ordinary placeholder or approval takes priority. Native completion recovery reuses the same invocation and publication message identity.
- Follow-up publication commits message, counters, terminal writer, publication marker and durable event together. Stop suppresses unpublished output and releases the old writer. Snapshot publication IDs reconcile the UI even while older event pages are being replayed.
- Synthesis removes effect tools and installs only the fixed guarded read-only result pager. Public artifact routing uses original evidence IDs, preserves native artifact IDs as metadata, and reauthorizes the current viewer. Final numeric citation aliases must exist in the sealed registry before publication.

## Rollback procedure

1. Prevent new admissions using the existing configuration/policy controls after approval for the concrete configuration change.
2. For work that must terminate, invoke explicit Stop for the conversation and confirm the durable epoch barrier plus native task/sink join. Observer disconnection is not cancellation.
3. Record any task whose external effect lacks a durable receipt as an unknown outcome. Reconcile it before retrying.
4. Restart only the authorized vector-agent services using their established launch paths. Preserve native sessions, jobs, action intents, receipts and events for recovery; do not delete them as a rollback shortcut.
5. Keep additive schema in place unless a separately reviewed rollback proves no persisted work needs it. Disabling the feature does not authorize dropping its tables.
6. Recheck foreground conversation operation and proto compatibility, then document the deployed revision and verified gates in the session handoff.

## Remaining qualification

Enabled live background UI; real connector/sandbox effects; longer soak; concrete configuration/migration/profile approval. Public WAIT-resume/Stop/new-epoch recovery and strengthened sibling-replay/disabled-flags repeats passed (qualification report). Bounded synthetic real-model load, isolated governed workers/fanout/followup and fault/recovery gates passed within documented fixture limits. ROOT_DELEGATION_ROLLOUT_PROPOSAL.md specifies the next approval scope. Fixture and source-review passes alone do not qualify rollout.
