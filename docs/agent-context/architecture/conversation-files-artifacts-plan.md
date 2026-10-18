# Conversation Files & artifacts implementation plan

Status: **phase 1 implemented and reviewed; qualification limits below; phases 2–4 proposed**. Assessed
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
agent result. Second-profile final preview is BLOCKED on session renewal (sign-in
requested once); its upload/download/reload and direct reads already passed.
That profile's default-agent inference is separately BLOCKED by an existing
protected MCP provider credential, not asset authorization. Repository observability
policy reports eight violations in unrelated MCP files, none in this asset scope;
do not mark that repository-wide gate passed.

## Existing owners and verified reuse

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
