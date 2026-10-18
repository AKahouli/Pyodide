# Conversations

## Files & artifacts panel and agent reuse

The classic conversation header opens Files & artifacts in the existing responsive
context panel. Uploads, generated files/images, saved OpenUI programs and accessible
linked workspace sources use stable references with paginated search. The API
retains type filtering; the compact panel exposes search and file actions.
Preview/download resolves fresh authorized URLs using existing viewers. Reload does
not run an agent or saved task. One logical artifact represents one saved OpenUI
text component, potentially containing multiple mini-apps.

`list_conversation_assets`, `inspect_conversation_asset` and
`read_conversation_asset` share the projection and recheck trusted runtime actor,
current membership/governed audience and workspace access. Read returns bounded
extracted text, image input, saved program source or an explicit unsupported result.
Evidence authorization is preserved; private drafts never become shared content.
Model-supplied filenames, paths and URLs do not grant access.

Use adds a removable filename chip without sending. Up to eight exact references
are serialized only at submission; chips are transient and scoped to the current
actor/conversation. Failed sends retain selections and successful sends clear only
their submitted nonces. The agent can
call `prepare_conversation_asset` for selected ready files before creating the
existing code-interpreter sandbox. Preparation rechecks access and returns an
exact content-addressed input path; receipts belong to the current invocation.
Saved programs/private drafts and governed evidence bytes are not staged.
Successful interpreter output publication passes through existing workspace
storage/quota registration before becoming a ready asset. Retry identity is
server-owned; ordinary downloads do not save extra copies.

Conversation-owned files and saved logical artifacts offer confirmed Delete when
the current actor has permission. Linked sources open their owning workspace.
Deletion hides the item immediately from active listings and authoritative reads,
staging, new download resolution and RAG reads. History retains an unavailable
placeholder; deleting a program does not delete other components or private drafts.
File quota is refunded once under the workspace lock. Failed blob/index cleanup
is persisted and shown as retry-only pending cleanup after reload. Type labels use
readable labels such as PDF, DOCX and PPTX rather than raw MIME strings.
Interpreter execution rechecks availability and fences output registration against
deletion; stale sandboxes must be discarded before reuse. Already downloaded bytes,
independent outputs and existing bearer URLs (up to ten minutes) cannot be recalled.
The home page's recent files also excludes deleted component and canonical document
references, including old message cards whose own deletion marker is absent.
See the [plan and live qualification](../architecture/conversation-files-artifacts-plan.md).
Sources: conversation artifact/controller/attachment services,
`ConversationFilesPanel`, `AssetPromptBridge` and ADK native-tool registry.

## HtmlView artifacts and administrator execution policy

Admin → Conversation → Generative UI selects `generativeUi.htmlMode`. Strict is
the default and removes generated scripts while retaining rich HTML/CSS/SVG and
declared data-state/text/show/filter/progress/SVG bindings. Interactive enables
generated inline scripts with a visible navigation/data-transmission and browser
resource warning. Existing artifacts use the current policy; a policy change
remounts the frame after the settings hook refresh. No credentials or privileged
document/task bridge is passed to HTML. Host document selectors and saved results
remain separate native components. See [ADR-0028](../decisions/ADR-0028-openui-html-artifact-policy.md).

HtmlView keeps the upstream html/height/title signature with trailing name/value
binding. Inside MiniApp, typed controls use the existing private draft lifecycle,
including revision conflicts and reload without inference. The opaque srcdoc frame loads a trusted external bootstrap under the unchanged
application CSP; strict mode denies eval, while interactive mode evaluates inert
generated scripts only after initial state arrives. Source, expand, stop and restart are host-owned; restarting
retains draft values. HtmlView visual export fails explicitly until the capture
phase, while existing native exports retain their saved-view path.

## Scope and evidence

- Primary product route: `http://localhost:5173/#/conversation`; existing threads use `#/conversation/:id`.
- This record covers Conversation v1. Studio / Conversation v2 has separate ownership and contracts.
- Source inspection: **2026-10-13**, revision `cc3d0e078dfcb0f535bcfcb28b8041fa9d2251a9`.
- The original 2026-10-13 baseline used source and test definitions only. Later dated sections record their focused runtime, test and browser verification.
- Read this page to locate behavior and reuse points; confirm relevant code on the active branch before editing.

## Purpose and workflows

### Classic conversation security and streaming remediation (2026-10-18)

Public message reads/writes now carry the authorized conversation scope, edits
also require the sender, and regeneration revalidates source relationships and
current capabilities. Remote cancellation is scoped; admission/recovery failures
fail closed and fatal streams persist failed. Classic SSE uses fetch Authorization
and recipient-scoped PostgreSQL replay through the existing gateway (migration
0053); asynchronous gaps reconcile from canonical state. See the [implementation,
route boundaries and qualification record](../architecture/conversation-v1-remediation.md)
and proposed [ADR-0027](../decisions/ADR-0027-classic-conversation-durable-sse.md).
P1-07 ADK queue backpressure and conversation v2 are explicitly excluded.

### Reusable OpenUI mini-apps (2026-10-17)

With the agent's existing generative-UI option enabled, the shared library now
provides `MiniApp`, bound input/select/toggle controls, action buttons, outputs
and lists. Agents compose these into unrelated apps without application-specific
screens. Four pure functions format numbers, count text, filter lists and join
text; each validates its arguments and result inside the implementation because
the SDK does not consistently enforce declared function schemas.

Local bindings, expressions and Set/Reset actions need no inference. Explicit
`AskAgent` actions validate the enclosing form and use the existing typed,
authorized conversation-submission path. Private typed drafts now autosave after
500 ms, including unsubmitted values; accepted submissions remain the initial
fallback when no private draft exists. Expected revisions prevent stale writes.
Both private reads and writes require current creator/member access. Document
summarization accepts pasted text or requests existing authorized conversation
documents through a normal agent turn. Phase 4 adds document selection and task/result
correlation over that same execution path, without generated JavaScript or a dynamic mini-app export contract. The static summary
remains a normal exportable answer. See the
[implementation and remaining phases](../architecture/openui-mini-apps-plan.md#phase-2-implementation-and-qualification).

Live qualification used conversation `0a36aab51f702536578737aa`: a converter,
discount scenario and city filter ran locally, and a document summarizer returned
a factual French paragraph from pasted source text. Reload retained submitted
values, including the unchecked bullets option, and discarded a later draft.

Phase 3 then qualified quiet autosave across those four apps: reload retained
unsubmitted zero/false/null/empty values and the summarizer's draft/options without
another agent turn. Two tabs produced one winner and one recoverable conflict;
both loading saved state and explicitly reapplying the whole local draft worked.
Separate app components also save independently under real SQL concurrency tests.
See [ADR-0025](../decisions/ADR-0025-openui-private-draft-state.md) for the approved
private state boundary. Dynamic mini-app export snapshots remain a later phase.

Phase 4 uses `MiniDocument` for completed uploads in the current conversation's
system workspace and `MiniTaskResult` for the enclosing app's saved assistant
result. Explicit `AskAgent` tasks flush the private draft and submit a versioned
program/revision/document descriptor through the existing message API. The backend
revalidates membership, the source revision, attachment policy and selected file
scope before execution. Existing request IDs provide replay without rerunning;
later explicit runs use new IDs. Saved message links restore results after reload.
Host draft revisions mark changed inputs stale; cancellation/failure/interruption
remain distinct from successful completion. No new table or service is introduced.
See the [phase 4 contract and qualification](../architecture/openui-mini-apps-plan.md#phase-4-implementation-and-qualification).

Activity reading follow-up (2026-10-17): the existing desktop activity pane follows
new rows and growing summaries while the reader remains at the bottom. Scrolling
away pauses following; returning within 40 px of the bottom resumes it. Pointer,
keyboard, focus and wheel interaction prevent the completion timer from hiding
activity, and waiting for clarification no longer hides a reader's open panel.
Untouched replies retain their delayed auto-collapse and historical replies start
collapsed. Manual collapse/expand remains available.

Reading preferences are ephemeral, message-keyed objects owned by ConversationContent,
shared by both streaming paths and the saved bubble. This preserves the open/closed
choice and paused scroll position through live-to-saved replacement; changing
conversation or reloading discards the preferences. They are not transcript,
reasoning replay or provider history, and do not change backend streaming, tools,
permissions or durable writes. Focused regressions cover both handoffs, conversation
isolation, paused/resumed following, same-row growth and interaction-safe collapse.
Verification: 121 focused UI tests and independent review passed. In Luna thread
`045eb674f2e97560bff7a145`, the refreshed UI retained a keyboard-interacted panel
after completion while a subsequent untouched greeting collapsed normally; native
summary Markdown and pane scrolling remained usable. The 390 px mobile timeline
opened without horizontal page overflow. Vite has HMR disabled locally, so browser
QA requires a reload after source edits. Global TypeScript checking remains blocked
by unrelated semantic-model localization diagnostics.

Fleet-admission follow-up (2026-10-17): conflict detection and quota-checked
insertion now share one CTE decision statement, reducing successful admission
from five to four database statements including BEGIN/COMMIT. The transaction's
global advisory lock remains a separate preceding statement: READ COMMITTED must
take a fresh decision snapshot after any prior holder commits. Busy-before-capacity
precedence, legacy/native-session exclusion, user/fleet quotas, expired-row rules,
identity-conflict classification and synchronous commit before success are
unchanged. No authorization, history, model, tool or durable-write ordering changes.
Admin-latency-gated numeric preparation events separate `fleet.lock_acquisition`
(database round trip plus any lock wait) from `fleet.decision`; the surrounding
bootstrap admission duration also includes transaction begin/commit and overhead.
These durations do not isolate pure server queueing.

Two Luna greetings before and two after backend deployment measured admission
106/118 → 84/82 ms (median 112 → 83 ms, 26%). The after samples measured lock
acquisition 19/19 ms and decision 26/25 ms; the remaining approximately 39 ms covers
transaction begin/commit and overhead. No large acquisition spike appeared in
these samples, but pure server lock wait is not separately measured. Bootstrap
median was 239 → 221 ms. Overall backend preparation remained about 1.84 s;
variation in other stages offset the admission saving, so no overall provider or
backend speedup is claimed from this small sample.
The second browser timing envelope flagged clock skew. Admission and bootstrap
comparisons use backend monotonic durations and are unaffected; no cross-clock
end-to-end improvement is claimed.

Both new replies completed durably with valid question links, 17,023 cached input
tokens each, reasoning usage and all expected 16/18 seeded history events plus
private Responses state; all eight prior replies remained present. Verification:
73 focused PostgreSQL/admission/cancellation/stream/timing tests, build, independent
review, browser timings and all backend readiness checks passed. Regressions
include a blocked second connection seeing the preceding holder's commit,
parallel quotas, busy-before-capacity precedence, expired rows, duplicate identity,
commit failure and cancellation with durable partial content. The logging policy
still reports the same eight unrelated MCP print violations. No migration or
gateway restart was required.

Root-agent bootstrap follow-up (2026-10-17): the stream's early root-agent lookup
now reads only ID, name, owner, default flag and root execution policy. The previous
full response also hydrated eight relationship collections and the agent type,
although bootstrap only consumed the name and policy presence. The new repository
projection and service preserve fresh default/owner/share-grant authorization,
not-found/forbidden errors, trimmed IDs, absent-policy mapping and existing inactive
agent behavior. No agent/policy/share cache is introduced. Full agent execution
and root delegation continue using their complete authorized definitions. Lease,
Stop, history, capacity and durable-write ordering are unchanged. Eight alternating
read-only pairs returned identical bootstrap values and measured medians
90.41 → 19.27 ms, with 11 → one database queries.

On the currently open Luna thread, two greetings before and two after deployment
measured root-agent lookup 184/128 → 19/19 ms (median 156 → 19 ms), bootstrap
348 → 249 ms median and full backend preparation 1,960 → 1,834 ms median. The
small live sample includes other-stage variation and does not establish a provider
speedup. Both new replies completed durably with valid question links, 17,023
cached input tokens each, reasoning usage and their expected six/eight seeded
history events plus private Responses state. All three earlier replies remained
present. Verification: 76 agent/service/PostgreSQL tests and 77 stream/cleanup/root
context tests passed, build, independent review, live timing panel and all backend
readiness checks passed. Denied bootstrap access is tested before history,
stream-start broadcast and model dispatch, while retaining lease cleanup and
error notification. No migration or gateway restart was required.

Stream-bootstrap follow-up (2026-10-17): numeric, Admin-latency-gated preparation
events now separate lease claim, context loading, root-agent lookup, history,
fleet admission and stream-start broadcast. Two baseline Luna turns placed context
loading at 138–157 ms, fleet admission at 99–107 ms, root-agent lookup at 83–101 ms,
history at 66–68 ms, lease claim at 26 ms and broadcast below 1 ms.

Recipient resolution formerly built a full conversation response, loading user
display profiles and the root agent's junctions only to discard them. It now uses
`ConversationService.getBroadcastMemberIds`, the same fresh default-filtered store
lookup, returning owner-first deduplicated group IDs. It does not reuse a stale
controller snapshot or cache membership. Non-group behavior, not-found handling
and the stream's warning/empty-recipient fallback remain unchanged. Existing
authorization, lease/Stop fencing, admission ordering, full history and synchronous
durable writes are untouched. Eight alternating read-only pairs returned identical
recipients and measured medians 125.81 → 27.28 ms, with 12 → one database queries.

Two greetings before and two after deployment measured median context loading
147 → 46 ms and bootstrap 438 → 357 ms (18%). Full backend preparation measured
2,255 → 1,996 ms; other stages also varied, so that larger change is not attributed
entirely to recipient resolution. Both after turns completed durably with valid
question links, 17,021 cached input tokens each, reasoning usage and all expected
40 imported events plus private Responses history. Verification: 115 focused
conversation/stream/cleanup/concurrency/timing tests passed (the cleanup suite was
rerun after updating its old DTO mock), build, independent review, live browser
timings and all backend readiness checks passed. The logging policy remains
blocked by the same eight unrelated MCP print-policy violations.

Backend database follow-up (2026-10-17): profiling placed connector authorization
at 530–607 ms, the largest measured child of workspace/agent preparation. Each
current-role check previously hydrated the user, memberships and role names before
fetching full roles: four serial queries. `AuthorizationService.getUserRoles` now
uses one fresh existing-user/membership/active-role join, preserving membership
order and transaction context. All account, destination, permission and repeated
connector authorization checks remain; no current-role cache is introduced.
History, model configuration, tool catalog and durable writes are unchanged.

Eight alternating read-only pairs using the same pool returned identical role
records and measured medians 80.67 → 20.92 ms (four → one queries). Two Luna
greetings before and two after backend deployment measured medians: connector
authorization 568 → 451 ms, workspace/agent resolution 797 → 697 ms and backend
preparation 2,378 → 2,241 ms. Warm turns measured backend preparation
2,216 → 2,025 ms. These small live samples include normal database variation;
they do not establish a provider speedup. Both after turns completed with durable
question links, 17,021 cached tokens each, reasoning enabled and all expected
36/38 imported history events plus private Responses state. Build, 44 focused
authorization/MCP/actor-guard tests, PostgreSQL revocation and transaction
regressions, independent review, browser timing inspection and backend readiness
passed. No migration or gateway restart was needed.

Cached-turn completion follow-up (2026-10-17): imported transcript events now share
one synthetic bootstrap invocation ID per import. Previously each message received
a distinct invocation ID, so ADK's interval-10 compactor treated old imported
messages as new invocations and made a discarded summarizer call after each answer
in an isolated successor session. All event IDs, full ordered content, timestamps,
private Responses history and atomic writes remain intact. Interval compaction
counts session-local invocations (the import counts once); token-threshold
compaction still evaluates the full transcript. Installed-SDK regressions verify
prompt conversion parity, interval triggering and token triggering.

A cached Luna greeting measured provider-terminal-to-agent-completion at 2,946 ms
before and 153 ms after, with the extra nano call absent after deployment. Both
read 17,021 cached tokens; the latter retained reasoning and all 26 imported events.
This removes post-answer latency, not provider queueing or reasoning time.

Prompt-cache follow-up (2026-10-17): Luna's zero cached-token counts were genuine
provider-reported zeros, not a loss in the pinned ADK/LiteLLM/gRPC usage mapping.
Azure's newer-model implicit cache boundary is the latest message; a changing
timestamp before that boundary prevented reuse of the otherwise stable prefix.
A controlled six-call gateway probe held model, key, reasoning and tools constant:
unmarked changing-timestamp requests read zero cached tokens, while warm requests
with an explicit stable-content breakpoint read 3,576 of 3,597 tokens.

For canonical GPT-5.6-and-later application-managed Responses requests, the adapter
now conservatively recognizes the exact factory-generated timestamp and represents
the complete existing instructions as one developer message with two text blocks.
The stable block receives `prompt_cache_breakpoint`; the second retains the timestamp
and every following ADK identity/schema instruction. Concatenated instruction text
is unchanged. The transformation happens after private replay preparation, so
history signatures, stored input items, reasoning and tool order are unchanged.
Ambiguous/custom instructions, unknown model aliases, older models, Chat Completions
and provider-managed Responses keep their original request path. No new cache key,
credentials, response cache, TTL setting or gateway restart is introduced. The
breakpoint support is qualified against the current Luna Standard deployment;
provider cache reads remain measured outcomes rather than guaranteed hits.

Runtime qualification: the first post-deployment Luna turn read zero cached tokens;
the next two read 17,021 of 18,452 and 17,021 of 18,633 input tokens without a
`prompt_cache_key`. The third turn correctly recalled the original `hi` message
and used 26 reasoning tokens; the UI showed 34,042 cumulative cached input tokens.
Provider TTFT was 5.96 s cold and 2.29/4.63 s warm in these small samples, so cache
reuse is verified without claiming a fixed latency improvement. The
controlled probe's key was held constant across its baseline and breakpoint cases;
the live result separately establishes keyless reuse. The native/history suite
passed 77 tests, including actual SDK streaming JSON, cached-usage propagation and
ordered encrypted-reasoning/function-call/tool-result replay. All seven prior
assistant messages remained present and all three new question/answer links
completed durably. The three successor sessions retained their expected 14/16/18
seeded history events and private Responses state.

Timing/prompt audit (2026-10-17): the timing panel and copied report now include
existing root delegation, execution admission, native-state write and session-seed
durations. Background readiness is explicitly overlapping work. The reported
2,118 ms backend example omitted 665 ms of these exclusive root stages in the UI;
its stored metrics already contained them. Legacy first-chunk, first-text and
completion timers begin at ADK dispatch, after backend preparation; their labels
now state that scope. First chunk may be setup/activity, while first token requires
text. Provider TTFT can precede text when reasoning summaries stream first.

The Smart Agent greeting used 17,202 input tokens with zero cached tokens; two
further greetings used 17,370/17,544 with zero cached tokens. Its configured base
instruction is 12,470 characters, with four connector bindings and no directly
assigned skills. These counts point to capability/configuration context as a major
contributor, not a long initial transcript; they are not an exact token breakdown.
The single-agent parent now moves only the exact
factory-generated timestamp suffix after root capability instructions and
deferred-tool installation,
making those unchanged capability blocks part of the stable cacheable prefix.
Custom instructions and leaf workers retain their layout. No instructions, tools,
reasoning settings, authorization checks or durable writes are removed. Existing
Responses compatibility checks may rebase native replay once after this instruction
layout change, retaining the application transcript. Cache availability and provider
latency remain measured outcomes, not guarantees.

Root session-seeding follow-up: exact PostgreSQL `DatabaseSessionService` instances
create the new session, initialize absent app/user rows without overwriting existing
shared state, and write the complete ordered transcript in one transaction. A retry
checks the same scoped seed key; conflicting keys fail. Source private-history
validation still precedes the write. Other dialects and custom/fenced services keep
the public fallback. This removes redundant reads, the target update and a separate
commit while preventing partial seeded sessions. Focused tests cover rollback at
event insertion and commit, ownership, state preservation and idempotency; the
configured isolated `agentstore_test` PostgreSQL qualification also checks concurrent
same/different keys and a subsequent SDK append. No authorization or history checks
are skipped; see the [upgrade checks](../../runbooks/adk-upgrade-session-seed-check.md).

Qualification: five alternating same-engine PostgreSQL pairs with the same ten-entry
transcript measured seed-write medians 309.59 → 177.06 ms (42.8%), six → four SQL
statements and two → one commits, with every transcript verified and test fixtures
cleaned from `agentstore_test`. Two live Luna turns before/after atomic seeding
measured full seed medians 701.04 → 587.53 ms and backend preparation medians
2,518.95 → 2,418.18 ms; the warm turns were 448.34 → 337.84 ms for seeding.
These small live samples include unchanged source loading and network variation;
they do not establish a provider speedup. Post-layout-change requests still reported
zero cached input tokens, so no cache-hit improvement is claimed. Verification:
134 ADK tests, 21 frontend timing tests, isolated PostgreSQL rollback/concurrency
and controlled benchmark, independent review, live panel and durable message links
passed. Full frontend TypeScript remains blocked by unrelated semantic-model
localization errors; the logging policy reports the same eight existing MCP print
violations outside this change.

Backend preparation follow-up (2026-10-17): numeric, Admin-latency-gated
`conversation.preparation.completed` events now separate agent roster,
configuration, skills, connector authorization and tool-token preparation.
No prompts, connector credentials or history enter these events. The Luna
greeting baseline placed 593–625 ms in connector authorization, 180–210 ms
in roster reads, 63–64 ms in configuration and about 23 ms in skills.
The public workspace/agent bucket therefore includes connector authorization,
not only workspace document loading.

Fresh account and role reads within each MCP authorization check now overlap;
`Promise.allSettled` preserves account-read/missing-account/approval denial
priority over role-read failure. Destination validation still precedes both,
and permissions/signing remain dependent on successful checks. Every call
re-reads the account and roles; this change adds no authorization cache. Existing
role-permission caching is unchanged. Skills load alongside
connector authorization and must succeed before agent assembly. Token minting,
durable writes and history ownership retain their existing boundaries, consistent
with accepted [ADR-0017](../decisions/ADR-0017-mcp-security-and-authentication-baseline.md)
and [ADR-0018](../decisions/ADR-0018-connector-managed-mcp-security.md).

Two Luna `Hi!` turns before and two after the deployed change measured median
workspace/agent resolution **894 → 732 ms** (18%) and backend preparation
**1,461 → 1,313 ms** (10%). Connector authorization measured **609 → 503 ms**;
skills no longer add a serial wait. These small live samples include ordinary
database variation and do not establish a universal latency guarantee. Provider
TTFT remained variable; no provider/reasoning/tool/history settings were changed.
Both after turns completed and remained durable. Verification: 135 focused
backend tests, build, 19 TypeScript SDK tests, 15 Python SDK tests, independent
review, backend readiness and browser latency-panel inspection. The aggregate
logging gate remains blocked by eight pre-existing MCP print-policy violations.

The composition/theme upgrade adds MiniRow, MiniColumn, MiniGrid, MiniPanel and
MiniText, with optional width/button/output presentation props. They retain the
existing MiniApp form, private autosave and document task/result identity. Names
and previous positional signatures remain compatible. Semantic theme tokens and
bounded numeric layout props support compact tools and responsive workflows.
See the [demo library reuse map](../architecture/openui-mini-app-library-map.md).
The shared generated prompt teaches compact tools, responsive workflows, search/list
apps and explicit document tasks through four parsed composition examples. Simple
requests can use these patterns without naming components. The document example
uses MiniDocument plus matching typed AskAgent/MiniTaskResult inputs; local actions,
private autosave and saved-result restoration retain their existing host ownership.
Mini-app initial hydration from accepted submissions is restricted to the signed-in
actor and the current task program digest. Same-actor legacy submissions remain a
compatibility fallback; other participants and replaced task programs do not seed
private drafts. Concurrent revision conflicts require explicit load or reapply.

SVG/dashboard reuse adds bounded reactive drawing primitives and pure aggregations
inside the same OpenUI library. Existing MiniApp drafts and document task identities
remain unchanged; static and saved reactive SVG/chart captures join current exports.
Explicit saved-view exports flush pending drafts and preserve private typed filters,
table/chart selections and authorized completed results. HTML/PDF/DOCX downloads do
not change the transcript; Create with agent sends the visible snapshot as an explicit
new turn through the configured MCP interpreter. Editable PPTX live qualification is
blocked by existing connector transport errors. HtmlView execution remains separately
scoped. See the [rich artifact qualification](../architecture/openui-rich-artifacts-plan.md#phase-b-implementation-and-qualification-2026-10-18).

Composer clipboard images use the same provider attachment/upload path for keyboard
paste and the custom right-click Paste action. An image-only clipboard becomes an
uploaded file; nonempty plain text takes precedence over Office clipboard bitmaps.
The provider still enforces attachment limits and the disabled-attachments setting.
Upload URL, direct upload, upload confirmation and message-send gates await
`ConversationSettingsService.isAttachmentIntelligenceEnabled()` before accepting
attachments. A stale cache must refresh instead of falsely reporting attachments
disabled; disabled policies and refresh failures still prevent acceptance.
Source: `front/src/components/ai-elements/input-context-menu.tsx` and
`prompt-input.tsx`; regressions: `input-context-menu.test.tsx` and
`prompt-input.paste.test.tsx` (2026-10-15).

Conversation provides persisted AI chat with streamed answers, agent routing, workspace context and collaboration.

Greeting latency investigation (2026-10-17, Luna Responses/Medium): a first `hi`
turn with no history, workspaces or files reported 25,917 input tokens and zero
cached input. Its configured root instruction was 12,470 characters and four
connector catalogs exposed 50 actions (65,003 stored JSON characters); these are
structural prompt contributors, not an exact breakdown of transmitted tokens.
The provider-first-delta interval was 5.68 s, ADK setup 668 ms and earlier backend
preparation 2.05 s. Provider timing starts before durable capacity acquisition and
the running transition, so it includes admission and request preparation rather
than measuring only the upstream model. The reported 8.39 s stream duration
starts after gRPC dispatch and excludes earlier backend preparation; first text
can follow a native summary. Do not add component intervals to the stream duration.
No evidence justified automatically removing tools or changing the selected
reasoning effort for greetings. Source: conversation `stream.service.ts` timing
boundaries and ADK `model_capacity.py`/`instrumented_lite_llm.py`.
After the durable-write change, a `hi again` turn with the same capabilities and
effort completed in 6.97 s, with provider-first-delta 4.35 s and ADK runtime
513.7 ms (previous 525.3 ms). This live difference is dominated by provider timing
variation; controlled database measurements establish the append improvement.
The follow-up also had source history to seed, so backend preparation is not a
like-for-like comparison with the initial empty conversation.

The subsequent catalog change (2026-10-17) replaces full initial connector schemas
with a compact complete catalog and on-demand `load_connector_tools`. Original
authorized actions and execution wrappers remain reachable in both APIs; selected
schemas last only for the current invocation. First tool use can add a loading step.
Responses fingerprints the full catalog, so loading preserves encrypted replay and
provider-managed history; actual capability changes still reset lineage. See proposed
[ADR-0021](../decisions/ADR-0021-conversation-deferred-connector-schemas.md).
The configured 50-action fixture measured 83% less initial schema JSON. Three paired
synthetic Luna greetings used 10,924 versus 2,268 input tokens and median elapsed time
2.05 versus 1.53 s. In the user's existing conversation, sticky Yellowmind routing
was retained for comparison: greeting input fell from 13.0–13.2K to 9.5–9.8K tokens
with longer history. Warm deployed greetings took 4.62 and 6.37 s, so the local
synthetic improvement is not a uniform end-to-end latency promise. Numeric runtime
diagnostics now distinguish acquisition/running admission (~149–160 ms warm) from
dispatch-to-first-ADK-response (3.33–5.05 s in those two turns). Existing public TTFT
retains its earlier boundary. An SDK lifecycle event can arrive before model output.
The live activity panel confirmed schema loading without executing the connector
action; a fresh same-agent marker was saved and recalled exactly on the next turn.

Follow-up upstream investigation (2026-10-17) identified avoidable HTTP/1.1 reconnects
after the installed SDK ends SSE at `[DONE]`. Responses now borrows HTTP/2-capable
network connections across per-turn clients; credentials, headers and cookies remain
separate. The initial implementation retained SDK five-second idle expiry (extended
to 30 seconds by the qualified follow-up below). Controlled gateway comparisons
isolated about 180 ms saved per reused connection, with all permits released and
unchanged reasoning, tools and history. Both Responses history modes and Chat
Completions passed two-turn deferred-tool checks; native high-effort summaries and
encrypted replay were observed. See proposed
[ADR-0022](../decisions/ADR-0022-conversation-responses-http2-pool.md).
Deployed Luna greetings negotiated HTTP/2 and returned normally. Warm calls reported
6–9 ms gateway overhead, at least 97% cached input, and dispatch-to-first-ADK-response
2.51–4.08 s; reasoning usage varied from zero to nineteen tokens without changing
effort. These UI calls exceeded the five-second reuse window and still paid TCP/TLS,
so their latency changes are not evidence of handshake savings. The matched factory
probes demonstrate that saving. Most remaining delay is outside measured gateway
overhead; transport reuse does not eliminate provider variability.

The subsequent no-gateway-restart optimization extends only shared Responses
connection idle retention from five to 30 seconds. Same-input gateway probes reused
connections after six/15/25 seconds and reconnected after 31 seconds; all nine permits
were released. The six-second comparison improved dispatch-to-useful output from
1,102 to 918 ms even though reported gateway processing rose from 710 to 721 ms.
This supports roughly 190 ms saved on reused connections, not a guaranteed reduction
in model generation. SDK connection counts, reasoning effort, tools, history and
capacity policy remain unchanged. Existing spend logs for the two Luna greetings
reported first-native-event times of 1,579/1,567 ms; they did not expose queue time.

Follow-up first-event profiling (2026-10-17) retained Luna Medium, Auto summaries,
all tools and the existing conversation history. Two greetings completed normally:
dispatch-to-useful-ADK output was 2.75/3.09 s. Upload-to-headers took 1.78/1.76 s;
headers-to-first-body 87.5/85.3 ms; first-body-to-native-event 71.8/2.1 ms (first
process call versus warm). The first lifecycle event preceded answer text by
368.4/1009.1 ms, while useful native output reached ADK in 0.5/0.2 ms. Both turns
used 13 reasoning tokens and at least 97% cached input. These results show remote
waiting/generation rather than local useful-output buffering; they are not a new
latency reduction claim. No effort, output limit, history or tool changes were made.
The SDK already caches parsing schemas; speculative private-SDK prewarming was not
added. Gateway-side queue/TTFT metrics are needed to separate queueing from compute:
the current gateway `/metrics` endpoint returned 404. Numeric stream diagnostics
preserve public TTFT semantics. Both APIs, tools, application encrypted replay and
provider chaining passed real-gateway qualification with all 12 permits released.

| Workflow | Existing behavior and source |
| --- | --- |
| Start and revisit a conversation | New-thread landing, history and paginated messages; [new page](../../../YellowStorm/front/src/modules/conversation/NewConversationPage.tsx), [store](../../../YellowStorm/front/src/modules/conversation/store.ts) |
| Ask and receive an answer | Optimistic user messages and incremental answer components over SSE; [API](../../../YellowStorm/front/src/modules/conversation/api.ts), [stream](../../../YellowStorm/front/src/modules/conversation/stream.ts) |
| Select or mention agents | Agent selection and sticky routing of mentioned agents on subsequent turns; [routing helper](../../../YellowStorm/back/src/modules/conversation/utils/sticky-agent-routing.ts) |
| Collaborate in a group | Group rendering, member management and mention-seen tracking; [group page](../../../YellowStorm/front/src/modules/conversation/GroupConversationPage.tsx), [controller](../../../YellowStorm/back/src/modules/conversation/controllers/conversation.controller.ts) |
| Revise or branch an answer | Edit user messages, regenerate answers, navigate branches or branch a conversation; [branch service](../../../YellowStorm/back/src/modules/conversation/services/conversation-branch.service.ts) |
| Add context | Link workspace documents, upload attachments and display citations/artifacts; [attachment resolver](../../../YellowStorm/back/src/modules/conversation/services/conversation-attachment-resolver.service.ts), [artifact service](../../../YellowStorm/back/src/modules/conversation/services/conversation-artifact.service.ts) |
| Share or give feedback | Share creation/revocation, public view, answer feedback and reports; [share service](../../../YellowStorm/back/src/modules/conversation/services/share.service.ts), [shared page](../../../YellowStorm/front/src/pages/SharedConversationPage.tsx) |
| Follow ongoing work | Root input/work panels expose pending input and background work; API provides epoch-aware stop/cancel and result/evidence retrieval; [root work store](../../../YellowStorm/front/src/modules/conversation/rootWorkStore.ts), [root-work implementation](../../../YellowStorm/back/src/modules/conversation/root-work/) |
| Continue in a playbook | Prepare a conversation playbook handoff through the existing controller/service; [handoff service](../../../YellowStorm/back/src/modules/conversation/services/conversation-playbook-handoff.service.ts) |

These are implemented entry points, not a guarantee that every deployment enables every capability or has configured agents/providers.

## Ownership and request flow

For an ordinary untagged standard turn, the composer model overrides the answering
agent's configured model, including a Root bound implicitly by the conversation.
Explicit `@` selections of one or multiple agents retain each agent's configured
model (or the Admin default when unset); their existing sticky routing is unchanged.
The effective model also determines model-specific prompts, supported reasoning
effort and the configured Conversation API. StreamService marks implicit root
routing separately from explicit agent IDs before AgentService resolves the model.
Answer footers prefer the recorded inference model so explicit agent replies display their actual model. Regression coverage: `agent.service.spec.ts`, `stream.service.spec.ts` and `MessageActions.test.tsx`.

Single-agent conversation parents use the explicit **Conversation API** choice
configured per model in **Admin > Models**. Chat Completions is the default for
existing/new models; Responses opts into native ADK Responses through the existing
LiteLLM gateway. The choice is independent of model name and is not an automatic
fallback. Application/ADK history remains authoritative for display and recovery.
Responses-only model controls select application or provider-managed inference
history, reasoning replay (none/last/all/auto), and native summaries. Defaults are
application/auto/off. Provider mode requires Auto and chains stored response IDs;
application mode replays private encrypted items with provider storage disabled.
Changing API/model/agent/configuration or edited/compacted history resets the chain.
Summaries use existing expandable activity rows, independently of replay; a model
may return no summary. Chat Completions ignores dormant Responses controls and
continues application-managed history. Encrypted state is never answer content.
Summary diagnostics (2026-10-17): native summaries were confirmed through the
Azure-backed LiteLLM routes with GPT 5.4 Mini, GPT 6 Sol and GPT 5.6 Sol using
High effort and a scheduling problem. Short marker-only prompts can legitimately
return none. Stream startup must forward the composer's `reasoningEffort` into
agent construction; omitting it caused displayed High to dispatch no effort and
produce zero reasoning tokens. Private Responses state records only the requested
effort/summary enums for diagnosis, never exposing opaque replay data. Output
guardrails continue suppressing unreviewed thought activity.
The native adapter joins adjacent summary sections in completed snapshots before
the activity tracker reconciles them, so later sections do not overwrite earlier
ones. Streaming deltas and tool boundaries retain their existing order.
Activity previews render inline Markdown; expanded summaries render safe
Markdown with paragraph spacing, lists and compact headings. Raw HTML and external
images are not rendered, and Markdown links retain the renderer's safe URL policy.
This display formatting does not alter stored summary text or private replay state.
Native summary activity carries optional, allowlisted `activity_kind=reasoning_summary`
over the existing gRPC component (`activityKind` in browser data). It comes from
explicit Responses summary events/output, never from prose or generic thought text.
The activity panel gives these rows a stable localized Reasoning summary title,
shows summary and tool counts separately, and hides empty completed preparation
rows once useful activity exists. Legacy untyped rows retain generic activity
behavior. Expand controls say Show activity details; existing pane resizing and
stream completion behavior remain unchanged.
Gateway compatibility qualification also covers a single ten-turn ADK session
switching GPT 6 Luna application Responses to provider Responses, GPT 5.4 Mini
provider Responses, Chat Completions and back to Luna provider Responses. The
2026-10-17 run passed five local tool executions, fifteen streamed provider calls,
original-context recall, incompatible-chain reset, compatible delta-only chaining,
public replay isolation, instrumentation and all fifteen capacity releases.
The live qualifier's `--require-replay` workload checks encrypted replay separately
from optional summary generation; a marker-only task may produce no reasoning.

Workspace/agent-resolution latency includes connector authentication. Independent
connector bindings now prepare concurrently in two phases: each preserves
destination/access/credential validation order, and every validation must succeed
before JWT binding starts. Credentials remain fresh per request; no authorization
checks or actor/destination isolation are cached or skipped (ADR-0017/0018).
The same four-connector live comparison on 2026-10-17 measured resolution at
2,219.83 ms before and 927.30 ms after (58.2% lower). Backend pre-ADK time fell
from 3,510.78 ms to 2,798.64 ms; history-seeding/provider time remains separate.
Tools, callbacks, gRPC/SSE components and persistence ownership are preserved.
Workers and manager/team execution retain their adapters. Truncated native streams fail
instead of finalizing partial text/tool calls. A private session adapter restores
reasoning replay omitted by the pinned ADK converter. See the runtime architecture
record and proposed ADR-0020.
Real isolated turns transfer compatible private replay context from the last
completed answer included in local history through the existing session seed
boundary. The runtime verifies the source transcript and actor before reuse;
missing or changed history safely starts a new chain.

1. The [hash router](../../../YellowStorm/front/src/Router.tsx) lazy-loads the new/existing conversation pages.
2. [ConversationPage](../../../YellowStorm/front/src/modules/conversation/ConversationPage.tsx) loads thread state and dispatches group threads to the group page.
3. The module API uses the shared API client; [message controller](../../../YellowStorm/back/src/modules/conversation/controllers/message.controller.ts) owns message HTTP operations.
4. Backend [StreamService](../../../YellowStorm/back/src/modules/conversation/services/stream.service.ts) prepares agent execution and invokes ADK `RunSingleAgent` or `RunAgentTeam` according to the built request.
5. The Python [chatbot servicer](../../../yellowstorm-adk/src/grpc_server/chatbot_servicer.py) executes the runtime side of that contract.
6. Backend stream gateway/controller publishes ordered events; the browser stream singleton and store reconcile answer components and active-stream snapshots.
7. Domain services persist through injected store tokens, rather than constructing database clients.

| Owner | Reuse entry point |
| --- | --- |
| Main UI/state | [conversation module](../../../YellowStorm/front/src/modules/conversation/), `store.ts`, `uiStore.ts`, `rootWorkStore.ts`; do not create a second owner for the same state |
| Browser event connection | [stream.ts](../../../YellowStorm/front/src/modules/conversation/stream.ts), [live-streams.ts](../../../YellowStorm/front/src/modules/conversation/live-streams.ts), [stream-buffer.ts](../../../YellowStorm/front/src/modules/conversation/stream-buffer.ts) |
| REST/domain orchestration | [ConversationModule](../../../YellowStorm/back/src/modules/conversation/conversation.module.ts), existing controllers and services |
| Runtime wire contract | [backend proto](../../../YellowStorm/back/src/modules/conversation/proto/chatbot.proto), [ADK proto](../../../yellowstorm-adk/grpc/proto/chatbot.proto); preserve mirror parity |
| Persistence binding | [ConversationPersistenceModule](../../../YellowStorm/back/src/modules/conversation/persistence/conversation-persistence.module.ts) and owning persistence interfaces |
| Database schema | [conversation.schema.ts](../../../YellowStorm/back/src/modules/postgres/schema/conversation.schema.ts), repository Drizzle migrations |

## Behavior and constraints to preserve

Standard streamed answers checkpoint their current components during the existing
30-second lease renewal, under the same owner/incomplete predicate. Recovery retains
that snapshot and appends an interruption marker atomically; it never marks the partial
answer complete. A hard crash can lose the uncheckpointed tail (up to one renewal
interval). PostgreSQL regression coverage is in
`postgres-message-store-cancellation.integration.spec.ts`; lifecycle coverage is in
`stream.service.spec.ts`. Client error rendering localizes the interrupted status.

- Conversation data is PostgreSQL/Drizzle backed. Mongo conversation/message collections are legacy; do not use them as current data.
- Message components are stored in a JSONB payload; change mappers and readers together when changing component shapes.
- Workspace documents remain in their owning Mongo/blob domain. Citation/artifact resolution crosses that boundary; it is not a second conversation database.
- The browser stream uses the current in-memory access token. Token refresh must replace the tokenized EventSource connection, rather than retry an obsolete URL.
- Replay cursors are opaque to consumers. Preserve reconnect/resync behavior, explicit disconnect cleanup and independent interleaved reply handling.
- Root-work stop/cancel APIs carry expected epochs. Reuse the existing concurrency protocol rather than adding unguarded cancellation.
- Public share output has dedicated sanitization/access behavior; do not reuse authenticated message payloads as unrestricted public responses.
- Latency UI is controlled by [features.ts](../../../YellowStorm/front/src/modules/conversation/features.ts); metrics depend on backend/runtime instrumentation and may be absent on historical messages.
- Frontend text uses the module EN/FR translations; shared auth, notification and error conventions remain authoritative.

The Yellowmind platform-copilot panel surfaces terminal stream errors through the
existing localized error-code pipeline, without rendering raw backend text. It
clears pending chunks and streaming state on failure. A terminal error or completion
received before the message POST resolves must not let that late response revive
the spinner; stale responses must not update another conversation. This uses the
shared stream connection, with bounded tracking only during the pending send.
Source and regression coverage: `front/src/modules/platform-copilot/`
`usePlatformCopilotConversation.ts` and `usePlatformCopilotConversation.test.tsx`
(2026-10-16).

## Conversation images (2026-10-15 implementation update)

The assigned `generate_image` tool accepts saved `generated-image:<id>` references,
public HTTPS raster-image URLs, and exact accessible uploaded/workspace image or PDF filenames.
`sourceImage` edits while preserving an imported original; `reuseImage` stages an existing
image without model generation. PDF inputs use a bounded, private rendering of `sourcePage`.
Authorization, guarded remote download and durable imports remain in the existing
[artifact service](../../../YellowStorm/back/src/modules/conversation/services/conversation-artifact.service.ts).
OpenUI resolves saved references after reload and labels generated/edited outputs, not imported originals.
Generated-image persistence enforces the conversation workspace's storage allocation.
ADK recognizes only the existing platform failure envelope with HTTP 403 / `ERR_1930`
as a storage-quota failure and returns a fixed actionable message; arbitrary server
messages remain hidden. It does not retry generation or override the allocation.
Coverage: ADK `test_generate_image.py`, including malformed/untrusted error bodies.
For MCP DOCX/PPTX creation, prepare every image with the tool before `sandbox_create` and use
only returned `sandboxPath` values. Titles, captions and shapes can remain editable; images are embedded pictures.
The deployed MCP service requires deliverables under `/mnt/yellowmind/run/outputs/` for
`send_file_to_user`; input paths under `/mnt/workspace/` are a separate contract.
The existing conversation module [README](../../../YellowStorm/front/src/modules/conversation/README.md)
describes the selectors and rendering contract. Focused coverage is in the artifact service spec,
`document-images.test.tsx`, ADK `test_generate_image.py` and `test_connector_tools.py`.
Live QA covered web photographs, `test_image.pdf`, direct PNG uploads, reload and six-image Office files.
Sandbox mount recovery verification is recorded separately with the runtime change; do not infer
concurrent-conversation sandbox isolation from image persistence.

Generated-file OpenUI buttons use `download_artifact` with the exact returned filename
or artifact ID. The browser resolves a unique ready artifact on that answer, requests
a fresh authorized download URL, and transfers it as a blob using the same path as
the attachment card. Legacy `open_url` references under `artifacts/main/` or sandbox
output paths are selectors only, never URLs fetched from model text. Unknown, pending,
or ambiguous artifacts do not download. Image captions must stay paired with their
exact reuse receipts and provenance; reference order does not identify an original.
Asynchronous file previews reset their centered geometry when opened from closed;
viewport resizing preserves centering or keeps a dragged window inside the viewport.
Coverage: OpenUI action/answer/renderer tests, file-viewer store and floating-window tests.

## Focused verification map

### Consistent saved-answer exports (2026-10-15)

HTML/PDF exports show literal captions beneath each image, in saved image order,
and keep image paragraphs with their following captions where print space permits.

Answer/conversation DOCX, HTML and print/PDF use a shared saved-program AST projection,
including collapsed/offscreen content, ordered image captions, native tables and chart
data tables. Existing scoped asset resolvers embed images; missing/unsupported content
fails explicitly. Obsolete regenerated answers are filtered before asset resolution.
The answer Export menu can send the same structured manifest plus document page
mapping to its conversation agent for MCP DOCX/editable PPTX creation. It does not
execute model-authored actions in the browser or imply successful file delivery.
See the module README and `document-export.test.ts`, `openui-export-assets.test.ts`,
`docx-export.test.ts` and `MessageActions.test.tsx` for the implementation contract.

### Interactive OpenUI answers (2026-10-16)

Maintainer source review: `5f71b6483`, including DTO/controller validation,
renderer hydration and the focused regression definitions. This review does not
rerun or independently certify the implementation's reported runtime QA.

Form submissions and filter/chart/table follow-up parameters keep their typed JSON
in the existing user-message `interaction` record (`type: openui`). The request's
`openUiSubmission` identifies its saved assistant text component and form name.
The server checks source ownership, completion, standard runtime, bounded JSON and
turn compatibility; the values remain untrusted user input, not business-policy
approval. OpenUI's declared field rules validate primary form submissions in the
renderer. The model receives exact JSON; the chat bubble displays the action label.

Named forms show submitting, saved and retryable-error states. Duplicate pending
or unchanged accepted submissions are suppressed; retries reuse their request ID.
Reload hydrates accepted typed form values from saved messages. Unsubmitted drafts
are local and are not restored after reload; no new persistence table or draft
store is introduced. Untouched slider defaults are registered as typed values.
Tests:
`send-message.dto.spec.ts`, `message.controller.spec.ts`,
`openui-submission.integration.spec.ts`, `interactive-forms.test.tsx`,
`OpenUiAnswer.test.tsx` and `actions.test.ts`.

### Scoped OpenUI image loading (2026-10-16)

Maintainer source review: `d04f3d8e0`, including cache lifetime, cancellation and
partial-failure regression definitions; runtime QA is separate implementation evidence.

Each answer provider owns an in-memory image cache scoped to conversation, message
and text component. Pending and completed loads share a promise by source and full
citation identity; no cache is shared across answers or accounts. Loads are limited
to four concurrent requests and 128 entries, with settled LRU eviction at 32 images
or 64 MiB. Failed entries are evicted. Scope teardown aborts queued/in-flight work;
each view revokes its own object URLs. PDF rendering also cancels and destroys tasks.

Image components render successful references progressively while naming each failed
reference with its own retry action. Retrying one failure retains successful image
URLs and other failure states. Source changes cannot publish stale results. Tests:
`document-images.test.tsx`, `document-images-cache.test.ts`, `pdf-image.test.ts`.

### OpenUI table exploration (2026-10-16)

Primitive-cell tables support a text filter, stable numeric/string column sorting
and row selection using original row indices. Applying a view submits typed
`__ysExplore` form state and selected row values through the existing OpenUI
submission contract. A changed filter clears selection. Tables containing
executable component cells retain the stock renderer.

Only applied views persist: reload hydrates their filter, sort direction and
selected rows; unsubmitted changes remain local. Initial default registration
reads current SDK state at effect time so StrictMode replay cannot replace a
hydrated view. Saved-answer exports use the applied filtered/sorted view and,
when rows are selected, only that selected subset. Typed values reach the existing
MCP export manifest; the export path does not execute component actions.
Source/tests: `DataTable.tsx`, `data-exploration.ts`, `DataTable.test.tsx`,
`MessageActions.test.tsx`, `document-export.test.ts` and `plain-text.test.ts`.
Live/export QA outcomes belong to the implementation checkpoint; this section's
maintainer review covers the source and regression definitions.

### OpenUI chart drill-down (2026-10-16)

Chat `BarChart`, `HorizontalBarChart` and `LineChart` support native series and
category selectors plus category drill-down buttons. These controls filter the
stock visualization and expose a textual selected-value summary. All series and
categories are selected initially; invalid saved indices fall back to those defaults.

Applying a chart view saves `ChartView` values under the existing `__ysExplore`
form state and submits original numeric series/category indices and selected point
values, including zero. Accepted views hydrate after reload using the same
effect-time default-registration guard as tables. Unsubmitted changes are local.
Saved-answer DOCX, HTML and PDF exports render the applied chart subset as an embedded
PNG using the native chart and its legend under a scoped light theme. The existing
editable chart data table and metadata remain included; table filters/sort order use
the accepted saved view. Capture uses saved program data, independently of mounted
chat DOM, and fails explicitly when rendering fails. MCP manifests retain metadata
and editable data tables. The controls and export path do not execute component actions.

Maintainer source review covers `ChartExplorer.tsx`, `data-exploration.ts`, chat
library overrides and `plain-text.ts`. Regression definitions in
`ChartExplorer.test.tsx` and `document-export.test.ts` cover typed zero values,
StrictMode hydration, stale indices and selected data exports; live QA and executed
test outcomes remain separate implementation evidence. Existing indexes remain
applicable because this extends the documented Conversation v1 feature.

### Image actions (2026-10-15)

Conversation system workspace storage can be adjusted under Admin → Workspace by
loading its workspace ID. This admin-only override is distinct from the default
quota for new conversation workspaces and the global per-file upload limit.
Existing workspace quotas use an atomic expected-allocation and live-usage check;
regular owner edits cannot change capacity. The existing upload settings record
owns the numeric policy; ordinary workspace defaults remain plan based. See
`workspace.controller.spec.ts`, `workspace-pg-stores.integration.spec.ts`,
`workspace-upload-settings.service.spec.ts` and `WorkspaceSettingsPage.test.tsx`.

Chat/report/slide image previews expose explicit edit, saved-image comparison,
reuse and authorized blob download actions. Edit/reuse retains the saved producing
text component and agent identity; unknown or ambiguous ownership fails closed.
Capabilities come from the agent's assigned image tool and configured interpreter
actions. Streaming/governed answers disable generation actions. PDF inputs disclose
page-based processing. Comparison uses scoped resolvers and revokes temporary URLs;
edit dialogs show the selected authorized image and caption. Office/slide reuse
shows the same image before submission and supports cancellation before sending.
Submission state points to the conversation's existing execution progress. These
dialogs never fetch model-authored URLs directly or start tools merely by opening.
Thumbnail/capture views do not host interactive controls. The module README and
toolbar, integration, document-image and report tests cover these boundaries.

Saved images expose a lazy Image history dialog. New edits record their exact
parent document in existing document metadata; originals remain unchanged. The
owner-authorized history endpoint validates the saved-answer anchor, then returns
only its family in the same conversation system workspace. Selecting a version
previews, downloads, edits or reuses that exact image. Reload reconstructs the
family from persisted metadata. Legacy images without lineage remain independent;
relationships are never inferred. Enumeration is bounded to 1,000 saved images
and fails explicitly rather than returning partial history. Coverage lives in
`conversation-image-history.spec.ts` and `ImageVersionHistory.test.tsx`.

Conversation presigned file uploads request storage-enforced create-only URLs,
like workspace single and bulk uploads. S3 requires a signed `If-None-Match: *`
header; Azure SAS omits overwrite permission. Reusing a new URL cannot replace
the saved object. Pre-deployment URLs keep their former permissions until expiry.
See the workspace module README for provider and retry constraints.

Run only the checks affected by the change. These commands identify existing coverage; they were not executed during initialization.

| Area | Command from owning package | Existing coverage |
| --- | --- | --- |
| Main pages and API | Frontend: `npm test -- src/modules/conversation/ConversationPage.test.tsx src/modules/conversation/api.test.ts` | Page loading/cleanup and request mapping |
| Stream reconnection and concurrent replies | Frontend: `npm test -- src/modules/conversation/stream.test.ts src/modules/conversation/live-streams.test.ts` | Token changes, replay cursors, retries and interleaved replies |
| Thread/domain operations | Backend: `npm test -- conversation.service.spec.ts conversation.controller.spec.ts message.controller.spec.ts` | Conversation and message behavior |
| Stream execution/boundary | Backend: `npm test -- stream.controller.spec.ts stream.service.spec.ts proto-mirror.spec.ts` | Subscription cleanup, cursors, orchestration and proto parity |
| Root/background behavior | Backend: `npm test -- root-background-lifecycle.service.spec.ts root-background-input.service.spec.ts` | Background lifecycle/input contracts |
| ADK identity/session behavior | Repository root: `conda run -n meta pytest yellowstorm-adk/tests/test_chatbot_servicer_answer_identity.py yellowstorm-adk/tests/test_chatbot_servicer_turn_sessions.py -q` | Runtime answer identity and turn sessions |

Frontend commands run in `YellowStorm/front`; backend commands in `YellowStorm/back`.
For visible changes, use an isolated browser at `#/conversation` and verify the specific acceptance criteria with owned test data.
Authentication, runtime availability, actual provider answers, database migrations and end-to-end streaming require separate live verification.

## Related context and documentation maintenance

- [System overview](../architecture/overview.md), [component map](../architecture/component-map.md), [ADK runtime](../architecture/adk-runtime.md).
- [Persistence](../backend/persistence.md), [backend realtime](../backend/realtime.md), [frontend realtime](../frontend/realtime.md), [QA fixtures](../testing/qa-fixtures.md).
- [Detailed frontend module README](../../../YellowStorm/front/src/modules/conversation/README.md) is a navigation aid; verify its examples against current code before reuse.
- [Architecture change control](../architecture/change-control.md) and [ADR-0007](../../../tools/opencode-harness/docs/decisions/ADR-0007-architecture-approval-and-documentation.md) govern new boundaries/persistence and durable design decisions.
- [ADR-0014](../../../tools/opencode-harness/docs/decisions/ADR-0014-advisory-checkpoints-without-edit-locks.md) governs advisory checkpoints without edit gates; it does not define product conversation behavior.

When behavior or ownership changes, update this record alongside the implementation and link affected contracts/tests. Update architecture documents when boundaries change, and add a proposed ADR for a new durable decision. Preserve accepted ADRs. Maintainer updates must use verified implementation evidence and identify any remaining live-verification gap.
