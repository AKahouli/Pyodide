# Conversations

## Scope and evidence

- Primary product route: `http://localhost:5173/#/conversation`; existing threads use `#/conversation/:id`.
- This record covers Conversation v1. Studio / Conversation v2 has separate ownership and contracts.
- Source inspection: **2026-10-13**, revision `cc3d0e078dfcb0f535bcfcb28b8041fa9d2251a9`.
- Baseline comes from committed source and test definitions. No live browser QA, runtime execution or test run was performed for this document.
- Read this page to locate behavior and reuse points; confirm relevant code on the active branch before editing.

## Purpose and workflows

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
Saved-answer exports project only the applied chart subset into the existing
chart data-table representation; reports, presentations and unsupported chart types
retain their existing export behavior. The controls do not run model-authored code.

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
