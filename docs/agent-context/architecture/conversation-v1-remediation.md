# Classic conversation P0/P1 remediation

Date: 2026-10-18. Source baseline: `8ef652946` on `security/p0p1-remediation`.
The user requested implementation of the supplied remediation plan, explicitly
excluding **P1-07 (ADK producer queue backpressure)**. Conversation v2 is excluded.
Unrelated connector/SharePoint working changes are not part of this delivery.

## Decisions and acceptance

- Public message operations must reject foreign messages before disclosure,
  writes, placeholder creation, broadcasts or ADK dispatch.
- Terminal failure and expired admission recovery must remain fenced, preserve
  partial output/usage, and fail closed on database outages.
- Classic SSE must use header authentication and deliver/replay recipient events
  across replicas, with bounded memory/storage and canonical resync on gaps.
- Focused checks and independent review must qualify both sides of changed
  boundaries; deployment/load claims require separately observed evidence.

ADR-0025 private mini-app state boundaries are unchanged. No accepted ADR governs
the admission/recovery fixes. Proposed ADR-0027 records the distributed SSE design.
The user approved the named `conversation.sse_events` PostgreSQL table, owned by
the existing ConversationModule, in the reply to `call_daaf9b69`; no broker,
service, module or runtime is introduced. Migration 0053 must precede startup.

## Implemented behavior

| Item | Cause and correction |
| --- | --- |
| P0-01 | The URL conversation was authorized but several message lookups were global. Public GET, edit, feedback and branches now pass conversation scope. Atomic edit SQL also checks the sender; another participant cannot edit the author's message. Regeneration loads both AI and user messages in scope, validates their types and rechecks attachments, current agents/models, semantic access and governed runtime before creating a placeholder. |
| P0-02 | Remote cancellation SQL matched only the message ID. It now matches conversation, message and running status, after a scoped message lookup. Database failure returns a safe 503 instead of a successful stop. |
| P1-01 | An empty message scan returned before the admission reaper. Reaping now runs on empty/failed scans, locks at most 100 execution/message pairs with SKIP LOCKED, and requires durable terminal state plus no live message lease. |
| P1-02 | Fatal errors defaulted to completed, and error/end could race. Fatal and empty streams now persist failed through existing terminal coordination; shutdown partials are interrupted. ADK drains partial events and aborts fatal RPCs with a non-OK status. Recoverable tool errors remain nonfatal. |
| P1-03 | Process-local fanout could not reach another replica. Existing gateway now batches into approved PostgreSQL recipient rows, serializes committed cursor allocation, polls with current membership checks and uses retained replay or resync. See ADR-0027 for retention, overflow, failure and asynchronous pre-commit loss semantics. |
| P1-04 | Missing tables/operational DB failures were treated as successful local operation or false cancellation. Admission startup probes fail closed; operational errors propagate. Heartbeat failure cancels owned execution instead of allowing uncontrolled work. |
| P1-05 | EventSource put the bearer JWT in its URL. Classic transport now uses fetch Authorization with bounded SSE parsing, abort, shared refresh, account/session cursor separation and reconnect. The shared guard's query compatibility is retained only for v2. |
| P1-06 | Fatal ADK errors forwarded exception strings. Public content is now stable and safe, with VALIDATION_ERROR/EXECUTION_FAILED in gRPC details; server diagnostics keep exception class and correlation, without raw exception text/traceback. |
| P1-08 | Logging converted full protobuf payloads solely to count them. Both RPCs now read lengths/counts directly. Business conversions remain where required. |
| P1-09 | Test commands masked failure with `|| true`. Front/backend/ADK tests now propagate failure while coverage uploads retain always(). A focused PostgreSQL security job is added and security branch/PR triggers included. Remote required-status configuration and a deliberately failing GitHub control branch are deployment checks, not established by editing YAML. |
| P1-10 | Two fire-and-forget broadcasts could race independent recipient reads. Turn creation resolves recipients once and awaits each broadcast in user/placeholder order inside the asynchronous fanout, preserving nonblocking HTTP persistence. A delayed-recipient regression covers the ordering. |

Other message-ID routes retain existing conversation checks: tool result,
latency report, reliability rerun, OpenUI private state/task submission, slide
images, generated-image URL/history, artifact downloads and citations. Their
owning service checks conversation identity or executes scoped store queries.
Internal ID-only store operations remain for leased stream/background work;
they are not exposed as public URL authorization.

## Verification and remaining qualification

- Focused controller/message/owner-guard tests, real PostgreSQL foreign-read,
  atomic-author-write and branch isolation checks.
- Recovery/admission/stream race tests cover scoped remote stop, DB errors,
  startup migration failure, expired terminal admissions, partial failure usage,
  cancellation, single terminal settlement and clean-empty end.
- ADK 18 tests cover both RPCs, partial drain, fatal abort, safe messages,
  cancellation/heartbeat/replay and absence of logging serialization.
- Header-auth/parser/reconnect tests and shared guard tests cover both classic
  header enforcement and unchanged v2 query compatibility.
- Periodic canonical resync recovers only a loaded accessible conversation or a
  locally tracked/pending run. A failed/unloaded route ID does not trigger
  repeated denied reads or recovery-error toasts; initial navigation is unchanged.
  The 72-test frontend store suite covers this fix and existing recovery paths.
- PostgreSQL two-gateway tests include ordered delivery/reconnect, recipient and
  membership isolation, deletion/TTL, bounded overflow, 250-marker retention,
  pre-commit loss resync and synthetic 10/30 recipients. These are transport
  checks, not a production load or end-to-end model TTFT benchmark.
- Backend production build configuration typecheck and frontend typecheck pass.
  Broad backend `tsconfig.json` includes unrelated template/test errors; use the
  production build configuration and focused Jest compilation for this change.
- Migration 0053 was applied to the existing local application database after
  confirming 0052 was the latest applied migration; backend startup succeeded.
- Live Chrome QA conversation `6113a5a1d49fe19bbf765471`: minimal assistant
  response, feedback, regeneration, branch navigation and response/feedback
  persistence after reload passed. The other signed-in account saw only
  Conversation not found, with no message content. Earlier saved OpenUI dashboard
  values also restored in `ae30ed8cb3e7a9afa00b872f`.
- Final signed-in reload check after the backend restart: the saved completed
  answer and branch selection restore without rerunning the agent; navigating
  to the original branch restores its saved Like feedback. The second account
  remains on Conversation not found with no private answer content. Final
  screenshots are saved in the local remediation evidence directory.
- The denied page stays quiet across multiple observed periodic stream-resync
  cycles (30-second cadence): no repeated recovery toasts or private answer
  content appears while the second account remains denied.
- Workflow YAML parses; assertions confirm security triggers, the focused job
  and failure propagation from all three test commands. Remote main and current
  integration branch were observed unprotected; no remote protection setting or
  deliberately failing control branch was changed/run during local delivery.
- `scripts/benchmark_chat_request_logging.py` compares baseline serialization
  and direct summaries for real 1/10/100-attachment protobuf requests using 30
  asynchronous producers. At 100 attachments, logging p95 falls from about
  4.44ms to 0.014–0.017ms; peak Python allocations fall from 1.60MB to 69KB.
  This is not model TTFT, process RSS or network latency. Windows CPU timer
  resolution and exact workload are recorded in benchmark output.
- Repository observability policy gate currently reports eight unrelated MCP
  print-diagnostic violations outside this remediation; no new baseline waiver
  or unrelated source change is added.
- Registered `conversation.admission.store_error` events identify admit, remote
  cancellation, heartbeat, recovery-scan and expired-finalization operations;
  `conversation.admission.reclaimed` carries the actual reclaimed count. Both
  use safe fixed outcomes and the existing SDK, without raw DB errors. Contract
  mirrors are updated; SDK unit checks run separately because the full unit
  gate stops at the unrelated repository policy failures.

Deployment still requires an actual multi-replica canary, 10/30-user inference
load, reconnect/revocation and TTFT comparison. The existing wire contract has
no negotiated explicit success marker; a contentful, otherwise clean early
gRPC return cannot be distinguished from a legacy successful stream. Fatal
exceptions and empty clean returns are covered; no stronger truncation claim
is made. P1-07 remains explicitly unimplemented and unqualified.
