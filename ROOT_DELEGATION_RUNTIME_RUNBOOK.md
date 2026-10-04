# Root delegation runtime qualification

Implementation checkpoint: 2026-10-04. This is a qualification checklist, not a production enablement record.

## Current deployment

- Frontend: `http://localhost:5175`; backend: port `3002`; ADK gRPC: `50053`; ADK HTTP: `8003`.
- WP07 source build deployed to backend/ADK on 2026-10-04 with background explicitly disabled. Startup and capability checks passed; full live background qualification remains pending.
- ADK `/health/ready` returns 200. Backend `/api/v1/health/ready` returns 503 because Playbook MCP is unavailable; its PostgreSQL, storage, email, LiteLLM, Conversation gRPC and semantic model checks are healthy. Browser foreground smoke completed with `VECTOR_WP07_RESTART_OK`; evidence: `docs/vector-wp07-restart-smoke.png`.
- Preserve the entire dirty worktree. Do not reset, commit unrelated work, or apply migrations to the shared database during qualification.
- PostgreSQL integration fixtures use explicitly isolated `agentstore_test`. Never substitute the application database when that configuration is missing.
- Conda `meta` currently has Python 3.11.14 and google-adk 2.11.0. Production background capability requires Python 3.12 and the qualified ADK version. Do not upgrade the shared environment implicitly.

## Qualification gates

1. Run production backend TypeScript compilation with `npx tsc --noEmit -p tsconfig.build.json` from `YellowStorm/back`.
2. Run relevant backend job admission, event, ownership, approval, result authorization and transport tests with Jest. Run PostgreSQL capacity fixtures serially; native fixtures share the isolated database and can skew live-lease counts.
3. Run `conda run -n meta pytest tests/wp07 -q` from `yellowstorm-adk`, plus the foreground fan-out and dispatcher regression suites.
4. Require matching proto assets and regenerated native stubs. Backend `npm run build` invokes the runtime proto copy script; the active output is `dist/src`.
5. Resume the reviewer gate when the user requests it. New atomic admission and Workflow extraction have not received that review while the user's pause is active.
6. Complete background fan-out, conversation replay/input UI, Stop, synthesis, cross-replica recovery and capacity gates before production qualification. A passing leaf suite does not qualify these remaining features.
7. Browser-check the Conversation feature on port 5175, including reload, pending inputs, Stop after foreground completion, and reconnection. If primary browser testing is blocked, ask the user, as requested.

## Deployment prerequisites

- Review the exact `0044_root_background_jobs.sql` diff and its journal entry before requesting approval for the shared database. That approval has not been requested or granted.
- The backend root-work control tables and fenced ADK native session tables must use the same PostgreSQL database. Set the ADK `ROOT_WORK_DATABASE_URL` accordingly through the established secret configuration; do not print it.
- Backend `conversation.rootBackgroundEnabled` and ADK `ROOT_WORK_BACKGROUND_ENABLED` default off. Review their environment mappings in source before configuring them.
- Configure the existing internal HTTP secret and gRPC API key on both services. Empty or mismatched credentials must fail closed.
- Verify `GetRootWorkCapabilities`: protocol 1, background ready, qualified SDK/Python versions, and the same database control singleton UUID as the backend. An old receiver must never fall back to ordinary foreground invocation RPC.
- Configure bounded global/per-user background limits, retaining each ROOT's frozen policy limits. Opt-in saved profiles and grants require separate, explicit qualification; do not change them merely to make a test pass.

## Recovery checks

- Browser or gRPC observer disconnect must leave the owned native Runner and durable sink alive. EOF must never publish completion by itself.
- Backend lease expiry or owner takeover fences all stale native state, output, evidence, event and action-receipt writes. Attach/reconcile persisted native history before starting another Runner.
- Initial input and native invocation correlation must commit together. Resume an existing invocation without appending the original user message again.
- For WAIT, queue only currently authorized matching native input responses. Approval response event identity and content must commit with native history; duplicate approval must not repeat an external effect.
- A foreground ROOT terminal outcome does not cancel admitted background work. Explicit Stop, epoch changes, revoked bindings, deadline or lease loss remain authoritative.
- Reuse durable successful action receipts. An unresolved action intent requires reconciliation and must not trigger automatic external-write retry.
- Verify new admission at outstanding capacity rolls back both the child execution and job, including lifetime-budget consumption.

## Rollback procedure

1. Prevent new admissions using the existing configuration/policy controls after approval for the concrete configuration change.
2. For work that must terminate, invoke explicit Stop for the conversation and confirm the durable epoch barrier plus native task/sink join. Observer disconnection is not cancellation.
3. Record any task whose external effect lacks a durable receipt as an unknown outcome. Reconcile it before retrying.
4. Restart only the authorized vector-agent services using their established launch paths. Preserve native sessions, jobs, action intents, receipts and events for recovery; do not delete them as a rollback shortcut.
5. Keep additive schema in place unless a separately reviewed rollback proves no persisted work needs it. Disabling the feature does not authorize dropping its tables.
6. Recheck foreground conversation operation and proto compatibility, then document the deployed revision and verified gates in the session handoff.

## Remaining qualification

Same-native-Workflow background fan-out and coordinator/item compute accounting; durable reconnect and pending-input UI; cross-replica Stop/publication; once-only synthesis behind the shared foreground slot; 30-active-generation/50-user burst, fault and soak evidence; Python 3.12 qualification; production configuration/migration approvals.
