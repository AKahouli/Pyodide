# Phase 6: Aggressive Legacy Removal Plan

**Goal:** Make the new `playbook-flow` version fully work, then delete all legacy playbook code.

**Branch:** `aga-playbook-005`

---

## Pre-flight Checklist

- [x] Phase 5 complete — all flow backend services, frontend API/store actions, tests pass
- [x] Phase 6 conservative cleanup — 4 deregistered webhook files deleted
- [ ] Ensure no legacy playbook data must be preserved (route `playbooks/:id` becomes flow-only — existing legacy playbooks will be **inaccessible**)

---

## Phase 6a: Add Missing Flow Backend Routes

Before frontend migration can begin, the flow backend must expose all routes the frontend currently uses on legacy controllers.

### 6a.1 — Flow Replay Controller (NEW)

**File:** `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow-replay.controller.ts`

| Route | Method | Calls |
|-------|--------|-------|
| `POST /playbooks/:id/tasks/:taskId/validate-replay` | `validateTaskReplay` | `PlaybookFlowReplayService` |
| `GET /playbooks/:id/tasks/:taskId/replays` | `listTaskReplays` | `PlaybookFlowReplayService` |
| `POST /playbooks/:id/tasks/:taskId/replays/:replayId/activate` | `activateTaskReplay` | `PlaybookFlowReplayService` |
| `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId/format-guide` | `updateTaskReplayFormatGuide` | `PlaybookFlowReplayService` |
| `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId` | `updateTaskReplayLabel` | `PlaybookFlowReplayService` |
| `DELETE /playbooks/:id/tasks/:taskId/replays/:replayId` | `deleteTaskReplay` | `PlaybookFlowReplayService` |

**Verify:** `PlaybookFlowReplayService` methods exist and return compatible response shapes.

### 6a.2 — Flow Output-Format Controller (NEW)

**File:** `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow-output-format.controller.ts`

| Route | Method | Calls |
|-------|--------|-------|
| `POST /playbooks/:id/tasks/:taskId/output-format-template` | `captureFromExecution` | `PlaybookFlowOutputFormatService` |
| `GET /playbooks/:id/tasks/:taskId/output-format-template` | `getActiveTemplate` | `PlaybookFlowOutputFormatService` |
| `PATCH /playbooks/:id/tasks/:taskId/output-format-template` | `update` (add if missing) | `PlaybookFlowOutputFormatService` |
| `DELETE /playbooks/:id/tasks/:taskId/output-format-template` | `delete` (add if missing) | `PlaybookFlowOutputFormatService` |

**Service changes needed:** Add `update` and `delete` methods to `PlaybookFlowOutputFormatService` if not present.

### 6a.3 — Flow Controller Additional Routes

**File:** `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow.controller.ts`

| Route | Method | Calls |
|-------|--------|-------|
| `POST /playbooks/generate` | `generateFlow` | `PlaybookFlowDesignService` |
| `POST /playbooks/rewrite-prompt` | `rewritePrompt` | `PlaybookFlowDesignService` |
| `POST /playbooks/:id/design` | `designFlow` | `PlaybookFlowDesignService` |
| `POST /playbooks/:id/clone` | `cloneFlow` (add if missing) | `PlaybookFlowService` |

**Service changes needed:** Add `cloneFlow` to `PlaybookFlowService` (or implement via `createFlow` with existing flow data).

### 6a.4 — Flow Advisor Controller (NEW, only if advisor UI retained)

**File:** `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow-advisor.controller.ts`

| Route | Method | Calls |
|-------|--------|-------|
| `POST /playbooks/:id/nodes/:nodeId/advisor` | `adviseNode` | `PlaybookFlowAdvisorService` |

### 6a.5 — Module Registration

**Modify:** `YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts`
- Register `PlaybookFlowReplayController`
- Register `PlaybookFlowOutputFormatController`
- Register `PlaybookFlowController` new routes (if separate controller needed)
- Register `PlaybookFlowAdvisorController` (if retained)

### 6a.6 — Config Endpoints

**Modify:** `YellowStorm/front/src/lib/api/config.ts`
- Add `API_ENDPOINTS.playbookFlows.*` entries for all new routes:
  - `generate` — `POST /playbooks/generate`
  - `rewritePrompt` — `POST /playbooks/rewrite-prompt`
  - `design` — `POST /playbooks/:id/design`
  - `clone` — `POST /playbooks/:id/clone`
  - `validateReplay` — `POST /playbooks/:id/tasks/:taskId/validate-replay`
  - `replays` — `GET /playbooks/:id/tasks/:taskId/replays`
  - `activateReplay` — `POST /playbooks/:id/tasks/:taskId/replays/:replayId/activate`
  - `updateReplayFormatGuide` — `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId/format-guide`
  - `updateReplay` — `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId`
  - `deleteReplay` — `DELETE /playbooks/:id/tasks/:taskId/replays/:replayId`
  - `outputFormatTemplate` — `GET /playbooks/:id/tasks/:taskId/output-format-template`
  - `grabOutputFormatTemplate` — `POST /playbooks/:id/tasks/:taskId/output-format-template`
  - `updateOutputFormatTemplate` — `PATCH /playbooks/:id/tasks/:taskId/output-format-template`
  - `deleteOutputFormatTemplate` — `DELETE /playbooks/:id/tasks/:taskId/output-format-template`

### Verification
- [ ] `npm run build` — backend passes
- [ ] Backend typecheck — 0 new errors
- [ ] `npm test -- --testPathPattern "playbook-flow"` — all pass
- [ ] Manual curl test of each new route

---

## Phase 6b: Decouple PlaybookFlowModule from PlaybookModule

### 6b.1 — Extract PlaybookGrpcService for Flow

**Create:** `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-design-grpc.service.ts`

Copy/narrow from `PlaybookGrpcService` only the methods `playbook-flow` needs:
- `onModuleInit`
- `onModuleDestroy`
- `isAvailable`
- `generatePlaybook`
- `advisePlaybookNode`
- `resolveChatbotProtoPath`
- `watchChannelState`

Do NOT copy execution methods (`runStep`, `runStepStream`, `resumePlaybookWorkflow`, etc.).

### 6b.2 — Update Flow Design/Advisor Imports

**Modify:** `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-design.service.ts`
- Replace `import { PlaybookGrpcService } from '@modules/playbook/services/playbook-grpc.service'`
- With `import { PlaybookFlowDesignGrpcService } from './playbook-flow-design-grpc.service'`

**Modify:** `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-advisor.service.ts`
- Same import replacement.

### 6b.3 — Extract pLimit from Legacy Utils

**Create:** `YellowStorm/back/src/modules/playbook-flow/utils/p-limit.ts`

Move/copy the `pLimit` helper used by `PlaybookFlowOutputFormatService`.

**Modify:** `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-output-format.service.ts`
- Replace `import ... from '@modules/playbook/utils/execution.utils'` with local `./p-limit` import.

### 6b.4 — Remove PlaybookModule from PlaybookFlowModule Imports

**Modify:** `YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts`
- Remove `import { PlaybookModule } from '@modules/playbook/playbook.module'`
- Remove `PlaybookModule` from `imports` array
- Add `PlaybookFlowDesignGrpcService` to `providers`

### Verification
- [ ] `npm run build` — backend passes
- [ ] `rg "PlaybookGrpcService" YellowStorm/back/src/modules/playbook-flow` — zero matches
- [ ] `rg "@modules/playbook" YellowStorm/back/src/modules/playbook-flow` — zero matches
- [ ] `npm test -- --testPathPattern "playbook-flow"` — all pass

---

## Phase 6c: Add Missing Flow Frontend Store Actions

### 6c.1 — New Flow API Functions

**Modify:** `YellowStorm/front/src/modules/playbook/api.ts`

| Function | Endpoint | Notes |
|----------|----------|-------|
| `generateFlow(data)` | `POST /playbooks/generate` | |
| `rewriteFlowPrompt(data)` | `POST /playbooks/rewrite-prompt` | |
| `designFlow(id, data)` | `POST /playbooks/:id/design` | |
| `cloneFlow(id)` | `POST /playbooks/:id/clone` | |
| `validateFlowTaskReplay(flowId, taskId, data)` | `POST /playbooks/:id/tasks/:taskId/validate-replay` | |
| `getFlowTaskReplays(flowId, taskId)` | `GET /playbooks/:id/tasks/:taskId/replays` | |
| `activateFlowTaskReplay(flowId, taskId, replayId)` | `POST /playbooks/:id/tasks/:taskId/replays/:replayId/activate` | |
| `updateFlowTaskReplayFormatGuide(flowId, taskId, replayId, data)` | `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId/format-guide` | |
| `renameFlowTaskReplay(flowId, taskId, replayId, label)` | `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId` | |
| `deleteFlowTaskReplay(flowId, taskId, replayId)` | `DELETE /playbooks/:id/tasks/:taskId/replays/:replayId` | |
| `grabFlowOutputFormatTemplate(flowId, taskId, data)` | `POST /playbooks/:id/tasks/:taskId/output-format-template` | |
| `getFlowOutputFormatTemplate(flowId, taskId)` | `GET /playbooks/:id/tasks/:taskId/output-format-template` | |
| `updateFlowOutputFormatTemplate(flowId, taskId, data)` | `PATCH /playbooks/:id/tasks/:taskId/output-format-template` | |
| `deleteFlowOutputFormatTemplate(flowId, taskId)` | `DELETE /playbooks/:id/tasks/:taskId/output-format-template` | |

### 6c.2 — New Store Actions

**Modify:** `YellowStorm/front/src/modules/playbook/store.ts`

Add flow store actions wrapping the new API functions. Follow existing patterns (try/catch, `handleApiError`, state updates via `set()`).

| Store Action | API Call | State Update |
|-------------|----------|--------------|
| `fetchFlow(id)` | `api.getFlow(id)` | Set `currentPlaybook` (map Flow to canvas-compatible shape) |
| `fetchFlows(query)` | `api.getFlows(query)` | Set `playbooks` |
| `createFlow(data)` | `api.createFlow(data)` | Prepend to `playbooks` |
| `updateFlow(id, data, idempotencyKey?)` | `api.updateFlow(id, data, idempotencyKey)` | Update `currentPlaybook` |
| `deleteFlow(id)` | `api.deleteFlow(id)` | Remove from `playbooks` |
| `cloneFlow(id)` | `api.cloneFlow(id)` | Prepend to `playbooks` |
| `startFlowExecutionAction(flowId, inputContext, idempotencyKey?)` | `api.startFlowExecution(...)` | Update execution state |
| `fetchFlowExecutions(flowId)` | `api.getFlowExecutions(flowId)` | Update `executionHistory` |
| `fetchFlowExecution(executionId)` | `api.getFlowExecutionDetail(executionId)` | Update `currentExecution` |
| `cancelFlowExecutionAction(executionId)` | `api.cancelFlowExecution(executionId)` | Update execution status |
| `validateFlowTaskReplay(...)` | `api.validateFlowTaskReplay(...)` | Update task replay state |
| `fetchFlowTaskReplays(flowId, taskId)` | `api.getFlowTaskReplays(flowId, taskId)` | Return replays |
| `activateFlowTaskReplay(flowId, taskId, replayId)` | `api.activateFlowTaskReplay(...)` | Update task active replay |
| `updateFlowTaskReplayFormatGuide(...)` | `api.updateFlowTaskReplayFormatGuide(...)` | Update replay format guide |
| `renameFlowTaskReplay(flowId, taskId, replayId, label)` | `api.renameFlowTaskReplay(...)` | Update replay label |
| `deleteFlowTaskReplay(flowId, taskId, replayId)` | `api.deleteFlowTaskReplay(...)` | Clear task replay state |
| `grabFlowOutputFormatTemplate(...)` | `api.grabFlowOutputFormatTemplate(...)` | Update task output format state |
| `fetchFlowOutputFormatTemplate(flowId, taskId)` | `api.getFlowOutputFormatTemplate(...)` | Return template |
| `updateFlowOutputFormatTemplate(...)` | `api.updateFlowOutputFormatTemplate(...)` | Update template |
| `deleteFlowOutputFormatTemplate(flowId, taskId)` | `api.deleteFlowOutputFormatTemplate(...)` | Clear task output format state |
| `generateFlow(data)` | `api.generateFlow(data)` | Return `{ id }` |
| `designFlow(id, data)` | `api.designFlow(id, data)` | Update design messages |

### 6c.3 — Type Declarations

**Modify:** `YellowStorm/front/src/modules/playbook/types.ts`

Add all new store action type declarations to `PlaybookActions` interface.

### Verification
- [ ] `npx tsc --noEmit` — frontend, 0 errors
- [ ] `npm run build` — frontend passes

---

## Phase 6d: Migrate Frontend Components to Flow Actions

### 6d.1 — PlaybookCanvasPage.tsx

Replace all legacy store action usage with flow equivalents. Preserve existing helpers/serializers.

| Legacy Action | New Flow Action |
|---------------|-----------------|
| `fetchPlaybook(id)` | `fetchFlow(id)` |
| `fetchExecution(executionId)` | `fetchFlowExecution(executionId)` |
| `fetchExecutions(playbookId)` | `fetchFlowExecutions(flowId)` |
| `updatePlaybook(id, data)` | `updateFlow(id, data)` |
| `clonePlaybook(id)` | `cloneFlow(id)` |
| `executePlaybook(id, data)` | `startFlowExecutionAction(flowId, inputContext, idempotencyKey)` |
| `stopExecution(playbookId, executionId)` | `cancelFlowExecutionAction(executionId)` |
| `validateTaskReplay(...)` | `validateFlowTaskReplay(...)` |
| `deleteTaskReplay(...)` | `deleteFlowTaskReplay(...)` |
| `renameTaskReplay(...)` | `renameFlowTaskReplay(...)` |
| `grabOutputFormatTemplate(...)` | `grabFlowOutputFormatTemplate(...)` |
| `fetchOutputFormatTemplate(...)` | `fetchFlowOutputFormatTemplate(...)` |
| `fetchRepeatability(id)` | `fetchFlowRepeatability(flowId)` (already exists) |
| `upsertPlaybookTriggerSchedule(...)` | `upsertFlowTriggerSchedule(...)` |
| `clearPlaybookTriggerSchedule(...)` | `upsertFlowTriggerSchedule(flowId, { enabled: false })` |
| `upsertPlaybookTriggerMail(...)` | `upsertFlowTriggerMail(...)` |
| `clearPlaybookTriggerMail(...)` | `upsertFlowTriggerMail(flowId, { enabled: false })` |
| `syncPlaybookTriggerMailSubscription(...)` | `syncFlowMailSubscription(...)` |

**Unsupported features — REMOVE UI for:**
- `rerunStepInExecution` — no flow equivalent
- `resumeFromStep` — no flow equivalent
- `skipExecutionStep` — no flow equivalent (approval resume exists separately)
- `requestPlaybookIntent` — no flow equivalent (intent service)
- Judge/advisor autopilot controls — no direct flow equivalent
- `updatePlaybookFromJudge`, `generatePlaybookFromJudge`, `optimizeStepFromJudge`

**Data shape notes:**
- Legacy `tasks` → Flow `nodes` (field mapping: `title→label`, `nodeType→kind`, `positionX/positionY→x/y`)
- Legacy `edges` → Flow `controlEdges`
- Legacy `evaluationConfig.weights` → may need mapping to flow evaluation shape

### 6d.2 — PlaybookScheduleSheet.tsx

| Legacy Action | New Flow Action |
|---------------|-----------------|
| `upsertPlaybookTriggerSchedule(...)` | `upsertFlowTriggerSchedule(flowId, data)` |
| `clearPlaybookTriggerSchedule(id)` | `upsertFlowTriggerSchedule(flowId, { enabled: false })` |
| `upsertPlaybookTriggerMail(...)` | `upsertFlowTriggerMail(flowId, data)` |
| `clearPlaybookTriggerMail(id)` | `upsertFlowTriggerMail(flowId, { enabled: false })` |
| `syncPlaybookTriggerMailSubscription(...)` | `syncFlowMailSubscription(flowId, data)` |

**Route change:** Legacy uses `PUT /triggers/schedule`, `PUT /triggers/mail`, `POST /triggers/mail/sync-subscription`. Flow uses `PATCH /trigger/schedule`, `PATCH /trigger/mail`, `POST /trigger/mail/subscription`. Ensure payload shapes match.

### 6d.3 — ExecutionPanel.tsx

| Legacy Action/Hook | New Flow Equivalent |
|---------------------|---------------------|
| `useCurrentExecution` | Keep store state, populate via flow execution |
| `useCurrentPlaybook` | Keep store state, populate via flow |
| `stopExecution(id, execId)` | `cancelFlowExecutionAction(execId)` |
| `validateTaskReplay(...)` | `validateFlowTaskReplay(...)` |
| `grabOutputFormatTemplate(...)` | `grabFlowOutputFormatTemplate(...)` |
| `fetchExecution(execId)` | `fetchFlowExecution(execId)` |
| `fetchTaskReplays(...)` | `fetchFlowTaskReplays(...)` |
| `deleteAllExecutions(id)` | Remove UI (no flow equivalent) |
| `deleteExecution(...)` | Remove UI (no flow equivalent) |
| `rerunStepInExecution(...)` | Remove UI (no flow equivalent) |

### 6d.4 — ExecutionStepDetail.tsx

| Legacy Action | New Flow Action |
|---------------|-----------------|
| `deleteExecution(...)` | Remove UI (no flow equivalent) |
| `deleteStepExecution(...)` | Remove UI (no flow equivalent) |
| `updatePlaybookFromJudge(...)` | Remove UI (no flow equivalent) |
| `generatePlaybookFromJudge(...)` | Remove UI (no flow equivalent) |
| `optimizeStepFromJudge(...)` | Remove UI (no flow equivalent) |
| `fetchAdvisorRemediations(...)` | Remove UI (no flow equivalent) |
| `designPlaybook(...)` | `designFlow(id, data)` |
| `reapplyOptimization(...)` | Remove UI (no flow equivalent) |
| `executePlaybook(...)` | `startFlowExecutionAction(...)` |
| `fetchEvaluationBaseline(...)` | `fetchFlowEvaluationBaseline(...)` (exists) |
| `createEvaluationBaselineFromExecution(...)` | `createFlowEvaluationBaseline(...)` (exists) |
| `fetchEvaluationExecutions(...)` | `fetchFlowEvaluationExecutions(...)` (exists) |
| `traceReplayExecution(...)` | Already uses flow API endpoint |
| `reExecuteExecution(...)` | Already uses flow API endpoint |

### 6d.5 — PlaybookNodeEditor.tsx

| Legacy Action | New Flow Action |
|---------------|-----------------|
| `fetchTaskReplays(...)` | `fetchFlowTaskReplays(...)` |
| `activateTaskReplay(...)` | `activateFlowTaskReplay(...)` |
| `updateTaskReplayFormatGuide(...)` | `updateFlowTaskReplayFormatGuide(...)` |
| `fetchEvaluationBaseline(...)` | `fetchFlowEvaluationBaseline(...)` (exists) |
| `fetchEvaluationExecutions(...)` | `fetchFlowEvaluationExecutions(...)` (exists) |
| `createEvaluationBaselineFromExecution(...)` | `createFlowEvaluationBaseline(...)` (exists) |
| `createEvaluationBaselineFromCurrentExecution(...)` | `createFlowEvaluationBaselineFromCurrentExecution(...)` (exists) |
| `deleteEvaluationBaseline(...)` | `deleteFlowEvaluationBaseline(...)` (exists) |

### 6d.6 — Update Tests

- Update all component tests broken by action renames
- Add tests for new flow store actions
- Verify no test references deleted legacy actions

### Verification
- [ ] `npx tsc --noEmit` — frontend, 0 errors
- [ ] `npm run build` — frontend passes
- [ ] `npm test` — frontend, all passing
- [ ] `rg "fetchPlaybook\|updatePlaybook\|executePlaybook\|stopExecution\|validateTaskReplay\|upsertPlaybookTrigger\|clearPlaybookTrigger\|fetchTaskReplays\|activateTaskReplay\|fetchPlaybook\|playbooks\." YellowStorm/front/src/modules/playbook/components` — zero matches in components
- [ ] Frontend QA: playbook list loads, canvas opens, triggers save, execution runs

---

## Phase 6e: Delete Legacy Backend Code

Once frontend migration is complete and verified, delete ALL legacy playbook code.

### 6e.1 — Delete Legacy Controllers

| File | Reason |
|------|--------|
| `playbook/controllers/playbook.controller.ts` | Replaced by `PlaybookFlowController` |
| `playbook/controllers/playbook.controller.spec.ts` | |
| `playbook/controllers/playbook-execution.controller.ts` | Replaced by `PlaybookFlowExecutionController` |
| `playbook/controllers/playbook-execution.controller.spec.ts` | |
| `playbook/controllers/playbook-stream.controller.ts` | No flow streaming equivalent (remove) |
| `playbook/controllers/playbook-stream.controller.spec.ts` | |
| `playbook/controllers/playbook-node-advisor.controller.ts` | Replaced by `PlaybookFlowAdvisorController` |
| `playbook/controllers/playbook-node-advisor.controller.spec.ts` | |
| `playbook/controllers/admin-playbook-prompts.controller.ts` | Replaced by flow prompt template endpoints |
| `playbook/controllers/admin-playbook-settings.controller.ts` | Replaced by flow settings endpoints |
| `playbook/controllers/admin-playbook-node-templates.controller.ts` | Replaced by flow template endpoints |
| `playbook/controllers/playbook-node-templates.controller.ts` | Replaced by flow template endpoints |

### 6e.2 — Delete Legacy Services

| File | Reason |
|------|--------|
| `playbook/services/playbook.service.ts` + spec | Replaced by `PlaybookFlowService` |
| `playbook/services/playbook-execution.service.ts` + spec | Replaced by `PlaybookFlowExecutionService` |
| `playbook/services/playbook-design.service.ts` + spec | Replaced by `PlaybookFlowDesignService` |
| `playbook/services/playbook-replay.service.ts` + spec | Replaced by `PlaybookFlowReplayService` |
| `playbook/services/playbook-output-format.service.ts` + spec | Replaced by `PlaybookFlowOutputFormatService` |
| `playbook/services/playbook-evaluation.service.ts` + spec | Replaced by `PlaybookFlowEvaluationService` |
| `playbook/services/playbook-repeatability.service.ts` + spec | Replaced by `PlaybookFlowRepeatabilityService` |
| `playbook/services/playbook-semantic-enrichment.service.ts` + spec | Replaced by flow evaluation |
| `playbook/services/playbook-judge-enrichment.service.ts` + spec | No flow equivalent (removed) |
| `playbook/services/playbook-intent.service.ts` + spec | No flow equivalent (removed) |
| `playbook/services/playbook-context.service.ts` + spec | Replaced by `PlaybookFlowContextService` |
| `playbook/services/playbook-settings.service.ts` + spec | Replaced by `PlaybookFlowSettingsService` |
| `playbook/services/playbook-prompt.service.ts` + spec | Replaced by `PlaybookFlowPromptTemplateService` |
| `playbook/services/playbook-prompt-template-renderer.service.ts` | Replaced by `PlaybookFlowPromptRendererService` |
| `playbook/services/playbook-node-template.service.ts` + spec | Replaced by `PlaybookFlowNodeTemplateService` |
| `playbook/services/playbook-node-advisor.service.ts` + spec | Replaced by `PlaybookFlowAdvisorService` |
| `playbook/services/playbook-node-suggestions.service.ts` | No flow equivalent (removed) |
| `playbook/services/playbook-stream-gateway.service.ts` | No flow streaming (removed) |
| `playbook/services/playbook-execution-graph.service.ts` | Legacy helper (removed) |
| `playbook/services/playbook-execution-notification.service.ts` | Legacy helper (removed) |
| `playbook/services/playbook-execution-buffer.service.ts` | Legacy helper (removed) |
| `playbook/services/playbook-execution-advisor.service.ts` | Legacy helper (removed) |
| `playbook/services/playbook-schedule-runner.service.ts` + spec | Replaced by `PlaybookFlowScheduleService` |
| `playbook/services/playbook-mail-event-ledger.service.ts` + spec | Replaced by `PlaybookFlowMailEventLedgerService` |
| `playbook/services/playbook-mail-event-ingestion.service.ts` | Replaced by `PlaybookFlowMailEventIngestionService` |
| `playbook/services/playbook-mail-trigger-matcher.service.ts` + spec | Replaced by `PlaybookFlowMailTriggerMatcherService` |
| `playbook/services/playbook-mail-trigger-orchestration.service.ts` | Replaced by `PlaybookFlowMailTriggerOrchestrationService` |
| `playbook/services/playbook-mail-trigger-handoff.service.ts` | Replaced by `PlaybookFlowMailTriggerHandoffService` |
| `playbook/services/playbook-mail-trigger-test-event.service.ts` | No flow equivalent (removed) |
| `playbook/services/playbook-mail-graph-client.service.ts` + spec | Replaced by `PlaybookFlowMailGraphClientService` |
| `playbook/services/playbook-mail-subscription-renewal.service.ts` | Replaced by `PlaybookFlowMailSubscriptionRenewalService` |
| `playbook/services/playbook-grpc.service.ts` + spec | Replaced by `PlaybookFlowDesignGrpcService` |

### 6e.3 — Delete Legacy Schemas

| File | Reason |
|------|--------|
| `playbook/schemas/playbook.schema.ts` | Replaced by Flow schema |
| `playbook/schemas/playbook-execution.schema.ts` | Replaced by FlowExecution/FlowTaskResult/FlowRouterDecision |
| `playbook/schemas/playbook-design-message.schema.ts` | Replaced by FlowDesignMessage |
| `playbook/schemas/playbook-validated-replay.schema.ts` | Replaced by FlowValidatedReplay |
| `playbook/schemas/playbook-output-format-template.schema.ts` | Replaced by FlowOutputFormat |
| `playbook/schemas/playbook-prompt-template.schema.ts` | Replaced by FlowPromptTemplate |
| `playbook/schemas/playbook-node-template.schema.ts` | Replaced by FlowNodeTemplate |
| `playbook/schemas/playbook-mail-event-ledger.schema.ts` | Replaced by FlowMailEventLedger |
| `playbook/schemas/playbook-evaluation-baseline.schema.ts` | Replaced by FlowEvaluationBaseline |
| `playbook/schemas/playbook-evaluation-execution.schema.ts` | Replaced by FlowEvaluationExecution |

### 6e.4 — Delete Legacy DTOs

Delete all DTO files under `playbook/dto/` that are only referenced by deleted controllers/services. Check each with `rg "DtoName" YellowStorm/back/src` before deletion.

### 6e.5 — Delete Legacy Interfaces/Utils

| File | Reason |
|------|--------|
| `playbook/interfaces/playbook.interface.ts` | Only if no remaining imports |
| `playbook/interfaces/playbook-mail.interface.ts` | Only if no remaining imports |
| `playbook/utils/execution.utils.ts` | After pLimit extraction |

### 6e.6 — Remove PlaybookModule

**Modify:** `YellowStorm/back/src/app.module.ts`
- Remove `import { PlaybookModule } from './modules/playbook/playbook.module'`
- Remove `PlaybookModule` from `imports` array

**Delete:** `YellowStorm/back/src/modules/playbook/playbook.module.ts`
- Only after confirming no remaining imports from `app.module.ts` or anywhere else.

### 6e.7 — Delete Legacy Frontend API/Store

**Modify:** `YellowStorm/front/src/modules/playbook/api.ts`
- Remove all legacy API functions (e.g., `getPlaybookRepeatability`, `upsertPlaybookTriggerSchedule`, `clearPlaybookTriggerSchedule`, `getTaskRepeatability`, `validateTaskReplay`, `getTaskReplays`, `activateTaskReplay`, etc.)
- Keep only flow API functions

**Modify:** `YellowStorm/front/src/modules/playbook/store.ts`
- Remove all legacy store actions
- Keep only flow store actions

**Modify:** `YellowStorm/front/src/modules/playbook/types.ts`
- Remove legacy action type declarations
- Remove legacy types no longer referenced

**Modify:** `YellowStorm/front/src/lib/api/config.ts`
- Remove unused `API_ENDPOINTS.playbooks.*` entries (legacy endpoints)

### Verification
- [ ] `rg "PlaybookModule" YellowStorm/back/src` — zero matches
- [ ] `rg "@modules/playbook" YellowStorm/back/src` — zero matches
- [ ] `rg "API_ENDPOINTS\.playbooks\." YellowStorm/front/src/modules/playbook` — zero matches outside config
- [ ] `rg "api\.(getPlaybook|updatePlaybook|executePlaybook|stopExecution|validateTaskReplay|upsertPlaybookTrigger|clearPlaybookTrigger|fetchTaskReplays|activateTaskReplay)" YellowStorm/front/src/modules/playbook` — zero matches
- [ ] Backend: `npm run build` — passes
- [ ] Backend: `npm test` — all passing (legacy spec files deleted)
- [ ] Frontend: `npm run build` — passes
- [ ] Frontend: `npm test` — all passing (updated tests)
- [ ] Frontend QA: full smoke test

---

## Phase 6f: Final Cleanup & Vault Sync

### 6f.1 — Remove Empty Directories

If `YellowStorm/back/src/modules/playbook/` is empty after all deletions, remove it.

### 6f.2 — Vault Sync (Full Tier)

Update vault notes:
- `YellowStorm/Features/playbook-rewrite.md` — mark complete, record legacy deletion
- `YellowStorm/Features/playbook-flow.md` — note that flow is now the only implementation
- `YellowStorm/Timeline/2026-05.md` — add Phase 6 completion entry

### 6f.3 — Reviewer Gate

Submit all changes for reviewer PASS before merge.

---

## Execution Order

```
Phase 6a ──▶ Phase 6b ──▶ Phase 6c ──▶ Phase 6d ──▶ Phase 6e ──▶ Phase 6f
(backend    (decouple  (frontend   (migrate    (delete     (cleanup)
 routes)     modules)   store)      components)  legacy)
```

Each phase gates on the previous. No legacy deletion (Phase 6e) before frontend migration (Phase 6d) is verified complete.

---

## Risk Summary

| Risk | Mitigation |
|------|-----------|
| Existing legacy playbooks become inaccessible | Confirmed acceptable — user chose flow-only |
| Route conflicts during transition | Legacy controllers deleted before verification |
| Frontend components silently still call legacy | Grep verification gate in Phase 6e |
| Missing flow feature causes UX gap | Remove unsupported UI controls in Phase 6d |
| gRPC design/advisor regression | Keep same proto path/config; add test |
| Test suites break massively | Delete legacy specs with files; update component tests in same PR |
