# Changelog

## [2026-04-02 12:00] — Strip UI-only playbook task fields before PATCH

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Reworked `sanitizePlaybookUpdate()` to rebuild each task from a backend-safe allow-list and added a regression test so `isSavingReplayBaseline` and other client-only flags are excluded from the PATCH payload.
- **Why:** The backend validation layer rejects unknown task properties, and autosave was sending replay UI state that should never have left the client.
- **Impact:** `YellowStorm/front/src/modules/playbook/api.ts`, `YellowStorm/front/src/modules/playbook/api.test.ts`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_12-00-27.md`

## [2026-04-02 11:57] — Clarify the execution polling guard

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Simplified the `PlaybookCanvasPage` polling guard so the selected execution is checked first and live polling only falls back to the latest execution when no explicit selection exists.
- **Why:** The previous guard was correct but harder to read; the intent needed to be obvious because it controls whether the UI can snap back to a different execution.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_11-57-25.md`

## [2026-04-02 11:56] — Keep manual execution selection from snapping back to latest live run

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated `PlaybookCanvasPage` so background polling only follows a live execution when no explicit execution is already selected. The canvas now keeps the user-chosen execution as the authoritative view.
- **Why:** Selecting a specific execution could be overwritten by the page's latest-execution fallback, making the UI snap back to the most recent live run.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_11-56-46.md`

## [2026-04-02 11:00] — Make playbook agent assignment mapping defensive

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Replaced the direct `new Types.ObjectId(node.assigned_agent_id)` conversion in `PlaybookDesignService.mapGrpcResponseToTasksAndEdges()` with a guarded helper that returns `null` for missing, empty, or invalid identifiers.
- **Why:** The gRPC runtime can emit non-Mongo agent identifiers, and the previous mapping crashed playbook generation with a `BSONError` instead of continuing with an unassigned task.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-design.service.ts`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_11-00-20.md`

## [2026-04-02 09:37] — Center playbook node side connectors

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Updated playbook node handle styling so side connectors are vertically centered on their anchor position instead of sitting offset from the middle of the node edge.
- **Why:** The connector dots looked visually misaligned compared with the desired centered canvas layout.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_09-37-45.md`
## [2026-04-02 09:37] — Align typed-port handles with the node midpoint

- **Feature:** `task-toolbar`
- **Type:** `refactor`
- **Changed:** Kept the typed port model intact while adjusting dynamic handle rendering so each handle is centered around its computed vertical anchor, preserving multi-port spacing and handle ids.
- **Why:** Handle placement belongs to the task-toolbar node system and needed a rendering-only fix without changing edge contracts.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`
- **Doc:** `created` `/docs/task-toolbar/README_2026-04-02_09-37-45.md`
## [2026-04-02 09:26] â€” Clean the playbook Auto Builder modal chrome

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Flattened the Auto Builder visual hierarchy, reduced modal height again, softened the segmented control, and toned down section framing to make the create modal cleaner.
- **Why:** The previous iteration was still visually busy around the tab strip and card surfaces.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_09-26-29.md`

## [2026-04-02 09:20] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Make the playbook creation modal more minimal and compact

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Simplified the Auto Builder modal into a shorter, quieter layout: removed the left guidance column, reduced the shell height, tightened the prompt composer, limited quick starts to two entries, and kept naming/workspace fields in a compact secondary section.
- **Why:** The prior redesign still felt too tall and visually busy for a prompt-first creation flow.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_09-20-56.md`

## [2026-04-02 08:37] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Redesign the playbook creation modal around the prompt bar

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Reworked `CreatePlaybookDialog` into a more intentional modal shell with layered header/background/footer treatment, stronger tab styling, and a two-column Auto Builder composition. The prompt bar remains the primary action, while supporting guidance, quick starts, naming, and workspace context are organized into distinct sections. Added the supporting English and French copy for the redesigned layout.
- **Why:** The earlier iterations fixed the default tab and shell sizing, but the modal still needed a more coherent UI/UX treatment while preserving the prompt-bar interaction model.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_08-37-16.md`

## [2026-04-02 08:23] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Default Auto Builder tab and harmonize the create dialog shell

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Made Auto Builder the default tab when opening New Playbook, widened the modal shell, capped its height with scrolling, and replaced the dark prompt card with a light neutral prompt surface that matches the surrounding window palette.
- **Why:** The previous iteration improved the Auto Builder layout but still opened on Manual and used a dark surface that did not match the target reference.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_08-23-48.md`

## [2026-04-02 07:24] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Refactor Auto Builder create dialog into prompt-first composer

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Reworked the frontend `CreatePlaybookDialog` Auto Builder tab into a prompt-bar style experience with a hero heading, dark prompt composer, inline generate button, example prompt chips, and a secondary details section for optional workflow naming plus workspace selection. Added fallback name derivation from the prompt so generation still submits a valid `name` when the explicit field is left blank. Added the supporting English and French locale keys.
- **Why:** The previous Auto Builder tab still looked like a conventional modal form. This iteration aligns it with the desired prompt-first creation UX while keeping the existing generate flow intact.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_07-24-46.md`

## [2026-04-01 17:00] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Fix autosave stripping port fields from playbook response

- **Feature:** `task-toolbar`
- **Type:** `fix`
- **Changed:** Added `enabled`, `taskType`, `inputPorts`, `outputPorts`, `stepReplayMode` to `mapToResponse()` task mapping in `playbook.service.ts`. Added `sourceOutputPortId`, `targetInputPortId` to edge mapping in the same method. Added corresponding fields to `PlaybookTaskData` and `PlaybookEdgeData` interfaces in `playbook.interface.ts`. The data was already being saved to MongoDB correctly via `$set`, but the API response used an explicit field map that omitted the Week 1-4 port/type fields, causing the frontend's `currentPlaybook` to lose ports on every save cycle.
- **Why:** After autosave, `currentPlaybook` was replaced with the server response which lacked `inputPorts`, `outputPorts`, `taskType` on tasks and `sourceOutputPortId`, `targetInputPortId` on edges ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â making port settings appear to not persist.
- **Impact:** `playbook.service.ts` (mapToResponse), `playbook.interface.ts` (PlaybookTaskData, PlaybookEdgeData)
- **Doc:** n/a

- **Feature:** `task-toolbar`
- **Type:** `feat`
- **Changed:** Added `artifacts` field to `PlaybookStepCompleteEvent` SSE type and propagated through the `onStepComplete` handler into execution cache task results. Created `ArtifactBadge` component: color-coded badge row showing artifact kinds with icons (matching port color palette), tooltip with kind counts, overflow +N indicator. Rendered `ArtifactBadge` on `PlaybookNode` below existing replay/format badges, reading from `currentExecution.taskResults`. Created `ArtifactListItem` in `ExecutionStepDetail`: icon + filename + kind badge + size + truncated content preview for text/code artifacts + download button (Blob URL for inline content, new tab for URL artifacts). Added artifact section in the results tab after the output/running indicator. Added i18n keys `artifacts.title`, `artifacts.sectionTitle`, `artifacts.noArtifacts` in en/fr. Exported `ArtifactBadge` from module index. Marked feature status as stable.
- **Why:** Users can now see at a glance what artifacts a completed step produced (on the node badge) and inspect/download them in the step detail panel, completing the visual artifact lifecycle.
- **Impact:** `types.ts`, `store.ts`, `ArtifactBadge.tsx` (new), `PlaybookNode.tsx`, `ExecutionStepDetail.tsx`, `index.ts`, `en.json`, `fr.json`
- **Doc:** created `/docs/task-toolbar/README_2026-04-01_16-45-00.md`

## [2026-04-01 15:30] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ADK artifact routing: port-aware context resolution and artifact storage (Week 5)

- **Feature:** `task-toolbar`
- **Type:** `feat`
- **Changed:** Rewrote `_build_structured_context()` in `graph_builder.py` to return `tuple[str, list]` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â typed port resolution walks edges to look up `artifacts_by_port["{source_id}:{port_id}"]`, routes text/code artifacts into prompt parts, and collects heavy artifacts (document, image) into a `workspace_artifacts` list. Workspace artifacts are merged into `effective_workspace_context` before passing to `create_langchain_tools()`. Added artifact storage after task completion: `task_result["artifacts"]` indexed by `"{task_id}:{port_id}"` into `state_update["artifacts_by_port"]`, merged via `merge_artifacts` reducer. Legacy fallback preserved for playbooks without ports.
- **Why:** ADK now routes artifacts end-to-end by typed port ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â upstream task outputs are stored in state, resolved for downstream context building, and heavy artifacts are injected into workspace for agent tool access.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/graph_builder.py`
- **Doc:** created `/docs/task-toolbar/README_2026-04-01_15-30-00.md`

## [2026-04-01 11:30] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Backend artifact routing and dual-path context resolution (Week 4)

- **Feature:** `task-toolbar`
- **Type:** `feat`
- **Changed:** Added `TaskInputPortSchema` and `TaskOutputPortSchema` Mongoose sub-documents. Extended `PlaybookTask` with `taskType` (enum), `inputPorts`, `outputPorts`. Extended `PlaybookEdge` with `sourceOutputPortId`, `targetInputPortId` (default 'default'). Added `artifacts` field to `TaskResult`. Extended backend `chatbot.proto` with `TaskInputPort`, `TaskOutputPort`, `TaskArtifact` messages and fields 14-16 on `PlaybookTaskConfig`, 3-4 on `PlaybookEdgeConfig`, 11 on `PlaybookTaskResult`. Updated `runFullWorkflow()` and `executeStep()` gRPC request builders to pass port metadata and edge port IDs. Created `extractArtifactsFromResult()` utility matching gRPC components to task output ports by artifactKind. Extended `BufferedStepResult` with `artifacts` field; updated `handleStepUpdate()`, `flushStepBuffer()`, and `updateTaskResult()` to persist artifacts. Rewrote `gatherContext()` with dual-path: typed port resolution (primary) using port-to-port edge labels, with legacy `inputKeys`/edge-walking fallback.
- **Why:** Backend now passes port metadata to the ADK and extracts/typed artifacts from step results, enabling the ADK to route artifacts by port in Week 5.
- **Impact:** `playbook.schema.ts`, `playbook-execution.schema.ts`, `chatbot.proto` (backend), `execution.utils.ts`, `playbook-execution.service.ts`
- **Doc:** created `/docs/task-toolbar/README_2026-04-01_11-30-00.md`

## [2026-04-01 11:02] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Template registry, toolbar dropdown, and port editor (Week 3)

- **Feature:** `task-toolbar`
- **Type:** `feat`
- **Changed:** Created `task-template-registry.ts` with 5 hardcoded TaskTemplate definitions (Summarizer, DocxGen, SlideGen, CodeGen, Analyzer) each with proper typed input/output ports. Replaced single "Add Step" button in toolbar with split button: left side creates blank step, right chevron opens dropdown with all templates. Added port management UI to PlaybookNodeEditor: input ports section (color dot, editable name, ArtifactKind select, required toggle, delete) and output ports section (same minus required). Wired `onAddStepFromTemplate` in PlaybookCanvasPage to create pre-configured nodes from templates with correct taskType and ports. Updated tests for new toolbar props.
- **Why:** Users can now quickly add pre-configured task nodes from templates and manage ports directly in the node editor, completing the template-driven toolbar experience.
- **Impact:** `task-template-registry.ts` (new), `PlaybookToolbar.tsx`, `PlaybookNodeEditor.tsx`, `PlaybookCanvasPage.tsx`, `PlaybookToolbar.test.tsx`
- **Doc:** created `/docs/task-toolbar/README_2026-04-01_11-02-00.md`

- **Feature:** `task-toolbar`
- **Type:** `feat`
- **Changed:** Updated `node.tsx` to accept `handles={false}` for custom handle rendering. Added `Edge.AnimatedWarning` variant for type-mismatched connections. Rewrote `PlaybookNode.tsx` to render dynamic `<Handle>` components per port with color-coded positions (7 ArtifactKind colors), hover labels showing port name + icon, required-port red indicator. Updated `usePlaybookCanvas.ts` with port-aware edge converters (sourceHandle/targetHandle mapping to port IDs), type compatibility checking on `onConnect`, and duplicate port-to-port connection prevention. Registered warning edge type in `PlaybookCanvasPage.tsx`. Added default text ports to new blank steps. Created `PortLabel.tsx` and `port-colors.ts` utility.
- **Why:** Canvas now visually represents the typed port model from Week 1, enabling users to see and connect specific input/output ports on nodes.
- **Impact:** `node.tsx`, `edge.tsx`, `PlaybookNode.tsx`, `PortLabel.tsx` (new), `port-colors.ts` (new), `usePlaybookCanvas.ts`, `PlaybookCanvasPage.tsx`
- **Doc:** updated `/docs/task-toolbar/README_2026-04-01_09-50-00.md`

## [2026-04-01 09:36] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Typed port & artifact data model (Week 1 foundation)

- **Feature:** `task-toolbar`
- **Type:** `feat`
- **Changed:** Added `ArtifactKind`, `TaskInputPort`, `TaskOutputPort`, `TaskArtifact`, `TaskTemplate` types to frontend. Extended `PlaybookTask` with `taskType`, `inputPorts`, `outputPorts`. Extended `PlaybookEdge` with `sourceOutputPortId`, `targetInputPortId`. Extended `TaskResult` with `artifacts`. Added proto messages `TaskOutputPort`, `TaskInputPort`, `TaskArtifact` and extended `PlaybookTaskConfig`, `PlaybookEdgeConfig`, `PlaybookTaskResult`. Added `artifacts_by_port` with `merge_artifacts` reducer to ADK `ExecutionState`. Created lazy migration utilities for backward compatibility. Added i18n keys for templates, ports, and artifact kinds in en/fr. Created store barrel re-export.
- **Why:** Foundation for template-driven toolbar and typed artifact routing between playbook tasks (Weeks 2-6 of TASK_TOOLBAR_IMPLEMENTATION_PLAN).
- **Impact:** `types.ts`, `chatbot.proto`, `state.py`, `migrate-ports.ts` (new), `store/index.ts` (new), `en.json`, `fr.json`, `index.ts`
- **Doc:** created `/docs/task-toolbar/README_2026-04-01_09-36-39.md`

## [2026-03-30 03:58] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Add reducers for status and error fields in ExecutionState

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added `merge_status` (severity-based: failed > suspended > in_progress > completed > skipped) and `merge_error` (first non-empty wins) reducers, annotated `status` and `error` fields as `Annotated` in `ExecutionState` TypedDict.
- **Why:** Parallel branches in LangGraph both write `status` and `error` without reducers ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the last writer silently wins, masking failures. A branch completing after a failing branch could overwrite `"failed"` with `"completed"`.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/state.py`
- **Doc:** updated `/docs/playbook/README_2026-03-30_03-58-44.md`

## [2026-03-30] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Rebind resumed workflow streams to the active queue

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the ADK workflow service to register the current gRPC stream queue by `thread_id` and resolve that queue lazily from the step-update callback, while forcing a fresh graph build only for the initial workflow run.
- **Why:** Resumed workflows were completing inside LangGraph, but the cached graph still emitted step updates into the old queue from the original run, so the backend saw no resumed step update and incorrectly marked the execution failed.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Fix single-step HITL interrupt extraction

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the ADK single-step run and resume paths to use the step-executor interrupt snapshot helper consistently instead of mixing it with the workflow helper signature.
- **Why:** Targeted task execution could fail after raising a clarification interrupt because the single-step workflow called `_extract_interrupt_from_snapshot` with the old three-argument shape against the two-argument workflow helper.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Fix lost resumed completions in ADK workflow stream

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the ADK workflow service to register the active stream queue by `thread_id` and resolve that queue at step-update emit time, forcing fresh graph compilation only for the initial run so the cached per-thread graph can be resumed safely.
- **Why:** A resumed workflow could finish successfully inside LangGraph while still publishing its completion update into the dead queue from the original run, which left the backend with no resumed step update and caused the execution to be marked failed.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`, `Yellowstorm-adk/src/langgraph_engine/playbook_queue.py`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Simplify copilot interrupt thread rendering

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the execution copilot thread UI so answered replies are rendered once, and agent interrupt output is shown inline without the extra framed result block.
- **Why:** Multi-turn HITL conversations were visually noisy because the same reply text could appear twice and agent output was wrapped in redundant chrome.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- **Doc:** updated `/docs/playbook/README.md`
## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Fix resumed clarification interrupts in backend stream

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the backend resume stream consumer to suppress only the exact interrupt that was already on screen before resume, instead of dropping every later suspension for the same task.
- **Why:** Multi-turn clarification can legitimately interrupt the same node several times. The old task-id-only stale filter hid those new interrupts, so the frontend showed no follow-up response and the execution was later marked failed.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`
- **Doc:** updated `/docs/playbook/README.md`
## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Fix clarification interrupts for direct step runs

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Enabled clarification HITL in the single-step executor and added a follow-up-question trap so a completed answer that hands control back to the user is converted into a clarification interrupt in both workflow and direct-step execution.
- **Why:** A node with `Allow clarification` enabled could still finish normally even when the agent asked the user a question, which left the step marked completed with no Copilot interrupt.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `Yellowstorm-adk/src/langgraph_engine/step_executor.py`
- **Doc:** updated `/docs/playbook/README.md`
## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Stream workflow HITL interrupts from LangGraph

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Refactored workflow execution and resume to drive LangGraph through `astream(..., stream_mode=["messages", "updates"], version="v2")` and detect HITL interrupts from the live stream while preserving the existing queue-to-gRPC contract.
- **Why:** The conversational HITL loops were already in place at the node level, but the workflow transport still waited for `ainvoke(...)` and then inspected snapshots. Streaming aligns the runtime with LangGraph's recommended HITL pattern and surfaces interrupts as first-class events.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`
- **Doc:** updated `/docs/playbook/README.md`
## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Add iterative review-after HITL loop

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Extended the conversational HITL work so `interrupt_after` review can now iterate over several critique/revise rounds before a step exits. Workflow and single-step LangGraph paths both re-run the step with accumulated human review feedback until the user approves, rejects, or skips.
- **Why:** Multi-turn HITL is incomplete if only clarification can loop; review-after also needs real back-and-forth when a human wants revisions instead of a binary accept/reject.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `Yellowstorm-adk/src/langgraph_engine/step_executor.py`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Add conversational HITL clarification contract

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added action-based HITL resume payloads (`reply`, `approve`, `reject`, `skip`), expanded interrupt payloads with interrupt/thread metadata, and wired the playbook copilot plus LangGraph runtime to support multi-turn clarification threads on a step.
- **Why:** A node may need several back-and-forth clarification turns with the user before it can produce its final result; the old boolean approval model was too rigid for that flow.
- **Impact:** `Yellowstorm-adk/grpc/proto/chatbot.proto`, `Yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`, `Yellowstorm-adk/src/langgraph_engine/step_executor.py`, `Yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`, `YellowStorm/back/src/modules/playbook/dto/resume-playbook.dto.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Reuse playbook designer as execution copilot for HITL

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Reused the existing playbook design sidebar as a shared copilot surface during execution. When a step fires a HITL interrupt, the sidebar opens in `interrupt` mode, the step detail panel becomes read-only for that interrupt, and approval/review/clarification responses are handled from the copilot composer instead of the inline step-result UI.
- **Why:** HITL prompts are easier to manage when they live in one persistent conversational panel rather than being split between the step result area and a separate interrupt dialog.
- **Impact:** `store.ts` (copilot mode + interrupt open behavior), `PlaybookDesignerPanel.tsx` (shared design/interrupt sidebar), `HumanFeedbackInline.tsx` (read-only redirect affordance), `PlaybookToolbar.tsx` and `PlaybookCanvasPage.tsx` (copilot toggle wiring), `en.json` / `fr.json` (new labels), tests updated for the new flow
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-28] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Add undo/redo to playbook canvas

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Implemented snapshot-based undo/redo (Ctrl+Z / Ctrl+Shift+Z) for all canvas mutations: add/delete/clone nodes, connect/delete edges, edit node properties, drag nodes, auto-layout, rename, workspace changes, input-file management, and AI design modifications. Added undo/redo toolbar buttons and keyboard shortcuts. History is cleared on playbook load, generate, and designer revert.
- **Why:** Users need the ability to undo any change made in the canvas editor without relying on server-side revert.
- **Impact:** `types.ts` (added `PlaybookUndoSnapshot`), `store.ts` (undo/redo actions + capture points), `usePlaybookCanvas.ts` (capture points + ReactFlow sync watcher), `PlaybookCanvasPage.tsx` (capture points + keyboard shortcuts), `PlaybookToolbar.tsx` (undo/redo buttons), `PlaybookToolbar.test.tsx` (updated props)
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-28] ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Initialize playbook feature docs

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Created initial `/docs` structure with `DOC_INDEX.md`, `CHANGELOG.md`, and `/docs/playbook/README.md`
- **Why:** Establish documentation baseline for the Playbook feature across YellowStorm (frontend/backend) and Yellowstorm-adk (gRPC/LangGraph runtime)
- **Impact:** New files ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`, `docs/playbook/README.md`
- **Doc:** created `/docs/playbook/README.md`

