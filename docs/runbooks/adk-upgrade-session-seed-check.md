# google-adk upgrade check: conversation session seed

`yellowstorm-adk/src/grpc_server/conversation_session_seed.py` writes a seeded
transcript in one transaction through private `DatabaseSessionService` hooks
(`_get_schema_classes`, `_rollback_on_exception_session`, `_uses_naive_datetime`,
`StorageSession`, `StorageEvent.from_event`), verified on google-adk 2.11.0.
If a hook disappears the code falls back to the slow per-event `append_event`
path (correct, but seeding cost grows by ~200 ms per message again).

Automatic guard: `conda run -n meta pytest yellowstorm-adk/tests/test_conversation_session_seed.py -q`
must pass after every bump of `google-adk` in `requirements.txt`.

Also verify source-history loading: ordinary database sessions read only their
same-app/user/session state and timestamp/ID-ordered events; custom/fenced session
services must use their public guarded lookup. The seed-target update must remain
in the event-insertion transaction and affect exactly one scoped target row.
The metadata-only bootstrap lookup uses public `GetSessionConfig(num_recent_events=0)`;
confirm it skips event SQL while the Runner's full lookup and resume retain all
history. Query-count and ownership regressions cover these assumptions.

The runtime's `InstrumentedDatabaseSessionService` also combines session/app/user
state into one scoped LEFT JOIN while retaining the complete SDK event query,
state merge, storage revision conversion and read transaction. This optimization
is enabled only for the exact service class on ADK 2.11.0; upgrades use the SDK
path until requalified. Run `tests/test_latency_diagnostics.py` to check full,
metadata-only and filtered history equivalence, missing-state/ownership behavior,
revision markers, durable scoped writes, stale rejection and rollback. Joined
state SQL time is attributed to the session-row bucket. Do not remove the version
guard without checking the installed `get_session()` and storage conversion.

On PostgreSQL, session-only appends with an exact storage marker also combine
required session/app/user reads. The joined query must use `FOR UPDATE OF` the
session table only, explicitly require all three rows, and retain the SDK session
lock, stale check, state/event atomic transaction and synchronous commit before
publishing the in-memory event. Global app/user deltas, marker-less sessions,
partial events, custom classes, other dialects and ADK upgrades use SDK append.
Requalify against pinned `append_event()` too: run the durable-write regressions
in `tests/test_latency_diagnostics.py`, then verify independent PostgreSQL writers
produce one successful commit and one stale rejection, and injected insert/commit
failures leave no state, event or revision advance. Keep pool pre-ping enabled.

## Prompt to paste into an agent after each upgrade

```
google-adk was just upgraded in yellowstorm-adk/requirements.txt (old -> new version: <fill in>).
Verify the one-transaction session seed in yellowstorm-adk/src/grpc_server/conversation_session_seed.py still works:
1. Run `conda run -n meta pytest yellowstorm-adk/tests/test_conversation_session_seed.py -q`; report the result.
2. Open the installed google/adk/sessions/database_session_service.py and confirm each name in _DB_SEED_HOOKS exists
   with the same meaning, that StorageEvent.from_event(session, event) keeps its signature, and that append_event
   does nothing on the first write the seed skips (state deltas, revision/stale-session checks, update_time handling,
   new required columns on events or sessions). Diff the old and new versions of that file if possible.
3. If anything changed: adapt _insert_events_in_one_transaction (or, if ADK now has a public batch-append API, switch
   to it and drop the private hooks), keep the fallback, and update the "verified on" version in the module comment.
4. Check the seed stays one commit: the test test_seed_writes_a_real_database_transcript_in_one_commit must pass.
Do not commit. Report what changed in ADK and what you edited.

## Startup warm-up of ADK's lazy provider imports

`yellowstorm-adk/src/grpc_server/adk_warm_up.py` calls the private, memoized
`google.adk.flows.llm_flows.context._contents._id_pairing_model_types()` at
startup. Otherwise the first request after a restart imports the anthropic SDK
on the event loop (about 2 s before the first model call). If the hook moves,
the warm-up silently does nothing and the cold first message is slow again.
Guard: `conda run -n meta pytest yellowstorm-adk/tests/test_grpc_server/test_adk_warm_up.py -q`.
After an upgrade, also check that no other lazy import shows up in the first
request: compare `before_agent_to_before_model_ms` in the
`conversation_latency_diag.runner_pre_model` log for the first and second
message after a restart (they should be within a few hundred ms).
