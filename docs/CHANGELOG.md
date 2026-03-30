# Changelog

## [2026-03-30 03:58] — Add reducers for status and error fields in ExecutionState

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added `merge_status` (severity-based: failed > suspended > in_progress > completed > skipped) and `merge_error` (first non-empty wins) reducers, annotated `status` and `error` fields as `Annotated` in `ExecutionState` TypedDict.
- **Why:** Parallel branches in LangGraph both write `status` and `error` without reducers — the last writer silently wins, masking failures. A branch completing after a failing branch could overwrite `"failed"` with `"completed"`.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/state.py`
- **Doc:** updated `/docs/playbook/README_2026-03-30_03-58-44.md`

## [2026-03-30] — Rebind resumed workflow streams to the active queue

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the ADK workflow service to register the current gRPC stream queue by `thread_id` and resolve that queue lazily from the step-update callback, while forcing a fresh graph build only for the initial workflow run.
- **Why:** Resumed workflows were completing inside LangGraph, but the cached graph still emitted step updates into the old queue from the original run, so the backend saw no resumed step update and incorrectly marked the execution failed.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] — Fix single-step HITL interrupt extraction

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the ADK single-step run and resume paths to use the step-executor interrupt snapshot helper consistently instead of mixing it with the workflow helper signature.
- **Why:** Targeted task execution could fail after raising a clarification interrupt because the single-step workflow called `_extract_interrupt_from_snapshot` with the old three-argument shape against the two-argument workflow helper.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] — Fix lost resumed completions in ADK workflow stream

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the ADK workflow service to register the active stream queue by `thread_id` and resolve that queue at step-update emit time, forcing fresh graph compilation only for the initial run so the cached per-thread graph can be resumed safely.
- **Why:** A resumed workflow could finish successfully inside LangGraph while still publishing its completion update into the dead queue from the original run, which left the backend with no resumed step update and caused the execution to be marked failed.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`, `Yellowstorm-adk/src/langgraph_engine/playbook_queue.py`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] — Simplify copilot interrupt thread rendering

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the execution copilot thread UI so answered replies are rendered once, and agent interrupt output is shown inline without the extra framed result block.
- **Why:** Multi-turn HITL conversations were visually noisy because the same reply text could appear twice and agent output was wrapped in redundant chrome.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- **Doc:** updated `/docs/playbook/README.md`
## [2026-03-29] — Fix resumed clarification interrupts in backend stream

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the backend resume stream consumer to suppress only the exact interrupt that was already on screen before resume, instead of dropping every later suspension for the same task.
- **Why:** Multi-turn clarification can legitimately interrupt the same node several times. The old task-id-only stale filter hid those new interrupts, so the frontend showed no follow-up response and the execution was later marked failed.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`
- **Doc:** updated `/docs/playbook/README.md`
## [2026-03-29] — Fix clarification interrupts for direct step runs

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Enabled clarification HITL in the single-step executor and added a follow-up-question trap so a completed answer that hands control back to the user is converted into a clarification interrupt in both workflow and direct-step execution.
- **Why:** A node with `Allow clarification` enabled could still finish normally even when the agent asked the user a question, which left the step marked completed with no Copilot interrupt.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `Yellowstorm-adk/src/langgraph_engine/step_executor.py`
- **Doc:** updated `/docs/playbook/README.md`
## [2026-03-29] — Stream workflow HITL interrupts from LangGraph

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Refactored workflow execution and resume to drive LangGraph through `astream(..., stream_mode=["messages", "updates"], version="v2")` and detect HITL interrupts from the live stream while preserving the existing queue-to-gRPC contract.
- **Why:** The conversational HITL loops were already in place at the node level, but the workflow transport still waited for `ainvoke(...)` and then inspected snapshots. Streaming aligns the runtime with LangGraph's recommended HITL pattern and surfaces interrupts as first-class events.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`
- **Doc:** updated `/docs/playbook/README.md`
## [2026-03-29] — Add iterative review-after HITL loop

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Extended the conversational HITL work so `interrupt_after` review can now iterate over several critique/revise rounds before a step exits. Workflow and single-step LangGraph paths both re-run the step with accumulated human review feedback until the user approves, rejects, or skips.
- **Why:** Multi-turn HITL is incomplete if only clarification can loop; review-after also needs real back-and-forth when a human wants revisions instead of a binary accept/reject.
- **Impact:** `Yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `Yellowstorm-adk/src/langgraph_engine/step_executor.py`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] — Add conversational HITL clarification contract

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added action-based HITL resume payloads (`reply`, `approve`, `reject`, `skip`), expanded interrupt payloads with interrupt/thread metadata, and wired the playbook copilot plus LangGraph runtime to support multi-turn clarification threads on a step.
- **Why:** A node may need several back-and-forth clarification turns with the user before it can produce its final result; the old boolean approval model was too rigid for that flow.
- **Impact:** `Yellowstorm-adk/grpc/proto/chatbot.proto`, `Yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `Yellowstorm-adk/src/langgraph_engine/workflow_service.py`, `Yellowstorm-adk/src/langgraph_engine/step_executor.py`, `Yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`, `YellowStorm/back/src/modules/playbook/dto/resume-playbook.dto.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-29] — Reuse playbook designer as execution copilot for HITL

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Reused the existing playbook design sidebar as a shared copilot surface during execution. When a step fires a HITL interrupt, the sidebar opens in `interrupt` mode, the step detail panel becomes read-only for that interrupt, and approval/review/clarification responses are handled from the copilot composer instead of the inline step-result UI.
- **Why:** HITL prompts are easier to manage when they live in one persistent conversational panel rather than being split between the step result area and a separate interrupt dialog.
- **Impact:** `store.ts` (copilot mode + interrupt open behavior), `PlaybookDesignerPanel.tsx` (shared design/interrupt sidebar), `HumanFeedbackInline.tsx` (read-only redirect affordance), `PlaybookToolbar.tsx` and `PlaybookCanvasPage.tsx` (copilot toggle wiring), `en.json` / `fr.json` (new labels), tests updated for the new flow
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-28] — Add undo/redo to playbook canvas

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Implemented snapshot-based undo/redo (Ctrl+Z / Ctrl+Shift+Z) for all canvas mutations: add/delete/clone nodes, connect/delete edges, edit node properties, drag nodes, auto-layout, rename, workspace changes, input-file management, and AI design modifications. Added undo/redo toolbar buttons and keyboard shortcuts. History is cleared on playbook load, generate, and designer revert.
- **Why:** Users need the ability to undo any change made in the canvas editor without relying on server-side revert.
- **Impact:** `types.ts` (added `PlaybookUndoSnapshot`), `store.ts` (undo/redo actions + capture points), `usePlaybookCanvas.ts` (capture points + ReactFlow sync watcher), `PlaybookCanvasPage.tsx` (capture points + keyboard shortcuts), `PlaybookToolbar.tsx` (undo/redo buttons), `PlaybookToolbar.test.tsx` (updated props)
- **Doc:** updated `/docs/playbook/README.md`

## [2026-03-28] — Initialize playbook feature docs

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Created initial `/docs` structure with `DOC_INDEX.md`, `CHANGELOG.md`, and `/docs/playbook/README.md`
- **Why:** Establish documentation baseline for the Playbook feature across YellowStorm (frontend/backend) and Yellowstorm-adk (gRPC/LangGraph runtime)
- **Impact:** New files — `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`, `docs/playbook/README.md`
- **Doc:** created `/docs/playbook/README.md`
