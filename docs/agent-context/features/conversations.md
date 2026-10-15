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

Answer/conversation DOCX, HTML and print/PDF use a shared saved-program AST projection,
including collapsed/offscreen content, ordered image captions, native tables and chart
data tables. Existing scoped asset resolvers embed images; missing/unsupported content
fails explicitly. Obsolete regenerated answers are filtered before asset resolution.
The answer Export menu can send the same structured manifest plus document page
mapping to its conversation agent for MCP DOCX/editable PPTX creation. It does not
execute model-authored actions in the browser or imply successful file delivery.
See the module README and `document-export.test.ts`, `openui-export-assets.test.ts`,
`docx-export.test.ts` and `MessageActions.test.tsx` for the implementation contract.

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
- [Architecture change control](../architecture/change-control.md) and [ADR-0007](../decisions/ADR-0007-architecture-approval-and-documentation.md) govern new boundaries/persistence and durable design decisions.
- [ADR-0005](../decisions/ADR-0005-task-checkpoints-and-reuse-gates.md) governs checkpoint/reuse evidence; it does not define product conversation behavior.

When behavior or ownership changes, update this record alongside the implementation and link affected contracts/tests. Update architecture documents when boundaries change, and add a proposed ADR for a new durable decision. Preserve accepted ADRs. Maintainer updates must use verified implementation evidence and identify any remaining live-verification gap.
