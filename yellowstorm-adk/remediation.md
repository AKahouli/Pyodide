# 📋 YellowStorm Playbooks — Code Audit Report

> **Date:** 2026-03-24
> **Scope:** Frontend, Backend, ADK — playbook-related code
> **Categories:** Code Duplication · Code Inconsistency · Performance 
> Issues **Total findings:** ~50 issues (12 HIGH · 25+ MEDIUM · 13 LOW)

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [HIGH Severity Issues](#-high-severity-issues)
  - [Duplication](#high--duplication)
  - [Performance](#high--performance)
- [MEDIUM Severity Issues](#-medium-severity-issues)
  - [Duplication](#medium--duplication)
  - [Inconsistency](#medium--inconsistency)
  - [Performance](#medium--performance)
- [LOW Severity Issues](#-low-severity-issues)
  - [Duplication](#low--duplication)
  - [Inconsistency](#low--inconsistency)
  - [Performance](#low--performance)
- [Refactor Action Plan](#-refactor-action-plan)
  - [Phase 1: Shared Foundations](#phase-1-shared-foundations)
  - [Phase 2: HIGH Severity Fixes](#phase-2-high-severity-fixes)
  - [Phase 3: MEDIUM Fixes](#phase-3-medium-fixes)
  - [Phase 4: LOW + Cleanup](#phase-4-low--cleanup)
  - [Timeline Summary](#timeline-summary)

---

## Executive Summary

A comprehensive audit of the YellowStorm playbook codebase across three repositories (Front, Back, ADK) identified widespread code duplication, inconsistent patterns, and performance bottlenecks. The most critical findings are:

1. **Entire service pipelines duplicated** between `PlaybookReplayService` and `PlaybookOutputFormatService` (~200 lines) 2. **Two near-identical execution engines** in the ADK langgraph engine (`graph_builder.py` vs `step_executor.py`) 3. **Heavy per-request initialization** in the ADK step executor (singleton declared but never used) 4. **N+1 database queries** in the backend clone/share endpoint 5. **Redundant polling** in the frontend alongside an existing SSE real-time stream

The recommended refactor is organized into 4 phases over ~10-12 days, with shared utility extraction as the foundation.

---

## 🔴 HIGH Severity Issues

### HIGH — Duplication

#### H-DUP-1: `_extract_interrupt_from_snapshot` — Two Near-Identical Implementations

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/step_executor.py:47-67`
  - `src/langgraph_engine/workflow_service.py:19-38`
- **Description:** The function `_extract_interrupt_from_snapshot` is defined independently in both files with nearly identical logic. The `step_executor.py` version accepts `(state_snapshot, task_id, thread_id)` while `workflow_service.py` accepts `(state_snapshot, thread_id)`, but the body is the same — iterating `state_snapshot.tasks`, checking `pregel_task.interrupts[0].value`,
and building a dict.
- **Recommendation:** Extract to `src/langgraph_engine/utils.py`.

---

#### H-DUP-2: `_llm_call` vs `DynamicGraphBuilder._llm_direct_call` — Identical Functions

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/step_executor.py:356-384` (`_llm_call`)
  - `src/langgraph_engine/graph_builder.py:299-330` (`_llm_direct_call`)
- **Description:** Both functions create a `ChatOpenAI` instance, call `_append_prompt_trace`, invoke `llm.ainvoke` with SystemMessage + HumanMessage, and return `(result.content, _extract_usage(result))`.
They are functionally identical. `_llm_direct_call` in `graph_builder.py` even imports `_extract_usage` and `_append_prompt_trace` from `step_executor.py`.
- **Recommendation:** Remove `_llm_direct_call` from `graph_builder.py` and use `_llm_call` from `step_executor.py` (or shared utils).

---

#### H-DUP-3: Replay Execution Logic Duplicated Between `graph_builder.py` and `step_executor.py`

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/graph_builder.py:193-262`
  - `src/langgraph_engine/step_executor.py:157-227`
- **Description:** The entire replay mode branching (`replay_strict`, `replay_flex`, `replay_adaptive`), including the format guide construction (with typo `"#Output Furmat guidelines"`), the call to `_execute_replay_tool_calls`, and the final synthesis LLM call, is duplicated almost verbatim between the `task_node` closure in `graph_builder.py` and `_execute_step_simple` in `step_executor.py`.
- **Recommendation:** Extract replay orchestration into a shared `_run_task_with_replay_or_live()` function.

---

#### H-DUP-4: Duplicated `normalizeStructLike` Method

- **Area:** Backend
- **Files:**
  - `services/playbook-execution.service.ts:56-92`
  - `services/playbook-replay.service.ts:99-134`
- **Description:** Identical ~40-line private method `normalizeStructLike()` exists in both `PlaybookExecutionService` and `PlaybookReplayService`. Both recursively unwrap gRPC `Struct`-like objects (`stringValue`, `listValue`, `structValue`, `fields`).
- **Recommendation:** Extract to `utils/grpc-struct.utils.ts`.

---

#### H-DUP-5: Duplicated `extractChatCompletionText` Method

- **Area:** Backend
- **Files:**
  - `services/playbook-replay.service.ts:82-97`
  - `services/playbook-output-format.service.ts:56-71`
- **Description:** Identical 15-line private method for extracting text content from LiteLLM chat completion responses.
- **Recommendation:** Extract to shared utils (covered by H-DUP-7).

---

#### H-DUP-6: Duplicated `OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT` Constant

- **Area:** Backend
- **Files:**
  - `services/playbook-replay.service.ts:1-57`
  - `services/playbook-output-format.service.ts:1-100+`
- **Description:** Two very similar (but not identical!) system prompts for the same conceptual task — extracting output structure/format from a reference. The `playbook-output-format.service.ts` version is longer and more detailed. This divergence is a maintenance hazard.
- **Recommendation:** Consolidate into a single constant.

---

#### H-DUP-7: Entire Output-Format-Guide Generation Pipeline Duplicated

- **Area:** Backend
- **Files:**
  - `services/playbook-replay.service.ts` — `buildOutputFormatGuide()`
+ `getOutputFormatGuideFallback()` +
`enqueueOutputFormatGuideGeneration()` + `generateOutputFormatGuideInBackground()` + `extractChatCompletionText()`
  - `services/playbook-output-format.service.ts` — `buildOutputFormatGuide()` + `getFallbackGuide()` + `enqueueGeneration()` + `generateInBackground()` + `extractChatCompletionText()`
- **Description:** The entire async output-format-guide generation pipeline is duplicated. Both follow the exact same pattern: check httpClient availability → get default model → call LiteLLM → parse response → fallback to static guide → save to DB → emit SSE event. The only difference is the DB model they write to (replay vs template).
- **Recommendation:** Extract a shared `OutputFormatGuideService` class. Both services delegate to it, providing only the DB model and SSE event name.

---

#### H-DUP-8: Replay Update Map Pattern Duplicated in 4 Store Actions

- **Area:** Frontend
- **File:** `store.ts`
- **Lines:** ~220-250, ~280-310, ~335-370, ~395-410
- **Description:** The pattern of mapping over `currentPlaybook.tasks` and spreading the same ~15 replay-related properties onto the matched task is repeated 4 times with nearly identical code:
  ```ts
  {
    ...task,
    hasValidatedReplay: true,
    activeReplayId: ...,
    activeReplayVersion: ...,
    activeReplayIsStale: replay.isStale || false,
    activeReplayStaleReasons: replay.staleReasons || [],
    activeReplayPreserveOutputFormat: replay.preserveOutputFormat || false,
    activeReplayFormatGuideStatus: replay.formatGuideStatus || 'disabled',
    activeReplayFormatGuideError: replay.formatGuideError || null,
    hasOutputFormatTemplate: task.hasOutputFormatTemplate,
    activeOutputFormatTemplateId: task.activeOutputFormatTemplateId,
    activeOutputFormatTemplateVersion: task.activeOutputFormatTemplateVersion,
    activeOutputFormatStatus: task.activeOutputFormatStatus || null,
    activeOutputFormatError: task.activeOutputFormatError || null,
  }
  ```
- **Recommendation:** Extract into a single `applyReplayToTask(task, replay)` helper.

---

### HIGH — Performance

#### H-PERF-1: `PlaybookStepExecutor` Created Per Request with Heavy Initialization

- **Area:** ADK
- **File:** `src/smart_rag/playbook_dir/execute_step.py:469-475`
- **Description:** `PlaybookStepExecutor.__init__` creates `PromptProcessor`, `LLMFactory`, `AgentFactory`, `StreamingFormatter`, `RunConfig`, `AgentHelper`, `AgentRepository`, `ToolDescriptionProvider`, `EventExtractor`, `MessageTransformer`, and `AgentRunner` — on every single call. A module-level `_executor = None` singleton variable is declared but **never used**.
- **Recommendation:** Implement lazy singleton initialization.

---

#### H-PERF-2: `cloneShare` Controller Has N+1 DB Queries in a Loop

- **Area:** Backend
- **File:** `controllers/playbook.controller.ts:152-188`
- **Description:** For each email in `dto.emails` (max 20 via `ArrayMaxSize(20)`), the controller does:
`userService.findByEmail(email)` → `playbookService.cloneForUser()` → `notificationsService.sendToUser()`. That's up to 60 sequential DB calls.
- **Recommendation:** Batch-lookup users first (`UserModel.find({
email: { $in: emails } })`), then process clones in parallel with `Promise.all`.

---

#### H-PERF-3: 2s Polling Fallback During Active Execution

- **Area:** Frontend
- **File:** `PlaybookCanvasPage.tsx:105-125`
- **Description:** When an execution is active, `fetchExecution` + `fetchExecutions` are polled every 2 seconds as a fallback for missed SSE events. This means two API calls every 2 seconds — redundant with the SSE stream service which already provides real-time updates. The `execution` and `currentExecution` dependencies in the `useEffect` can also cause interval stacking.
- **Recommendation:** Remove or increase interval to 10s+. The SSE service with BroadcastChannel already handles state recovery.

---

#### H-PERF-4: Client-Side Date Filtering in `filterExecutions`

- **Area:** Frontend
- **File:** `PlaybookService` (`api.ts` or service layer)
- **Description:** Every execution's `startedAt` is parsed with `new Date()` client-side to filter/sort. For large execution lists, this is unnecessary computation that should happen server-side.
- **Recommendation:** Add server-side date filtering/sorting parameters to the API endpoint.

---

## 🟠 MEDIUM Severity Issues

### MEDIUM — Duplication

#### M-DUP-1: `formatDuration` Copied 6 Times

- **Area:** Frontend
- **Files:**
  - `components/ExecutionPanel.tsx:15`
  - `components/ExecutionStepDetail.tsx:20`
  - `components/ExecutionStepList.tsx:15`
  - `components/ExecutionHeader.tsx:20`
  - `components/PlaybookExecutionListPage.tsx:9`
  - `components/PlaybookExecutionComparePage.tsx:11`
- **Description:** Six nearly identical `formatDuration` functions.
Two variants exist: one uses `Math.floor` seconds formatting (`5s`, `1m 30s`), the other uses `toFixed(1)` (`5.0s`). Both return `-` or `''` for null.
- **Recommendation:** Single shared utility in `lib/playbook-utils.ts` using the `Math.floor` variant.

---

#### M-DUP-2: Replay Badge/Status UI Duplicated in 3 Components

- **Area:** Frontend
- **Files:**
  - `components/PlaybookNode.tsx:127-160`
  - `components/PlaybookNodeEditor.tsx:147-200`
  - `components/ExecutionStepDetail.tsx:159-196`
- **Description:** Three different components independently render the same set of replay/format-guide/output-format status badges (~150 lines total duplication).
- **Recommendation:** Shared `<ReplayStatusBadges>` component.

---

#### M-DUP-3: Smart-Merge Execution Logic Duplicated

- **Area:** Frontend
- **File:** `store.ts`
- **Lines:** `hydrateActiveExecutions` (~530-565) and `fetchExecution`
(~490-520)
- **Description:** Both methods implement the same "smart merge"
logic: iterate API task results, compare with cached via `isNewerStatus`, keep the more advanced status, preserve `interruptPayload`.
- **Recommendation:** Shared `smartMergeExecutions(apiExec, cachedExec)` function.

---

#### M-DUP-4: "First Step Selection" Logic Repeated 3 Times

- **Area:** Frontend
- **File:** `store.ts`
- **Lines:** `onExecutionStart` (~415), `fetchExecution` (~510), `viewExecutionInPanel` (~580)
- **Description:** The pattern of `sort by order → find running → find pending → fallback to [0]` is repeated 3 times.
- **Recommendation:** `selectAutoStep(taskResults)` utility.

---

#### M-DUP-5: Workspace File Listing Logic in 3 Places

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/graph_builder.py:168-178`
  - `src/langgraph_engine/step_executor.py:33-49`
(`_format_workspace_file_hint`)
  - `src/langgraph_engine/playbook_tool_factory.py:105-121`
(`_format_available_filenames`)
- **Description:** Three separate implementations of "extract unique filenames from workspace documents, cap at N, add suffix."
- **Recommendation:** Single utility function.

---

#### M-DUP-6: Brain Document Merging Logic in 2 Places (Different
Implementations)

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/playbook_tool_factory.py:71-87` (`_merge_brain_data`)
  - `src/smart_rag/playbook_dir/execute_step.py:86-115`
(`_merge_documents_without_duplicates`)
- **Description:** Both merge brain_ids and brain_documents from config + agent, deduplicating by ID. Use different approaches (dict-based vs set-based).
- **Recommendation:** Single shared merge utility.

---

#### M-DUP-7: `resume_step` / `resume_playbook` — Nearly Identical Patterns

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/step_executor.py:282-367`
  - `src/langgraph_engine/workflow_service.py:119-198`
- **Description:** Both functions: get graph from cache → check None → invoke `Command(resume=response_data)` → check if suspended again → build result dict → handle errors/cleanup.
- **Recommendation:** Extract `_resume_graph_execution()` helper.

---

#### M-DUP-8: `buildWorkspaceContexts` Document-Mapping Duplicated

- **Area:** Backend
- **File:** `services/playbook-context.service.ts`
- **Lines:** `buildWorkspaceContexts()` (20-47) and `resolveAgentBrainContexts()` (56-73)
- **Description:** Both iterate over workspace IDs, call `workspaceDocumentService.findAllByWorkspace()`, and map documents to the same shape.
- **Recommendation:** Extract `mapDocumentToContext()` helper.

---

#### M-DUP-9: gRPC Task-Building Pattern Duplicated 3 Times

- **Area:** Backend
- **Files:**
  - `services/playbook-execution.service.ts` — `runFullWorkflow()` (302-318)
  - `services/playbook-execution.service.ts` — `executeStep()` (430-445)
  - `services/playbook-design.service.ts` — `designPlaybook()` (119-137)
- **Description:** The mapping from playbook task (camelCase) to gRPC
(snake_case) fields is duplicated 3 times.
- **Recommendation:** Extract `taskToGrpc()` mapper.

---

#### M-DUP-10: Replay-Output-Format Enrichment Duplicated

- **Area:** Backend
- **File:** `services/playbook-execution.service.ts`
- **Lines:** `runFullWorkflow()` (324-334) and `executeStep()` (456-466)
- **Description:** The conditional logic for merging output-format from the active template into the replay gRPC payload is copy-pasted.
- **Recommendation:** Extract `enrichReplayWithOutputFormat(replay,
template)` helper.

---

#### M-DUP-11: Usage Recording Pattern Repeated 3 Times

- **Area:** Backend
- **File:** `services/playbook-execution.service.ts`
- **Lines:** `executeStep()` completed (499-510), failed (545-556), and `recordStreamUsage()` (287-301)
- **Description:** The "increment execution tokens + record usage"
pattern appears 3 times with slight variations.
- **Recommendation:** Extract `recordUsage(execution, usage)` helper.

---

### MEDIUM — Inconsistency

#### M-INC-1: Typo `"#Output Furmat guidelines"` (in 2 places)

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/graph_builder.py:237`
  - `src/langgraph_engine/step_executor.py:197`
- **Description:** "Furmat" should be "Format". Duplicated so fixing requires changes in both files.
- **Recommendation:** Fix after extracting shared replay logic (H-DUP-3).

---

#### M-INC-2: Logging Library Inconsistency — `structlog` vs Custom `get_logger`

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/*.py` uses `structlog.get_logger(__name__)`
  - `src/smart_rag/playbook_dir/*.py` and `src/routers/playbook.py` use `src.logger.logging.get_logger("api...")`
- **Description:** Two different logging approaches mean different log formats, level handling, and structured metadata support.
- **Recommendation:** Standardize on one approach (recommend `structlog`).

---

#### M-INC-3: Inconsistent Field Access — Safe `.get()` vs Direct `[]`

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/graph_builder.py:270` — `agent["name"]` (KeyError risk)
  - `src/langgraph_engine/step_executor.py:241-244` — `agent.get("name")` (safe)
- **Description:** Same code uses both patterns. Extends to other places in `graph_builder.py` (e.g., line 138 `agent["name"]`, line 139 `agent.get("instructions")`).
- **Recommendation:** Use `.get()` consistently for dict access on external data.

---

#### M-INC-4: `duration_ms: 0` in HITL Step Execution

- **Area:** ADK
- **File:** `src/langgraph_engine/step_executor.py:311, 331, 360`
- **Description:** HITL-path results always return `duration_ms: 0` because timing isn't propagated through the HITL wrapper.
- **Recommendation:** Track and propagate actual timing through the HITL wrapper.

---

#### M-INC-5: Inconsistent Error Return Structures

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/graph_builder.py` — returns `{"error": ...,
"status": "failed"}` in state dict
  - `src/langgraph_engine/step_executor.py` — returns `{"status":
"failed", "result": {"error": ...}, "interrupt": None, "thread_id":
""}`
- **Description:** Two completely different error shapes for callers to handle.
- **Recommendation:** Define a consistent error response schema.

---

#### M-INC-6: `response_model` on Streaming Endpoints

- **Area:** ADK
- **Files:** `src/routers/playbook.py:41` and `:90`
- **Description:** Both endpoints declare `response_model=...` but return `StreamingResponse`. FastAPI ignores `response_model` for streaming responses, but it's misleading.
- **Recommendation:** Remove the `response_model` parameter or document why.

---

#### M-INC-7: `PlaybookStepExecutor` Singleton Pattern Broken

- **Area:** ADK
- **File:** `src/smart_rag/playbook_dir/execute_step.py:461-475`
- **Description:** A module-level `_executor = None` is declared but never used. The `execute_playbook_step()` function creates a new instance every time.
- **Recommendation:** Covered by H-PERF-1.

---

#### M-INC-8: Redundant `isinstance` Checks

- **Area:** ADK
- **File:** `src/langgraph_engine/workflow_service.py:206-244`
- **Description:** `_build_task_results` checks `isinstance(r, dict)` multiple times per iteration instead of a single guard.
- **Recommendation:** Refactor with a single `isinstance` guard.

---

#### M-INC-9: Inconsistent ID Extraction `(x._id || x.id).toString()`

- **Area:** Backend
- **Files:** All mapper methods across `playbook.service.ts`, `playbook-replay.service.ts`, `playbook-output-format.service.ts`,
`playbook-design.service.ts`
- **Description:** The defensive `_id || id` pattern is everywhere (20+ occurrences), suggesting uncertainty about whether `.lean()` vs full documents are used.
- **Recommendation:** Single `extractId(doc)` utility.

---

#### M-INC-10: Inconsistent `toISOString()` Fallback Pattern

- **Area:** Backend
- **Files:** All mapper methods across all services
- **Description:** `date?.toISOString?.() || date` appears 50+ times.
Some places use it, others don't (e.g., `mapToResponse` uses it for `createdAt`/`updatedAt` but not for `startedAt`/`completedAt` inside task mappings).
- **Recommendation:** Single `safeDate(date)` utility.

---

#### M-INC-11: Inconsistent Deletion Return Format

- **Area:** Backend
- **Files:**
  - `controllers/playbook.controller.ts` → `delete()` returns `{
deleted: true }`
  - `controllers/playbook-execution.controller.ts` → `deleteExecution()` returns `{ success: true }`
- **Recommendation:** Standardize to `{ deleted: true }`.

---

#### M-INC-12: Missing `@IsMongoId()` Validation on DTOs

- **Area:** Backend
- **Files:**
  - `stop-playbook.dto.ts`
  - `resume-playbook.dto.ts`
  - `validate-task-replay.dto.ts`
  - `grab-output-format-template.dto.ts`
- **Description:** Several DTOs accept string IDs used as MongoDB ObjectId lookups but don't validate format. Compare with `bulk-delete-playbooks.dto.ts` which correctly uses `@IsMongoId({
each: true })`.
- **Recommendation:** Add `@IsMongoId()` to all DTO ID fields.

---

#### M-INC-13: Inconsistent `formatDuration` Null Handling

- **Area:** Frontend
- **Files:**
  - `ExecutionStepList.tsx:15` returns `''` (empty string) for null
  - All others return `'-'`
- **Recommendation:** Standardize to `'-'`.

---

#### M-INC-14: Inconsistent `formatDuration` Second Precision

- **Area:** Frontend
- **Files:**
  - `ExecutionStepDetail.tsx:22` — `toFixed(1)` (e.g., `5.3s`)
  - `ExecutionStepList.tsx`, `ExecutionPanel.tsx`, `ExecutionHeader.tsx` — `Math.floor` (e.g., `5s`)
- **Description:** Users see `5.3s` in the detail panel but `5s` in the sidebar.
- **Recommendation:** Use `Math.floor` variant everywhere.

---

#### M-INC-15: Hardcoded English Strings — Missing i18n

- **Area:** Frontend
- **Files:**
  - `PlaybookNodeEditor.tsx` — extensive hardcoded strings: "Replay baselines", "Version", "Execution #", "tool calls", "Active", "Activate", "Edit format guide", "Save Replay Baseline", etc.
  - `ExecutionPanel.tsx` — "Save Replay Baseline", "Cancel", "Saving...", etc.
  - `ExecutionStepDetail.tsx` — "Step Results", "Evaluation", "Tool Trace", etc.
  - `PlaybookToolbar.tsx` — "Live Mode", "Replay (Strict)", "Replay (Flex)", "Replay (Adaptive)"
  - `PlaybookGeneratingOverlay.tsx` — no i18n at all
  - `PlaybookBetaDisclaimer.tsx` — partial i18n
  - `PlaybookNode.tsx` — "Replay stale", "Replay ready", "Format preserved"
- **Description:** Many components use `t()` for some strings but hardcode English for others.
- **Recommendation:** Add i18n keys for all user-facing strings.

---

#### M-INC-16: Inconsistent Import Patterns

- **Area:** Frontend
- **Files:**
  - `PlaybookStatusBadge.tsx:2` imports from `@/modules/localization/useModuleTranslation` (direct file)
  - All other files import from `@/modules/localization` (barrel export)
- **Recommendation:** Use barrel export consistently.

---

### MEDIUM — Performance

#### M-PERF-1: Polling for Pending Format Guides in PlaybookNodeEditor

- **Area:** Frontend
- **File:** `PlaybookNodeEditor.tsx:108-118`
- **Description:** `setInterval` polls `fetchTaskReplays` every 2 seconds when any replay has `formatGuideStatus === 'pending'`. Fires for every open editor, redundant with the SSE-based `onReplayFormatGuideUpdated` event.
- **Recommendation:** Remove polling or increase interval significantly.

---

#### M-PERF-2: Redundant `fetchTaskReplays` Calls in PlaybookNodeEditor

- **Area:** Frontend
- **File:** `PlaybookNodeEditor.tsx:82-96` and `:98-112`
- **Description:** Two separate `useEffect` hooks both call `fetchTaskReplays(playbookId, task.id)` — both fire on mount, causing a double fetch every time the dialog opens.
- **Recommendation:** Merge into a single effect with combined dependencies.

---

#### M-PERF-3: `fetchTaskReplays` Called on Every Step Click

- **Area:** Frontend
- **File:** `ExecutionPanel.tsx:100-115`
- **Description:** Every time `selectedResult?.taskId` changes (user clicks a step), `fetchTaskReplays` is called even without replays.
- **Recommendation:** Gate with `currentTask?.hasValidatedReplay` check.

---

#### M-PERF-4: Double `fetchTaskReplays` in ExecutionStepDetail

- **Area:** Frontend
- **File:** `ExecutionStepDetail.tsx`
- **Description:** Missing loading guard causes duplicate `useEffect` triggers for replay data.
- **Recommendation:** Add loading guard.

---

#### M-PERF-5: `PlaybookOwnerGuard` Queries DB on Every Request — No Caching

- **Area:** Backend
- **File:** `guards/playbook-owner.guard.ts:24-44`
- **Description:** Every guard-protected endpoint does a fresh `playbookModel.findById().select('createdBy').lean()`. Ownership rarely changes.
- **Recommendation:** Short TTL cache (5-10s) or accept pre-loaded playbook.

---

#### M-PERF-6: `buildWorkspaceContexts` Fetches Docs Sequentially

- **Area:** Backend
- **File:** `services/playbook-context.service.ts:20-47`
- **Description:** Workspace document fetching is in a `for...of` loop — sequential. Meanwhile, `resolveAgentBrainContexts()` correctly uses `Promise.allSettled()` for parallelism.
- **Recommendation:** Use `Promise.allSettled()` for consistency and speed.

---

#### M-PERF-7: `mapToResponse` Does 2 DB Calls in Hot Paths

- **Area:** Backend
- **File:** `services/playbook.service.ts:289-339`
- **Description:** `mapToResponse()` calls `this.replayService.getActiveReplays()` and `this.outputFormatService.getActiveTemplates()` on every invocation.
Called from `create()`, `update()`, `findById()`, `createWithTasksAndEdges()`, `cloneForUser()`, `revertToSnapshot()`.
- **Recommendation:** Accept pre-loaded replays/templates as parameters, or cache.

---

#### M-PERF-8: `getActiveReplay` / `getActiveReplays` Redundantly Fetches Playbook

- **Area:** Backend
- **File:** `services/playbook-replay.service.ts:269-294`
- **Description:** Both methods fetch the full playbook from DB just to compute staleness. When called from `mapToResponse()` (which already loaded the playbook), the fetch is redundant.
- **Recommendation:** Accept playbook as optional parameter.

---

#### M-PERF-9: `build_tree` Called Without Caching

- **Area:** ADK
- **File:** `src/langgraph_engine/playbook_tool_factory.py:161-164`
- **Description:** Every call to `create_langchain_tools` invokes `build_tree(brain_documents, ...)` which involves parsing and constructing document tree structures. No caching exists at the tool factory level.
- **Recommendation:** Cache `doc_tree`/`brain_tree` keyed by brain document IDs.

---

#### M-PERF-10: Sequential Step Execution in Full Workflow

- **Area:** ADK
- **File:** `src/langgraph_engine/step_executor.py`
- **Description:** While steps are streamed, internal step processing is sequential. For independent steps (no edge dependencies), parallel execution would reduce total workflow time.
- **Recommendation:** Analyze step dependency graph for parallel execution opportunities.

---

## 🟡 LOW Severity Issues

### LOW — Duplication

#### L-DUP-1: Visualizer Agent Detection Logic

- **Area:** ADK
- **Files:**
  - `src/langgraph_engine/graph_builder.py:270-274`
  - `src/langgraph_engine/step_executor.py:240-245`
- **Description:** The `is_visualizer` check is duplicated (also inconsistent — one uses `agent["name"]`, the other `agent.get("name")`).
- **Recommendation:** Extract to `is_visualizer_agent(agent)` helper.

---

#### L-DUP-2: Error-to-Queue Pattern in `execute_manager.py`

- **Area:** ADK
- **File:** `src/smart_rag/playbook_dir/execute_manager.py:218-227`
and `:240-249`
- **Description:** Same error-queue-sending logic in two separate exception handlers.
- **Recommendation:** Extract to a method.

---

#### L-DUP-3: `getExecutionModeLabel` Copied 3 Times

- **Area:** Frontend
- **Files:**
  - `components/ExecutionPanel.tsx:19`
  - `components/ExecutionStepDetail.tsx:27`
  - `components/ExecutionHeader.tsx:11`
- **Recommendation:** Shared constant map.

---

### LOW — Inconsistency

#### L-INC-1: Unnecessary `as any` Type Casts

- **Area:** Frontend
- **File:** `store.ts`
- **Description:** SSE event data status is cast `as any` instead of being typed as `ExecutionStatus`.
- **Recommendation:** Use proper type.

---

#### L-INC-2: `_build_task_results` Redundant `isinstance` Checks

- **Area:** ADK
- **File:** `src/langgraph_engine/workflow_service.py:206-244`
- **Description:** `isinstance(r, dict)` checked multiple times per iteration.
- **Recommendation:** Single guard.

---

### LOW — Performance

No additional low-severity performance issues beyond what's covered above.

---

## 🛠️ Refactor Action Plan

### Phase 1: Shared Foundations

> **Prerequisite for all other phases.** **Estimated effort:** 2-3 days

#### 1.1 Backend Utilities

Create `utils/` in the playbook back module:

| Utility | Replaces | Lines saved |
|---|---|---|
| `extractId(doc)` | `(x._id \|\| x.id).toString()` × 20+ | ~60 | 
| `safeDate(date)` | `date?.toISOString?.() \|\| date` × 50+ | ~100 | 
| `normalizeStructLike(obj)` | Duplicated in 2 services | ~40 | 
| `extractChatCompletionText(resp)` | Duplicated in 2 services | ~15 | 
| `taskToGrpc(task)` | Task→gRPC mapping × 3 | ~45 | 
| `enrichReplayWithOutputFormat(replay, template)` | Copy-pasted × 2 | 
| ~20 | `recordUsage(execution, usage)` | Usage recording pattern × 3 | 
| ~30 |

**Action:** Create file, refactor all call sites, add tests.

#### 1.2 ADK Shared Utilities

Create `src/langgraph_engine/utils.py`:

| Utility | Replaces |
|---|---|
| `extract_interrupt_from_snapshot(snapshot, task_id, thread_id)` |
Duplicated in 2 files |
| `llm_call(llm_config, system_msg, human_msg)` | `_llm_call` /
`_llm_direct_call` in 2 files |
| `is_visualizer_agent(agent)` | Duplicated in 2 files | 
| `format_workspace_file_hint(documents, cap=12)` | 3 separate 
| implementations | `merge_brain_data(config, agent)` | 2 different 
| implementations |

**Action:** Extract, import everywhere, remove duplicates.

#### 1.3 Frontend Shared Utilities

Create `lib/playbook-utils.ts` or `components/utils/`:

| Utility | Replaces |
|---|---|
| `formatDuration(ms)` | 6 copies |
| `getExecutionModeLabel(mode)` | 3 copies | `applyReplayToTask(task, 
| replay)` | 4 copies in store.ts | `selectAutoStep(taskResults)` | 3 
| copies in store.ts | `smartMergeExecutions(apiExec, cachedExec)` | 2 
| copies in store.ts |

**Action:** Extract, test, replace all call sites.

---

### Phase 2: HIGH Severity Fixes

> **Estimated effort:** 2-3 days

#### 2.1 Merge Output-Format Pipeline (BACK-H-DUP-5/6/7)

**The biggest single win (~200 lines eliminated).**

- Extract a shared `OutputFormatGuideService` class
- Both `PlaybookReplayService` and `PlaybookOutputFormatService` delegate to it
- Shared: system prompt constant, LLM call, response parsing, fallback, DB save, SSE emit
- Each caller only provides: the DB model to write to, the SSE event name

#### 2.2 Consolidate ADK Replay Logic (H-DUP-2/3)

- Extract `_run_task_with_replay_or_live()` shared function
- Both `graph_builder.py` (task_node closure) and `step_executor.py` call it
- Fixes `"#Output Furmat guidelines"` typo once
- Remove `_llm_direct_call` → use shared `llm_call`

#### 2.3 Fix `cloneShare` N+1 (H-PERF-2)

- Batch-lookup users: `UserModel.find({ email: { $in: emails } })`
- Map email→user, skip not-found
- Process clones with `Promise.all` (already uses pLimit)

#### 2.4 Fix ADK Singleton (H-PERF-1)

- Use the `_executor` module-level variable in `execute_step.py`
- Lazy init on first call, reuse thereafter

#### 2.5 Front Store Replay Pattern (H-DUP-8)

- Already covered by Phase 1.3 (`applyReplayToTask`)
- Replace 4 copies → 1 function call

---

### Phase 3: MEDIUM Fixes

> **Estimated effort:** 4-5 days

#### 3.1 Frontend Performance

| Issue | Fix | Effort |
|---|---|---|
| H-PERF-3 — 2s polling fallback | Remove or increase to 10s | 30 min |
| M-PERF-1 — Redundant format guide polling | Remove polling if SSE
covers it | 30 min |
| M-PERF-2 — Double fetchTaskReplays in editor | Merge 2 useEffects
into 1 | 1 hour |
| M-PERF-3 — Fetch on every step click | Gate with
`hasValidatedReplay` | 15 min |
| M-PERF-4 — Double fetch in ExecutionStepDetail | Add loading guard | 
| 30 min |
| H-PERF-4 — Client-side date filtering | Add server-side
filtering/sorting | 2 hours |

#### 3.2 Frontend Inconsistency & Duplication

| Issue | Fix | Effort |
|---|---|---|
| M-INC-13/14 — formatDuration inconsistency | Covered by Phase 1.3 | — 
| |
| M-INC-15 — Hardcoded English strings | Add i18n keys for 7+
components | 3-4 hours |
| M-DUP-2 — Replay badges in 3 components | `<ReplayStatusBadges>`
component | 2 hours |
| L-DUP-3 — getExecutionModeLabel | Shared constant map | 15 min |

#### 3.3 Backend Performance

| Issue | Fix | Effort |
|---|---|---|
| M-PERF-5 — OwnerGuard no cache | Short TTL cache (5-10s) | 1 hour |
| M-PERF-6 — Sequential workspace fetches | Use `Promise.allSettled` | 
| 15 min |
| M-PERF-7 — mapToResponse hot-path DB calls | Accept pre-loaded data
as params | 2 hours |
| M-PERF-8 — Redundant playbook fetch | Refactor to accept optional
param | 1 hour |

#### 3.4 Backend Inconsistency

| Issue | Fix | Effort |
|---|---|---|
| M-INC-11 — Delete response shape | Standardize to `{ deleted: true
}` | 15 min |
| M-INC-12 — Missing @IsMongoId() | Add to all DTO ID fields | 30 min |

#### 3.5 ADK Inconsistency & Performance

| Issue | Fix | Effort |
|---|---|---|
| M-INC-2 — structlog vs get_logger | Standardize on structlog | 2 hours 
| |
| M-INC-3 — .get() vs [] access | Audit graph_builder.py | 30 min |
| M-INC-5 — Error return shapes | Shared error schema | 1 hour |
| M-PERF-9 — build_tree no caching | Cache keyed by doc IDs | 1 hour |
| M-DUP-7 — Resume patterns | `_resume_graph_execution()` helper | 1 
| hour |

---

### Phase 4: LOW + Cleanup

> **Estimated effort:** 1 day

- Extract visualizer detection helper (L-DUP-1)
- Extract error-to-queue pattern (L-DUP-2)
- Fix `duration_ms: 0` in HITL path (M-INC-4)
- Remove misleading `response_model` on streaming endpoints (M-INC-6)
- Clean up `as any` casts (L-INC-1)
- Fix import patterns (M-INC-16)
- Refactor `_build_task_results` redundant checks (L-INC-2)

---

## Timeline Summary

| Phase | What | Days | Impact |
|---|---|---|---|
| **1** | Shared utilities (front/back/ADK) | 2-3 | Foundation for 
| everything |
| **2** | HIGH severity fixes | 2-3 | Eliminates worst duplication +
perf bottlenecks |
| **3** | MEDIUM fixes (perf + inconsistency) | 4-5 | Polish,
consistency, performance tuning |
| **4** | LOW + cleanup | 1 | Code hygiene |
| **Total** | | **~10-12 days** | |

### Recommended Execution Order

1. **Phase 1.1** (back utils) → **Phase 2.1** (merge output-format
pipeline) — biggest bang
2. **Phase 1.2** (ADK utils) → **Phase 2.2** (consolidate replay
logic) — second biggest
3. **Phase 2.3–2.5** (quick wins) — knock them out fast 4. **Phase 3.1** (front perf) — visible UX improvement 5. **Phase 3.2–3.5** (back perf + consistency) 6. **Phase 4** — whenever

---

> 🍃 Generated by BigBong · 2026-03-24
