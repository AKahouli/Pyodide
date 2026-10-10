# Concurrent replies in normal Conversation

## Confirmed behavior

The user explicitly chose **run both answers concurrently in the same conversation**, rather than queueing or interrupting. This supersedes the foreground-queue exclusion in the earlier background UX plan. Ordinary mono-agent questions remain foreground replies; they are not silently converted into background worker tasks.

## Implementation boundaries

- Frontend: independently track each response by conversation/message identity, preserve interleaved chunks and revision recovery, render each live answer in chronology, and target Stop by response ID. Keep Send available for server-qualified conversations. Snapshot each send and never clear a newer draft or attachment after an earlier send completes.
- Backend: expose `concurrentRepliesEnabled` and plural active-stream snapshots while retaining legacy contracts. Isolate qualified root turns with unique native session IDs; retain canonical conversation identity for authorization, lineage and cancellation. Seed bounded completed conversation history as of the submitted question, excluding unfinished sibling exchanges and the current prompt. Native clarification resumes retain their own session.
- Admission: keep per-message uniqueness and per-user/fleet limits. Replace conversation-wide uniqueness with session uniqueness plus legacy/shared-session exclusion. Existing legacy/team/group requests remain exclusive.
- Native runtime: use the trusted native session override for workflow locks and per-session component/citation caches, not only the runner. Existing seed RPC and scope fields suffice; no new inference agent or direct model call.
- Stop All: atomically freeze all running foreground message IDs with the root epoch barrier. Retry only those saved IDs; never retarget a later question. Preserve background cancellation semantics.

## Evidence and gates

Before editing, browser reproduction showed that a follow-up entered while a normal reply ran was not submitted and its text was cleared. Source tracing confirmed one frontend buffer, conversation-exclusive backend admission, and a shared native session. Graph tools were unavailable, so investigation used focused source reads.

Parallel ownership: frontend concurrency/composer worker; backend isolation/admission worker; native session worker; primary Stop All, migration coordination, integration and browser acceptance. Independent review covers shared-session exclusion, immutable history, cancellation and stale-event races.

Acceptance: two ordinary replies overlap, finish independently and remain correctly attributed; new typing survives older POST completion; one Stop leaves its sibling running; navigation/reconnect restores both; Stop All and its replay cannot cancel later work; legacy exclusivity and quotas remain enforced. Run focused frontend/native/backend tests, builds and observability policy. Review and apply migration to the isolated test database before the local application database. Test with the existing signed-in Smart Agent.

## Current status

Implementation, source review and browser verification PASS. Native isolation tests passed (58 distinct tests); frontend targeted tests passed (126), and backend regression, focused admission and Stop All checks passed. Final backend metadata/root-mention suites passed (59 tests, overlapping earlier runs). Frontend TypeScript, isolated production build and backend build passed; the final one-line shared Stop callback wrapper has a focused regression and a subsequent TypeScript pass. Observability policy passes with no new violations. Existing boundary log owners and canonical correlation IDs remain in use.

Migration 0046 was reviewed and applied to both the isolated test database and local application database after checking there were no active executions. The pre-existing migration ledger has hash/timestamp drift; only this idempotent SQL was applied, without advancing the ledger or skipping older migrations. Legacy Stops committed before the migration have no frozen target array; exact active-target replay is unavailable for those historical stops.

Live Smart Agent evidence: ordinary replies `341cd3cf6cff5e9357c1500b` and `4f63ee3abd4262430eebeb76` in conversation `0227d5dc45082cead3c639a1` overlapped for 7.3 seconds. The short answer returned 12 while the long answer continued streaming. Send remained available and a newly typed draft survived. Each root used its own `turn_<messageId>` session seeded with the same four completed history entries.

Reload recovered both subsequent active replies. Stopping `21e20fb5cbb759a8577562fc` removed only that reply; `78095aae838c57840900160d` continued and completed. Durable inspection exposed the stopped root remaining `running` after its stream closed. Explicit trusted-root settlement fixed this: retest message `3f25dac02cedea233d17fc3b` and root `9a829e6ee617bfcdcc4bdf1b` both became `cancelled`, retaining partial text. The earlier exact test orphan was settled through the existing store method after identity/owner/no-active-work checks, without changing the epoch or other roots. Cancellation/routing regression passed 84 distinct tests across five suites. The immediate-stop lease-registration window was fixed by exposing the claimed lease before asynchronous eligibility/history preparation; 42 focused regressions passed. Final live message `92f61629bb2c4cf42a931753` was cancelled in 437ms before root admission, with no orphan, no Stop error and an available composer.

Desktop and 390px mobile Send hit-testing passed after the launcher fix, with no horizontal overflow; viewport override reset. The initial G/H cancellation click did not reach the backend and both completed naturally; it is not counted as a cancellation pass.

## Operational limits

- Parallel replies see bounded completed history at submission; they do not ingest in-flight sibling output. History uses the latest completed default branch, not a client-only alternate branch selection. The conservative update-time cutoff can omit an older answer edited after submission.
- Active-stream snapshots remain process-local; multi-replica reconnect requires existing sticky routing or separate distributed recovery work.
- Per-turn native session transcripts persist for clarification/background continuation. The existing native session retention/deletion gap remains; do not delete sessions at reply completion.
- The standard frontend build encountered an OS `EPERM` while clearing existing `dist/assets`; verify current production output in a fresh directory rather than deleting or disrupting a running consumer.
