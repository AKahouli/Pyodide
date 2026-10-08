# Vector Root live qualification proposal — 2026-10-05

Status: prepared for approval, not applied. This is a bounded local qualification window, not a production release declaration.

## Verified prerequisites

Isolated PostgreSQL background-job38 tests, frontend input/work panels17 tests, production backend TypeScript, native governed worker/fanout/followup, public WAIT/resume and Stop/new-epoch recovery passed. Final strengthened native repeat is recorded in the qualification report. Source reviewer PASS. Authentication and the native parked node remain explicit fixture seams.

Read-only main database preflight: `agentstore` has neither `conversation.root_background_jobs` nor `conversation.root_model_slots`. Guide Agent (`6a9da95cea816081bbc63b12`, slug `guide-agent`) is type `simple` and unenrolled. Existing Aegra Root is type `root` and unenrolled; neither is to be silently converted. Browser access is restored in existing Chrome3 tab817982221.

The only existing enrolled profile, Advisory Strategy Specialist, has background.enabledfalse. Recheck this before global enablement; a changed opt-in set requires reassessing which existing work could become eligible. Final WAIT/disabled suite2PASS166.573s; exact post-Stop404/new-epoch repeatPASS87.418s.

## Proposed main changes

1. Apply repository migrations `YellowStorm/back/drizzle/0044_root_background_jobs.sql` and `0045_root_model_capacity.sql` to `agentstore` through the established migration mechanism, transactionally so `SET LOCAL lock_timeout='5s'` takes effect, after verifying the current database. Preserve all existing data; no table drops or job resets.
   - 0044 SHA256: `0F478E13C6D1769902D9D48AA09A34D42381792E58D54806ED85012C36C52925`
   - 0045 SHA256: `C3670B42BD4A6E6046471E082315EADD7153649E58F5C8703CE80CAFDA5A8613`
2. Configure only vector-agent backend/ADK process environments: backend `ROOT_WORK_BACKGROUND_ENABLED=true`, `ROOT_WORK_BACKGROUND_MAX_ACTIVE=1`, `ROOT_WORK_BACKGROUND_MAX_PER_USER=1`; ADK `ROOT_WORK_BACKGROUND_ENABLED=true`, `ROOT_WORK_LLM_CAPACITY_ENABLED=true`, and `ROOT_WORK_DATABASE_URL` pointing to the same `agentstore`. The shared capacity table has exactly30 provider slots and applies to vector runtime model calls during the window. Retain current internal service secret; supply one matching service key as backend `CONVERSATION_GRPC_API_KEY` and ADK `GRPC_API_KEY` without printing credentials. Restart vector services on their existing ports3002/50053/8003; frontend stays5175.
3. Create two dedicated private profiles: mono-agent `Vector Root qualification` and `Vector Guide qualification`, using configured `gpt-6-luna`. Copy the existing Guide Agent role/instructions to the latter without changing Guide Agent itself; select it as the Root's only library worker. Configure both profiles with only connector `smart-navigation-search` (`0df55d714254a12834291b20`) actions `get_document_strategy`, `read_content`, `search`, `search_in_sections`, `read_sections`, `read_blocks`, `expand_context`, `locate_answer_citations`, and only the supplied workspace. No other tools or skills. Use `root_constrained` worker mode, which intersects worker authority with this Root ceiling. Verify the effective compiled action set and fail closed if action classification cannot establish read-only behavior; do not substitute a prompt instruction for capability enforcement. Execution cannot create additional library workers. Root policy:

```json
{
  "version": 1,
  "delegation": {"enabled": true, "defaultConfigurationMode": "root_constrained"},
  "temporaryWorkers": {"enabled": false, "maxPerWorkGroup": 1},
  "fanout": {"enabled": true, "maxItems": 2, "allowBackground": true},
  "background": {"enabled": true, "maxOutstandingPerConversation": 2, "taskTimeoutSeconds": 180, "maxAttempts": 1},
  "limits": {"maxDepth": 1, "maxParallelWorkers": 1, "maxChildExecutionsPerWorkGroup": 3, "maxWorkGroupDurationSeconds": 240}
}
```

4. Create a separate restricted qualification scope/deployment named `BPCE - Support — Root qualification`, using the supplied workspace `fe427ff299ed279639097429`, the current signed-in user as its audience, and only the two qualification profiles as its roster. Publish only its server-captured Root revision; leave the existing BPCE-Support revision, Guide Agent and supplied conversation unchanged. Reuse existing authorized `smart-navigation-search` access; do not create or expand connector credentials/grants.
5. Run new governed conversations for the supplied query, finite two-item fanout, live background delivery/reload/reconnect and Stop. Use source read/search only. Run a30-minute bounded observation window; stop on current-authority, epoch, publication or residual-capacity failure. A sandbox write test requires a separate concrete disposable target and is outside this approval.

## Restore and completion

Stop qualification conversations through their public epoch barrier; retain durable sessions/jobs/evidence for diagnosis. Record process configuration before changing it and restore exact prior values for the background/capacity/limit flags, then restart vector services. The approval explicitly includes retaining the additive schema and matching service authentication after the window; do not drop tables or weaken authentication. Set only the new qualification scope to `inactive` (suspending its deployment), and only the two new profiles to inactive using supported service operations. Confirm readiness and ordinary foreground conversation operation.

Successful completion qualifies the named local fixture and observation window. It does not authorize organization-wide profile enrollment, exactly-once external effects, or production rollout.
