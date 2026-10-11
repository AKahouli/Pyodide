# google-adk upgrade check: conversation session seed

`yellowstorm-adk/src/grpc_server/conversation_session_seed.py` writes a seeded
transcript in one transaction through private `DatabaseSessionService` hooks
(`_get_schema_classes`, `_rollback_on_exception_session`, `_uses_naive_datetime`,
`StorageSession`, `StorageEvent.from_event`), verified on google-adk 2.11.0.
If a hook disappears the code falls back to the slow per-event `append_event`
path (correct, but seeding cost grows by ~200 ms per message again).

Automatic guard: `conda run -n meta pytest yellowstorm-adk/tests/test_conversation_session_seed.py -q`
must pass after every bump of `google-adk` in `requirements.txt`.

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
