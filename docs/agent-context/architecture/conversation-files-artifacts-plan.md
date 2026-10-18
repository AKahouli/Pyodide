# Conversation Files & artifacts implementation plan

Status: **phases 1–4 qualified for the scoped Files & artifacts flow; extra-tab capacity limitation recorded below**. Assessed
2026-10-18 for the classic conversation route. User requested a scoped plan with
agent access, deletion, reload, two-user tests and separate implementation commits.

## Outcomes

1. One conversation panel lists uploads, generated outputs and accessible linked
   workspace sources, with preview/download and source-message navigation.
2. Agents can discover, inspect, read and reuse those same authorized items by
   stable reference over multiple turns, including after browser reload.
3. Deletion blocks subsequent platform/agent access, preserves understandable
   history and accounts for storage/index/sandbox cleanup failures explicitly.
4. Existing mini-app drafts/results restore without inference; exports remain
   tied to the requesting actor's saved view. Unsupported exports remain explicit.
5. Two users and simultaneous operations cannot mix listings, bytes, drafts,
   sandbox inputs, outputs, caches or privileges.

## Phase 4 end-to-end checkpoint (2026-10-18)

The user authorized final two-user uploads, reuse, deletion, reload/download
qualification and a separate commit. ADR-0017/0018 preserve current-actor access;
ADR-0025 preserves private drafts. Existing owners remain in use; no new table,
module, service or runtime. The screenshot's type dropdown/help paragraph were
removed; Use/Utiliser now adds a removable filename chip instead of encoded text.
Eight transient actor/conversation-scoped selections deduplicate by exact ref.
Submission serializes the existing selector text contract; failed sends preserve
chips and successful sends clear only captured nonces. Selection does not grant
access and does not persist through reload. Existing sent-message selector text
is not rewritten.

Two signed-in Chrome profiles uploaded different 154-byte `phase4-input.txt` files
simultaneously through the native composer. Exact refs and ALPHA-417/BETA-683
contents differed; six real foreign inspect/read/prepare operations were denied.
After reload both agents selected/prepared their own files and used the existing
`code-interpreort-aga` connector to create DOCX and editable PPTX concurrently.
All four outputs downloaded after another reload. Local Office inspection verified
project/budget/marker content, absence of the foreign marker, native PowerPoint
chart XML and embedded editable chart workbooks. Further turns prepared the saved
DOCX files and read actual paragraphs through MCP: Orchid/417/ALPHA-417 and
Juniper/683/BETA-683. Both real agent foreign-reference reads were denied.

On explicit browser confirmation, only both new inputs and both Phase4 DOCX files
were deleted, with concurrent operations across users. PPTX outputs, Phase2 files
and local downloads remain. Current checks show 24 own/foreign deleted-ref denials,
complete byte cleanup and exact refunds: A 147433 → 108968 bytes; B 146379 → 109409
bytes; document counts five → three. Both retained PPTX files downloaded after
deletion and reload, with SHA-256 hashes identical to their original downloads.

Two confirmed regressions were fixed: home Recent files included deleted canonical
documents whose old message card lacked a deletion marker; both SQL eligibility
and projection now exclude unavailable/tombstoned sources. Fresh sessions also
entered a cross-tab rotation/revocation loop because peers reconnected with stale
access tokens. The existing in-memory channel now hands off fresh same-principal
tokens before reconnect; no credential persistence or backend-policy relaxation.
See proposed [ADR-0029](../decisions/ADR-0029-cross-tab-access-token-handoff.md).
Both profiles subsequently restored on reload without another sign-in.

An extra Home tab then exposed 30-second API timeouts consistent with HTTP/1.1
connection starvation from idle notification pipes. Existing notification owners now pause
hidden-tab EventSource/timers and refetch the durable list/unread count on return;
agent streams/execution remain active. Eleven focused tests, full frontend
typecheck and independent visibility/catch-up review passed. The extra Home check
passed for A but timed out for B. Closing only our temporary Home tabs restored
both conversation panels. Source review confirms classic SSE remains global for
group messages, externally started runs and copilot; limiting it to the current
route could drop those events. Sharing those connections needs a separately scoped
ownership design. Multiple visible windows can still exhaust HTTP/1.1 capacity;
the hidden notification pause does not resolve that case. No speculative classic
stream change was applied. The existing ten-minute bearer-URL window is unchanged.

Passed evidence so far: backend 52 focused tests including 11 real PostgreSQL
cases, backend build, frontend chip 21 tests, panel 12 tests, auth/recovery 22 tests
and frontend typecheck. Independent reviews accept the panel/chip, home query and
auth and notification boundaries. The scoped two-user flow is complete; the extra
visible-tab limitation remains explicit. Prior unchanged export/image/draft evidence
remains as recorded in earlier phases; it is not represented as a fresh rerun.
Repository observability policy check fails on eight existing print-diagnostic
sites in Outlook/SharePoint/Team MCP files outside this phase's changed paths.

## Phase 3 implementation checkpoint (2026-10-18)

User authorized deletion implementation/testing and separately confirmed permanent
deletion of the two synthetic `same.pdf` files, `Phase2-Orchid.docx`,
`Phase2-Juniper.docx` and the disposable `Phase3 deletion QA` program. Other files
and independent PPTX copies are retained. ADR-0017/0018 govern trusted current
access; ADR-0025 preserves private drafts. Existing owners are extended without
a new table/module/service/runtime.

Authenticated DELETE `conversations/:id/assets/:ref` returns logical deletion and
separate blob/index cleanup outcomes. Current creator/uploader authorization and
source-match component updates prevent cross-user writes and concurrent answer
overwrite. Document tombstones immediately deny reads, RAG hydration, staging and
new URL resolution; quota refunds once under the workspace tree lock. Late indexing
writes must not replace a tombstone. Reserved `asset*` metadata is server-owned.
Program deletion removes the saved executable source but retains private draft
rows and unrelated components. Historical cards become unavailable; copy/export
does not resurrect deleted content.

Failed cleanup remains persisted in existing metadata. The first listing page
returns at most 50 owner-authorized retry references separately from active assets;
the frontend preserves them across empty source pages and reload. Agent discovery
strips this UI-only field. Retry cannot refund quota again. Cleanup tracks canonical
blobs, bounded deterministic prepared/image aliases and registered MCP source
provenance; mutable source aliases are digest checked to preserve newer outputs.
Index failure is truthful and retryable; stale index hits are authoritatively denied.

Interpreter calls verify trusted revocation state and prepared-input receipts;
registration rechecks epoch/receipts under the deletion lock, rejecting publication
if deletion happened during output read. Cleanup pending on bytes blocks reuse.
These checks do not recall delivered bytes, independently saved outputs or bearer
URLs already issued (up to ten minutes). Mutable external storage aliases still
have a hash-check/delete race without a storage version API; immediate physical
erasure is not promised. Legacy implicit connector workspace manifests retain
their existing authorization lifecycle, separate from explicit asset receipts.

Qualification PASS: backend 164 focused tests (including nine real PostgreSQL
integration cases), backend build, frontend typecheck and focused panel/API,
history and export tests; ADK 44 connector and 21 asset-helper tests. Independent
boundary review ACCEPT. Coverage includes concurrent/idempotent deletion, cleanup
recovery, quota admission, source CAS, RAG/read denial, stale staging, in-flight
registration, cumulative receipt validation and frontend export behavior.

Both signed-in browser profiles deleted their approved PDF and DOCX; the two DOCX
deletions ran concurrently. The disposable mini-app was identified by its exact
reference and deleted. Reload showed unavailable history with disabled document
view/download cards and no executable mini-app. Its draft had visibly restored
before deletion; opening the independent sales/operations artifact retained North,
75, `Saved North`, false and Night, zero, empty, false without inference.
After reload, 30 real internal inspect/read/prepare attempts for deleted refs were
denied across current and foreign actors. Creator/uploader/participant/foreign
DELETE authorization is covered at the service boundary, not claimed as a live
cross-user public DELETE test. An actual agent listed assets and its exact deleted
DOCX read returned `Asset unavailable or access denied`.

Quota changed from 109975 to 72379 bytes and 111181 to 73499 bytes respectively;
both document counts changed from four to two, matching the exact file refunds.
Both retained reused PPTX files downloaded after reload with hashes identical to
their earlier copies. Revocation epochs existed and byte cleanup was complete.
The stale OpenUI DOCX download link did not produce a new file. Logical deletion
does not rewrite prose in unrelated answer components. No saved agent task reran
on reload. Backend and ADK were restarted on the verified source and left running.
Repository-wide observability policy still reports the same eight unrelated MCP
print violations; the gate is FAIL, not waived or represented as passed.

## Phase 1 implementation checkpoint (2026-10-18)

The user explicitly authorized phase 1 (panel + agent discovery/read, testing and
a separate commit). Existing owners are extended with no new table, service class,
module or runtime. The existing context panel has a Files tab/header shortcut;
OpenUI's installed Workspace custom slot hosts the adapted listing without a
second ChatProvider. Desktop resizing, mobile Sheet and EN/FR remain in use.

Existing authenticated conversation routes expose GET `assets`, `assets/:ref`,
POST `assets/:ref/read|url`; the internal root-work controller exposes three ADK
operations through its existing guard. Bounded base64url selectors identify stored
document/artifact/message records, never authorize access. Each operation rechecks
participant/governed scope and workspace access. Listing excludes URLs/storage
keys; read returns bounded extracted text, image input (up to 6 MiB), saved program
source or explicit unsupported. Evidence-backed reads preserve evidence authorization
and remain unsupported until evidence-owned bytes are available. Private drafts
are not read. A logical artifact currently groups apps in one saved text component.

Pagination walks document sources and fixed message windows with intra-window
offsets, honoring asset limits without losing components. Frontend skips up to
three empty source pages and retains explicit continuation. Operational source
failures show separate alerts; authorization failures propagate. Upload confirmation
and message/stream changes refresh the list. Actor/conversation keys reject late
results. Only pane visibility/width persist in browser preferences.

Native list/inspect/read tools are baseline capabilities when trusted runtime
context exists in default/delegated agents. Use in prompt inserts a readable draft
selector, not an access grant or automatic send. Structured reference chips, staging,
output registration and deletion remain later phases. Existing generated-file
metadata and workspace records supply the panel; unsaved exports are not registered.

Verified: frontend 23 focused tests and typecheck; backend asset/broader regressions
(source outage vs denial, multi-component pagination and mixed evidence metadata);
ADK 6 tests; independent boundary review ACCEPT. Live two-user uploads of different
`same.pdf` files produced distinct refs/bytes/hashes and survived reload. Six real
cross-user list/inspect/read operations were denied; the second browser could not
open the first conversation. Existing OpenUI programs and both private dashboard
views restored unchanged. The first default agent called all three tools and read
Orchid/173 from its PDF. Frontend production build passed in 3m12s.

Final browser evidence captured the first profile's panel, PDF preview and correct
agent result. After second-account sign-in, its final preview and another full
reload PASSED: same.pdf remained ready and displayed only BETA/Juniper/289, with
the same document reference and original two messages; no agent was rerun.
That profile's default-agent inference is separately BLOCKED by an existing
protected MCP provider credential, not asset authorization. Repository observability
policy reports eight violations in unrelated MCP files, none in this asset scope;
do not mark that repository-wide gate passed.

## Existing owners and verified reuse

### Phase 2 implementation checkpoint (2026-10-18)

The user authorized interpreter reuse/output registration and separate commit.
ADR-0017/0018 require trusted invocation identity and current access; ADR-0025
keeps drafts private. Existing ConversationModule, workspace document writer/store
and ADK connector wrappers remain the owners; no new table, service or runtime.

`prepare_conversation_asset` calls internal `assets/prepare` with the trusted actor,
conversation and invocation. The backend resolves the exact ref, rechecks current
access and readiness, reads bounded bytes and returns their SHA-256 plus a
content-addressed sandbox path. It rejects programs and evidence bytes. Paths
deduplicate the same source version within the actor/conversation; each invocation
must obtain its own receipt before sandbox creation. The existing mount guard
injects those exact keys for `code-interpreter`/`code-interpreort-aga`, with no path
discovery or filename substitution. If the coordinator omits an exact input, an
authorized binary-upload action can transfer freshly reauthorized bytes to that
same path. A private internal prepare option supplies at most 10 MiB; payloads
never become model tool results or logs. The runtime checks the receipt digest,
transfers only selected bytes, verifies the sandbox hash, then rechecks the mount
guard. Unsupported/failed transfers remain explicit failures. Staged input cache cleanup remains phase 3;
repeated turns do not create a copy per invocation.

The interpreter's successful `send_file_to_user` receipt is registered through
internal `assets/register`, never exposed as a model-controlled raw-path tool.
The backend validates source scope, reads actual stored bytes, and uses the
existing workspace tree transaction lock/direct upload owner for quota, immutable
storage and retry deduplication. Provenance and ready state commit together;
metadata failure rolls back rows/quota and removes the newly allocated blob.
Both streaming consumers accept only the interpreter wrapper's trusted canonical
receipt. Canonical document IDs suppress duplicate message/list entries. A new
content version is a separate file; ordinary downloads remain transient.

Current direct registration uses the existing small-file upload limit (default
10 MiB); larger outputs fail explicitly rather than being marked ready. The
bounded source read ceiling is 50 MiB, not a higher publication allowance. Browser
export Save to conversation and structured composer chips are deferred; the
existing readable exact-reference selection is sufficient for interpreter reuse.
No automatic draft publishing, arbitrary workspace sharing or deletion is added.

Focused checks: 19 backend unit tests, 4 real PostgreSQL integration tests and
the WorkspaceModule export regression PASS in focused runs; backend typecheck
and production build PASS. Integration proves concurrent registration uses one
document/PUT/quota charge, metadata failure rolls back and retry succeeds, and
quota failure creates no ready output. Friendly filename search retains escaped
literal matching and workspace boundaries across all existing listing variants.
ADK assets/connector/artifact checks (57) and image/hydration callback checks (43)
PASS, as does compilation. The full mount-guard suite has four existing failures
from its missing `src.flow_engine.mcp.call_mcp_tool` monkeypatch target; its new
hydration callback regression passes. Independent
security/correctness and feature/README review ACCEPT. Live simultaneous prepare
checks for both users PASS: different same-name bytes/hashes, stable retry paths,
and denied cross-user preparation. Live Office generation, registration and the
four original downloads PASS; further saved-output reuse is recorded below.

Live qualification found an adapter identity mismatch: isolated root execution
uses an ephemeral ADK turn/session ID, while native asset preparation uses the
durable conversation ID. Sandbox headers, storage prefixes and output capture
must use the trusted canonical conversation context; ADK session/event identity
remains separate. Equal-ID fixtures did not expose this. A distinct-ID regression
and a repeated live sandbox run qualify the correction. A direct diagnostic
through the same configured connector confirmed the coordinator received the
correct key but mounted an empty input directory, while storage HEAD verified
625 bytes. The existing binary-upload action successfully hydrated only the exact
receipt path. This motivates the bounded transport fallback, rather than guessed
alternative paths or ignoring missing inputs.
The live transfer also exposed that this sandbox offers `python3` without a
`python` alias; private remote hash verification now uses `python3`, with a focused
command regression. No package installation or sandbox security change is needed.
The MCP repeats shell output in both `result` and `text`; the digest check accepts
repeated identical hashes and rejects empty or conflicting hashes.

Live phase 2 QA uses two private conversations (`c66d50ba8780ea080b2c52d5` and
`c25a12c654d6130d30139547`) with different synthetic `same.pdf` bytes: Orchid/173
and Juniper/289. No real private source content or credentials enter this record.

| Check | Outcome / decisive evidence |
| --- | --- |
| Existing configured interpreter, uploaded PDF → Office | PASS: both actors discovered/prepared their own exact PDF and created DOCX plus editable PPTX through the configured MCP. |
| Canonical registration and reload | PASS: four original outputs appear once as ready documents in their respective Files panels after full reload. |
| Downloads / Office content | PASS: Orchid DOCX 36,971 B and PPTX 35,156 B; Juniper DOCX 37,057 B and PPTX 37,302 B. ZIP/XML inspection verifies each project/budget, editable paragraphs/text, native chart values and embedded editable workbooks; no other user's project. |
| Current output permissions | PASS: 18 cross-user inspect/read/prepare attempts against all six outputs return 404; foreign outputs absent from listings. Both actors can prepare their own saved Office outputs in a fresh invocation. |
| Saved DOCX → new editable PPTX after reload | PASS for both users through actual agent discovery/preparation/read/generation/registration. The reused decks survive another full reload and download: Orchid 37,223 B, Juniper 36,197 B. Each has two slides, editable text, a native chart with the actual budget and an embedded workbook. |
| Retry/concurrent safety | PASS: live simultaneous source preparation has distinct bytes/hashes and stable retry paths. Real PostgreSQL tests prove one canonical registration/PUT/quota charge per receipt and rollback on failed metadata/quota. |

Browser QA also exposed unnecessary v2 SSE pipes on classic tabs. A separate
existing-owner lifecycle correction retains current/background v2 runs, connects
unused v2 only on Studio/legacy v2 routes, and prevents token refresh opening an
unused pipe. Its 36 focused frontend tests and typecheck PASS; review ACCEPT.
Both users' fresh requests and the previously stalled PowerPoint download passed
after reload. Multi-tab connection pressure is source-confirmed; the earlier
single-tab stall's complete cause is not established. See the frontend realtime
contract for the scoped lifecycle behavior.
The QA conversations retain a phantom running placeholder from earlier interrupted
test executions. Saved answers/files remain complete and no inference is triggered
by reload; interrupted-work reconciliation is a separate remaining issue. Live
MCP calls were occasionally slow, but the final six Office files were delivered
and verified; no input/mount/hash check was bypassed to obtain those results.

| Owner | Existing implementation | Planned reuse / gap |
| --- | --- | --- |
| Conversation panel | `front/src/modules/conversation/components/ConversationContextPanel.tsx`, `uiStore.ts` | Add Files & artifacts alongside Outline/Work; retain resizing, mobile sheet, focus and keyboard behavior. |
| OpenUI | Installed react-ui/react-headless 0.18.1, react-lang/lang-core 1.0.1; react-ui `AgentInterface/Workspace.d.ts` | Reuse artifact registration, category/preview/detail concepts and compatible installed primitives. Workspace requires its owning thread context, hides on mobile and has no built-in filters. Qualify an adapter before wiring; do not introduce a second chat/thread persistence owner. |
| Uploads / workspace sources | `ConversationFileController`, `ConversationService.getUploadedDocuments/getWorkspaceDocuments`, frontend `fetchConversationFiles/fetchConversationWorkspaceDocuments` | Existing paginated files and linked-workspace lists. Upload listing requires current membership; workspace sources are filtered by current workspace access. Preserve attachment-intelligence policy gates. |
| Images / generated files | `ConversationArtifactService`, `MessageController`, frontend artifact/image/history URL APIs | Persisted image references/history, message artifact metadata, fresh authorized URLs. Add per-conversation unified listing; recent-artifacts listing alone is insufficient and must not require loading all message pages. |
| Files / cleanup | `WorkspaceDocumentService`, `workspace/document/document-tree.ts` | Reuse upload limits, quota, storage, preview and deletion. Current delete catches blob failure and dispatches index removal asynchronously: this is a qualification gap, not proof of complete erasure. |
| Agent / MCP | ADK `utilities/generate_image.py`, `connector_tools.py`, `native_tool_registry.py` | Reuse image staging, artifact capture and existing save_file_to_workspace capability. Add general discovery/read/stage wrappers using the existing backend/runtime boundaries. |
| Mini-apps | Existing OpenUI program, private draft and task/result routes | Logical artifacts stay linked to saved source programs; file exports are distinct outputs. Never place document bodies or file bytes in draft JSON. |

Paths above are relative to `YellowStorm/` except ADK, which is under
`yellowstorm-adk/src/smart_rag/tools/`. The existing workspace-artifact module
currently owns decision flows; its name is not justification to move conversation
files or private drafts there.

Upstream references: [Workspace](https://www.openui.com/docs/agent/reference/components),
[custom artifact renderers](https://github.com/thesysdev/openui/blob/main/docs/content/docs/agent/guides/custom-artifacts.mdx).
Pin implementation to installed exports; do not silently upgrade all OpenUI packages.

## Constraints and design scope

- ADR-0025: private actor/source/program drafts, bounded typed JSON, revision checks,
  no inference on reload and no file/result bodies in the draft store.
- ADR-0017/0018: retain connector authentication and per-call actor isolation;
  never trust a model-provided user ID, workspace ID, raw path or URL as authority.
- Preserve the user-approved HtmlView boundary recorded in proposed ADR-0028:
  file/task APIs remain host-owned; no new ambient tool access from generated JS.
- Proposed **Conversation asset projection**: extend existing ConversationModule
  controllers/services/stores and current document/message JSON metadata. No new
  module, service class, table, namespace, runtime or independent storage owner.
  A normalized response contract is not a second persistent registry.
- Schema/types remain backward compatible: absent new metadata means legacy
  behavior. If existing records cannot support durable output registration,
  deletion or atomic updates safely, present a named persistence proposal before
  implementing that change under change control. This plan does not approve it.

## Asset and agent contracts

### Shared projection

Return an opaque stable asset reference, origin (upload/generated/workspace), kind,
display name, MIME/size where applicable, status, source message/component,
canonical document/artifact reference, version lineage where known, and allowed
actions computed for the requesting actor. URLs, raw storage keys and bodies are
not listing fields. Do not infer provenance from filenames when metadata exists.

Use canonical document IDs for files and persisted artifact IDs for generated
files. Derive logical OpenUI identity from saved message/component/node identity;
derive program version from its digest, not a render-time random ID. Legacy nodes
without explicit IDs need deterministic extraction with regression fixtures.
An exported DOCX/PPTX/PDF is related to its logical artifact, not its identity.

Proposed routes under the existing conversation owner (names finalized with DTOs):
`GET :id/assets`, `GET :id/assets/:ref`, `POST :id/assets/:ref/read`,
`POST :id/assets/:ref/stage`, `DELETE :id/assets/:ref`.
Reuse existing URL/preview routes rather than creating duplicate download logic.
Backend constructs scope from authenticated conversation membership plus owning
workspace authorization; client capabilities are display hints only. Use bounded
pagination/filtering; list assets across all saved message pages without scanning
the full transcript on every request. Partial source failures stay visible per group.

### Agent access is part of the first delivery

Proposed tool names: `list_conversation_assets`, `inspect_conversation_asset`,
`read_conversation_asset`, `prepare_conversation_asset`.

- List discovers ready accessible files and logical artifacts without requiring
  exact filenames, current viewport messages or an already-known storage path.
- Inspect reports provenance, type, readiness and permitted operations.
- Read uses bounded authorized text extraction/retrieval, image input or structured
  saved artifact content as appropriate; unsupported/binary types get a clear result.
- Prepare stages only the selected authorized bytes through the current MCP
  code-interpreter path and returns an execution-scoped receipt. Resolve exact
  versions; never silently substitute a different image or duplicate filename.
- Actor/conversation come from trusted runtime context, never tool arguments.
  Recheck access at use time, including revoked workspace access and group removal.
  Delegated tools retain the same actor/scope and existing connector restrictions.
- Generated outputs register only after durable storage succeeds. Pending/failed
  outputs cannot appear ready. Retrying the same output receipt is idempotent.
- Re-list/inspect in later turns; transcript filenames and old tool receipts do not
  establish current access. File instructions remain untrusted document content.
- Agent guidance teaches discovery before asking users to re-upload a ready item.
  Metadata discovery does not attach every document body to every inference.
- User “Use in prompt” adds explicit reference chips. Extend the existing send DTO
  with a bounded validated asset selection if needed; do not overload upload IDs
  or the MiniDocument-only appTask contract. Selection scopes the explicit task;
  it does not expand workspace access or silently disable ordinary authorized RAG.
- Agent deletion is excluded from this scope; user deletion uses explicit UI.

## Separate implementation commits

### 1. `feat(conversation): expose authorized assets to users and agents`

Implement the projection and list/inspect/read tools in existing owners, plus the
OpenUI adapter inside the existing context panel. Sections: Uploads, Generated,
Workspace sources; search/type filters, readiness/error states, preview/download,
use-in-prompt and source-message navigation. Logical reports/slides/apps can open
their current existing viewers. Preserve EN/FR localization and accessible mobile
sheet. Share identities/query invalidation with message attachment cards.

Acceptance: PDF, pasted PNG, generated image, MCP DOCX/PPTX and logical dashboard
appear once with correct origin; agents discover/read the same references through
tools. Pagination includes artifacts from unloaded message pages. Duplicate names
remain distinct. Failed image/preview/list source does not hide other entries.
Read-only/attachment-disabled contexts retain their existing policies. No duplicate
chat provider, inference or task execution is introduced by opening the panel.

### 2. `feat(conversation): reuse assets through the code interpreter`

Complete explicit reference selection and read/stage-to-MCP integration. Reuse the
existing connector **code-interpreort-aga**, image preparation and output capture.
Register generated Office files and explicitly saved browser exports through
current storage APIs. Ordinary Download can remain transient; clearly distinguish
it from Save to conversation so downloads do not create unlimited hidden copies.
Reuse existing save-to-workspace ingestion where applicable, with destination
write checks, quota and explicit sharing disclosure. Do not auto-publish drafts.

Acceptance: after reload the agent discovers a previously uploaded PDF, generated
image and ready Office output; summarizes the PDF, edits the chosen image, and
creates DOCX and editable PPTX with the exact selected version. Inspect downloaded
files: text/shapes remain editable and images are embedded pictures. Repeat across
3–4 turns with duplicate filenames and no re-upload. Output appears once, downloads
after reload and survives sandbox expiry. Permission/quota failures publish no
ready output; cancellation/retry cannot bind another run's receipt. Transport
failures are BLOCKED, never marked passed or bypassed with an unrelated connector.

### 3. `feat(conversation): manage asset deletion and history safely`

Conversation-owned files: explicit delete, server permission checks, idempotent
cleanup and quota updates. Persist bounded unavailable/deletion metadata in the
existing owning message/document contracts where required; remove the asset from
active listing/tool results while keeping a readable history placeholder. Use
atomic source-match updates so deletion cannot overwrite a concurrent answer edit.
Version deletion affects that version only; do not silently cascade to descendants.

Linked workspace sources: panel offers selection and opening the owning workspace;
original deletion stays in that workspace. Reuse existing whole-workspace unlink
behavior where available. Per-document exclusions from a linked workspace are
deferred; pretending a local hidden row removes RAG access is unacceptable.

Logical artifact deletion marks its saved reference unavailable; it must not delete
the entire assistant message or unrelated artifacts/private drafts. Source data
and independently saved copies remain separate. Deleting the source conversation
continues through its existing lifecycle, not a parallel cleanup implementation.

Audit/qualify blob/index/cache/profile/sandbox cleanup. Block new resolution/staging
immediately after acknowledged logical deletion; failed physical cleanup must be
reported accurately and retryable without double-decrementing quota. Filter stale
retrieval hits against authoritative availability. For running sandboxes, determine
whether inputs can be removed safely; otherwise cancel/expire affected execution
and reject publication based on stale receipts. Do not claim already delivered
bytes, completed derived files or bearer download URLs can be recalled. Existing
generated-file URLs have a ten-minute expiry; record that revocation window. An
authenticated proxy for instantaneous URL revocation is a separate design decision.

Acceptance: user/agent reads, staging and new download resolution fail after
deletion/reload; historical cards show unavailable. Index/blob failures and retries
are exercised, quota changes once, and unrelated copies/versions remain usable.
Test delete versus download/stage/output publication and simultaneous deletions.

### 4. `test(conversation): qualify asset reload and two-user isolation`

Add any integration fixes with meaningful regressions and complete the live matrix
below using dedicated browser contexts and synthetic fixtures. Separate commit;
earlier commits still include their own focused unit/integration tests and UI QA.
Update conversations feature docs, owning READMEs and affected contracts alongside
each phase; review high-risk boundaries before marking the implementation complete.

## Final acceptance matrix

| Scenario | Expected evidence |
| --- | --- |
| User A and B upload simultaneously, including same names | Different canonical IDs/bytes/quotas; each listing, agent tool and download sees only its authorized items. |
| Tampered references | B cannot list/inspect/read/preview/download/delete/stage A's private asset by changing conversation, message, document, artifact, workspace or version IDs; no title/MIME leakage in error payloads. |
| Shared workspace | Both see only intentionally shared sources; revocation prevents subsequent read/stage/download resolution; no private conversation upload or actor draft becomes shared. |
| Two conversations under one user | Switching rapidly or accepting late responses cannot mix selections, previews or caches. Neither conversation's private files become implicit context for the other. |
| Agent multi-turn + reload | Upload → inspect/summarize → edit/reuse → Office creation, with reload between steps; stable references and durable outputs, no reliance on old sandbox paths. |
| Mini-app reload | Typed zero/false/empty values and saved task results restore without rerunning agent; exports match the actor's acknowledged saved view, not another user's draft. |
| Simultaneous updates/deletion | CAS conflicts remain explicit; duplicate outputs/deletes are idempotent; no stale staging/publication after deletion acknowledgement. |
| Download + expiry | Open/download all ready formats after full reload and fresh URL resolution; expired URLs refresh; bytes/hash/type match selected version. |
| Failure paths | Attachment-disabled, quota/full upload, revoked access, unavailable blob, stale index, missing sandbox, failed cleanup and interrupted upload have clear bounded outcomes. |

Tests: focused Nest controller/service/store tests, ADK pytest through `conda run
-n meta`, frontend interaction tests/typecheck, desktop/mobile browser QA and an
independent boundary review. Existing exports/images/forms/charts/reports/slides
are regression inputs. Record PASS/FAIL/BLOCKED/SKIPPED individually; do not claim
cross-user or MCP isolation from unit tests alone. Never reuse real user content
for destructive fixtures. Existing session sign-in stays in each private browser.

## Delivery / rollback / deferred scope

Commit sequence is four implementation commits, not authorization to start them
from this planning request. Each must have focused checks and recorded evidence;
the fourth completes cross-phase live qualification. Preserve unrelated dirty work.
Existing message cards and APIs continue working if the panel/adapter is rolled
back; retain any deletion markers so a UI rollback cannot resurrect access.
No migration is planned; stop for a named design if actual persistence needs differ.

Deferred: trash/restore retention service, agent-initiated deletion, bulk destructive
operations, a global file drive, per-document RAG exclusions, automatic publication,
arbitrary sandbox path browsing, and HtmlView visual export (still its own phase).
The plan does not claim current storage deletion provides guaranteed erasure.
