# YellowStorm Workflow Copilot — Multiphase Implementation Plan

> Target branch: `aga-worky-003`  
> Audience: AI coding agent / implementation engineer  
> Goal: evolve the current Playbook AI Agent Builder into a persistent, smart Workflow Copilot able to understand, diagnose, improve, modify, configure, test, run, and recover workflows conversationally.

---

## 1. Product north star

The current AI builder must move from:

```text
User prompt -> generated workflow -> user manually fixes gaps
```

to:

```text
User can ask anything at any moment -> Copilot understands workflow state -> Copilot explains / plans / patches / validates / asks / applies / runs
```

The Workflow Copilot should behave like a real collaborative agent embedded in the Playbook Builder:

- It can answer questions about the current workflow.
- It can add new steps.
- It can improve an existing step.
- It can rewire graph dependencies.
- It can bind connectors, skills, documents, workspaces, and output destinations.
- It can diagnose missing bindings, risky side effects, ambiguous business rules, and low execution readiness.
- It can propose deterministic patch previews before mutating the workflow.
- It can apply safe changes with confirmation when needed.
- It can participate during execution through HITL interruptions.
- It can learn from user feedback when the user explicitly chooses to remember it.

This feature should make the Playbook Builder feel like a **workflow-aware copilot**, not a one-shot workflow generator.

---

## 2. Existing implementation to preserve and extend

Do not rewrite the current Playbook AI stack from scratch. Extend it.

Relevant existing files:

### Backend

- `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow.controller.ts`
  - Already exposes:
    - `POST /playbooks/:id/intent`
    - `POST /playbooks/:id/intent-design`
    - `POST /playbooks/:id/intent-constructions`
    - `GET /playbooks/:id/intent-constructions/:constructionId/stream`
    - `POST /playbooks/:id/intent-constructions/:constructionId/cancel`
    - design message endpoints.

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts`
  - Builds the intent analysis context.
  - Loads existing workflow summary, selected node context, default agents, node templates, primitive catalog, available design catalog, captured clarifications, and resolved design resources.
  - Calls `intent.analyze` and `intent.design_assessment` prompts.

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts`
  - Runs realtime intent construction.
  - Streams construction events.
  - Parses blueprint output.
  - Builds workflow plan suggestions.
  - Enriches suggestions with diagnostics.

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-parser.service.ts`
  - Parses blueprint JSON.
  - Emits parser diagnostics.

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-builder.service.ts`
  - Compiles blueprint into workflow plan changes.
  - Emits graph builder diagnostics.

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-suggestion-diagnostics.service.ts`
  - Enriches workflow suggestions with validation diagnostics.
  - Adjusts confidence based on diagnostic severity.

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts`
  - Contains prompt templates:
    - `intent.analyze`
    - `intent.design_assessment`

### Frontend

- `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
  - Current chat-like designer panel.
  - Already supports design history.
  - Already supports design clarification questions.
  - Already supports `design` and `interrupt` copilot modes.

- `YellowStorm/front/src/modules/playbook/components/PlaybookIntentBar.tsx`
  - Current fast intent entry / suggestion UI.
  - Supports clarification questions, suggestions, realtime construction progress, and cancel.

- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts`
  - Orchestrates intent design assessment, intent generation, realtime construction, auto-apply, fallback generation, and save logic.

- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
  - Applies intent suggestions to the canvas.
  - Handles deterministic IDs, graph mutation, binding mutation, focus/highlight, save, and construction state.

- `YellowStorm/front/src/modules/playbook/api.ts`
  - Existing API wrapper layer.

- `YellowStorm/front/src/modules/playbook/types.ts`
  - Existing Playbook, intent, construction, HITL, and workflow graph types.

- `YellowStorm/front/src/modules/playbook/store.ts`
  - Existing Zustand store.
  - Already stores design messages, current playbook, executions, UI state, and `copilotMode`.

---

## 3. Non-goals

For the first implementation, do not attempt to build a fully autonomous unrestricted agent.

Avoid:

- Direct uncontrolled workflow mutation from raw LLM text.
- Tool execution outside explicit Playbook/connector contracts.
- Background autonomous edits without visible user intent.
- Replacing existing intent-generation code.
- Removing the current intent bar or DesignerPanel.
- Building a separate new product surface disconnected from Playbook.

The Copilot must be powerful, but always graph-aware, policy-aware, and patch-driven.

---

## 4. Guiding principles

### 4.1 One persistent copilot, multiple modes

The Copilot should cover:

- Design/build mode.
- Diagnostic/review mode.
- Step-edit mode.
- Execution/HITL mode.
- Recovery/failure-analysis mode.

Do not create fragmented assistants for each use case.

### 4.2 LLM plans, deterministic code applies

The LLM may classify, explain, and propose. It must not directly mutate persistent workflow state.

Workflow changes must be compiled into existing `PlaybookIntentSuggestion` / `PlaybookIntentWorkflowChange` structures or new deterministic patch structures, then validated before application.

### 4.3 Preview before mutation

Any non-trivial mutation should produce a patch preview:

- What will be added.
- What will be updated.
- What will be deleted.
- Which connectors/resources will be used.
- Which risks are introduced.
- Whether user approval is required.

### 4.4 Ask only decision-driving questions

The Copilot should ask clarification only when the answer changes:

- Workflow structure.
- Datasource binding.
- Connector/action choice.
- HITL approval/review rules.
- Output format.
- External side effects.
- Cost/reliability tradeoff.

### 4.5 Keep graph correctness deterministic

Always validate:

- Required inputs are bound.
- Port artifact kinds match.
- Router labels are valid.
- Connector slugs/action keys exist.
- Skill slugs exist.
- Node template keys exist.
- Conditional edges are valid.
- Iterator scoping is valid.
- No duplicate binding targets unless explicitly supported by merge nodes.

---

## 5. Target high-level architecture

```text
Frontend Copilot Panel / Intent Bar
        |
        v
POST /playbooks/:id/copilot/turn
        |
        v
PlaybookWorkflowCopilotService
        |
        +-- CopilotContextAssemblerService
        +-- CopilotIntentRouterService
        +-- CopilotPlannerService
        +-- CopilotPatchCompilerService
        +-- CopilotDiagnosticMapperService
        +-- CopilotActionPolicyService
        |
        v
CopilotTurnResponse
        |
        +-- user-facing message
        +-- patch preview
        +-- suggestions/actions
        +-- diagnostic report
        +-- clarification questions
        +-- optional workflow plan suggestion
```

Existing services to reuse:

- `PlaybookFlowIntentService`
- `PlaybookFlowIntentConstructionService`
- `PlaybookIntentBlueprintParserService`
- `PlaybookIntentGraphBuilderService`
- `PlaybookIntentSuggestionDiagnosticsService`
- `PlaybookFlowValidatorService`
- `PlaybookFlowPromptTemplateService`
- `PlaybookFlowPromptRendererService`
- `AgentService`
- `SkillService`
- `ConnectorService`
- `WorkspaceService`
- `WorkspaceDocumentService`

---

## 6. New backend contracts

Create a new backend interface file:

```text
YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-workflow-copilot.interface.ts
```

Suggested contracts:

```ts
export type CopilotIntentKind =
  | 'answer_question'
  | 'diagnose_workflow'
  | 'generate_workflow'
  | 'add_steps'
  | 'update_steps'
  | 'delete_steps'
  | 'rewire_graph'
  | 'bind_resources'
  | 'bind_connectors'
  | 'configure_hitl'
  | 'optimize_cost'
  | 'optimize_reliability'
  | 'optimize_quality'
  | 'test_workflow'
  | 'run_workflow'
  | 'resume_interruption'
  | 'unknown';

export type CopilotResponseMode =
  | 'answer'
  | 'needs_clarification'
  | 'plan'
  | 'patch_preview'
  | 'diagnostic_report'
  | 'execution_action'
  | 'error';

export type CopilotActionType =
  | 'apply_patch'
  | 'open_node'
  | 'select_node'
  | 'bind_connector'
  | 'bind_resource'
  | 'add_human_approval'
  | 'run_dry_test'
  | 'start_workflow'
  | 'resume_execution'
  | 'save_memory'
  | 'ignore_warning'
  | 'ask_followup';

export type CopilotRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CopilotTurnRequest {
  message: string;
  selectedTaskId?: string | null;
  origin?: 'designer_panel' | 'intent_bar' | 'canvas' | 'execution_panel' | 'node_editor';
  modeHint?: 'design' | 'diagnostic' | 'step' | 'execution' | 'interrupt' | null;
  applyPolicy?: 'preview_only' | 'auto_apply_safe' | 'force_apply' | null;
  referencedExecutionId?: string | null;
  referencedInterruptId?: string | null;
  attachments?: Array<{
    name?: string;
    mediaType: string;
    data: string;
  }>;
}

export interface CopilotQuestion {
  id: string;
  question: string;
  reason: string;
  category:
    | 'datasource'
    | 'connector'
    | 'trigger'
    | 'input'
    | 'output'
    | 'business_rule'
    | 'approval'
    | 'scope'
    | 'cost'
    | 'quality'
    | 'execution';
  required: boolean;
  choices?: string[];
  resourceSelector?: 'workspace_or_document' | 'destination_workspace';
}

export interface CopilotAction {
  id: string;
  type: CopilotActionType;
  label: string;
  reason: string;
  risk: CopilotRiskLevel;
  requiresConfirmation: boolean;
  targetTaskId?: string | null;
  targetNodeRef?: string | null;
  diagnosticCodes?: string[];
  payload?: Record<string, unknown>;
}

export interface DiagnosticCard {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  stage?: string;
  code?: string;
  itemId?: string;
  targetTaskId?: string | null;
  targetNodeRef?: string | null;
  repairable: boolean;
  suggestedActionIds: string[];
}

export type WorkflowReadinessStatus =
  | 'ready'
  | 'needs_configuration'
  | 'needs_decision'
  | 'unsafe'
  | 'incomplete';

export interface WorkflowDiagnosticReport {
  readiness: WorkflowReadinessStatus;
  score: number;
  summary: string;
  blockers: DiagnosticCard[];
  warnings: DiagnosticCard[];
  infos: DiagnosticCard[];
  assumptions: string[];
  riskFlags: string[];
  nextActions: CopilotAction[];
}

export interface WorkflowPatchPreview {
  title: string;
  summary: string;
  nodesToCreate: number;
  nodesToUpdate: number;
  nodesToDelete: number;
  edgesToCreate: number;
  edgesToDelete: number;
  dataBindingsToCreate: number;
  dataBindingsToDelete: number;
  affectedTaskIds: string[];
  businessOutcome: string;
  risk: CopilotRiskLevel;
}

export interface CopilotTurnResponse {
  mode: CopilotResponseMode;
  intentKind: CopilotIntentKind;
  message: string;
  confidence: number;
  questions?: CopilotQuestion[];
  actions?: CopilotAction[];
  diagnosticReport?: WorkflowDiagnosticReport;
  patchPreview?: WorkflowPatchPreview;
  suggestion?: unknown; // use PlaybookIntentSuggestion at implementation time
  suggestions?: unknown[];
  traceId?: string;
}
```

Implementation note: replace `unknown` with the real `PlaybookIntentSuggestion` type where import boundaries allow it.

---

## 7. New backend DTOs

Create:

```text
YellowStorm/back/src/modules/playbook-flow/dto/request-playbook-workflow-copilot.dto.ts
```

Suggested DTO:

```ts
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CopilotAttachmentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  mediaType!: string;

  @IsString()
  data!: string;
}

export class RequestPlaybookWorkflowCopilotDto {
  @IsString()
  @MaxLength(20000)
  message!: string;

  @IsOptional()
  @IsString()
  selectedTaskId?: string | null;

  @IsOptional()
  @IsIn(['designer_panel', 'intent_bar', 'canvas', 'execution_panel', 'node_editor'])
  origin?: string;

  @IsOptional()
  @IsIn(['design', 'diagnostic', 'step', 'execution', 'interrupt'])
  modeHint?: string | null;

  @IsOptional()
  @IsIn(['preview_only', 'auto_apply_safe', 'force_apply'])
  applyPolicy?: string | null;

  @IsOptional()
  @IsString()
  referencedExecutionId?: string | null;

  @IsOptional()
  @IsString()
  referencedInterruptId?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CopilotAttachmentDto)
  attachments?: CopilotAttachmentDto[];
}
```

---

## 8. New backend endpoints

Update:

```text
YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow.controller.ts
```

Add:

```ts
@Post(':id/copilot/turn')
@ApiOperation({ summary: 'Ask the Workflow Copilot to answer, diagnose, plan, or propose workflow changes' })
@RequirePermissions(Permissions.PLAYBOOK_READ)
async workflowCopilotTurn(
  @CurrentUser('_id') userId: string,
  @Param('id') id: string,
  @Body() dto: RequestPlaybookWorkflowCopilotDto,
) {
  return this.workflowCopilotService.turn(id, userId, dto);
}
```

Permission strategy:

- Start with `PLAYBOOK_READ` because the endpoint may return previews only.
- If `applyPolicy === 'force_apply'` is ever supported server-side, require `PLAYBOOK_UPDATE` or split into a dedicated apply endpoint.
- Prefer preview-only for MVP and reuse frontend `handleApplyIntentSuggestion` to apply changes.

Optional future endpoint:

```ts
@Post(':id/copilot/actions/:actionId/apply')
```

Only add this later if action persistence is needed.

---

## 9. New backend services

Create a folder:

```text
YellowStorm/back/src/modules/playbook-flow/services/copilot/
```

### 9.1 `playbook-workflow-copilot.service.ts`

Responsibilities:

- Main orchestration entrypoint.
- Validate request.
- Assemble context.
- Route intent.
- Decide read-only answer vs patch plan vs diagnostic report vs clarification.
- Return `CopilotTurnResponse`.

Pseudo-flow:

```ts
async turn(flowId: string, ownerId: string, dto: RequestPlaybookWorkflowCopilotDto): Promise<CopilotTurnResponse> {
  const context = await this.contextAssembler.assemble(flowId, ownerId, dto);
  const route = await this.intentRouter.route(context);

  if (route.intentKind === 'answer_question') {
    return this.answerQuestion(context, route);
  }

  if (route.intentKind === 'diagnose_workflow') {
    return this.diagnosticMapper.buildDiagnosticResponse(context);
  }

  if (this.requiresClarification(route, context)) {
    return this.buildClarificationResponse(route, context);
  }

  const plan = await this.planner.plan(context, route);
  const compiled = await this.patchCompiler.compile(context, plan);
  const diagnostics = this.diagnosticMapper.fromSuggestion(compiled.suggestion, context);
  const actions = this.actionPolicy.buildActions(compiled, diagnostics, context);

  return {
    mode: 'patch_preview',
    intentKind: route.intentKind,
    message: this.renderPatchPreviewMessage(compiled, diagnostics),
    confidence: compiled.suggestion.confidence,
    patchPreview: compiled.preview,
    diagnosticReport: diagnostics,
    actions,
    suggestion: compiled.suggestion,
  };
}
```

### 9.2 `copilot-context-assembler.service.ts`

Responsibilities:

- Reuse `PlaybookFlowIntentService.buildIntentAnalysisContext` where possible.
- Add richer execution context when needed.
- Add selected node details.
- Add recent design messages.
- Add diagnostics from current graph validation.
- Add current execution / interrupted task context when `modeHint === 'execution'` or `modeHint === 'interrupt'`.

Context should include:

- Current playbook summary.
- Full current workflow graph summary.
- Selected task context.
- Existing design chat history.
- Current execution status and recent failures when referenced.
- Available agents.
- Available node templates.
- Available connectors/actions.
- Available skills.
- Available workspaces/folders.
- Current diagnostics.
- User message.
- Attachments/images if supplied.

Important: keep payload size bounded. Reuse summary-style context, not full raw objects.

### 9.3 `copilot-intent-router.service.ts`

Responsibilities:

- Classify the user request into `CopilotIntentKind`.
- Determine if request is read-only or mutating.
- Determine target scope:
  - workflow
  - selected node
  - connector/resource
  - execution
  - HITL interruption
- Extract basic slots:
  - target node name/ref/id
  - requested change
  - connector/resource hints
  - output format hints
  - risk/external side effect indicators

Use deterministic LLM with `temperature: 0` or a hybrid heuristic + LLM router.

Router output shape:

```ts
interface CopilotRouteResult {
  intentKind: CopilotIntentKind;
  mutating: boolean;
  targetScope: 'workflow' | 'selected_node' | 'node_by_name' | 'execution' | 'interrupt' | 'unknown';
  targetTaskId?: string | null;
  targetNodeName?: string | null;
  requiresClarification: boolean;
  clarificationReason?: string | null;
  risk: CopilotRiskLevel;
  summary: string;
  confidence: number;
}
```

### 9.4 `copilot-planner.service.ts`

Responsibilities:

- Convert a routed request into a structured copilot plan.
- For workflow mutations, prefer generating a compact blueprint compatible with existing deterministic graph builder.
- For step updates, generate an update-node plan.
- For diagnostics/repairs, use deterministic repair templates first, LLM second.

Planner must return JSON only.

Plan shape:

```ts
interface CopilotPlan {
  title: string;
  summary: string;
  intentKind: CopilotIntentKind;
  operations: CopilotPlanOperation[];
  assumptions: string[];
  riskFlags: string[];
  userExplanation: string;
}
```

Supported operations:

```ts
type CopilotPlanOperation =
  | { type: 'delegate_to_intent_blueprint'; normalizedIntent: string }
  | { type: 'update_node'; targetTaskId: string; patch: Partial<PlaybookIntentTaskDraft> }
  | { type: 'add_human_approval'; beforeTaskId: string; reason: string }
  | { type: 'bind_resource'; targetTaskId: string; targetPort: string; resource: unknown }
  | { type: 'bind_connector'; targetTaskId: string; connectorSlug: string; actionKey: string }
  | { type: 'explain_only'; answer: string };
```

For MVP, most graph mutation requests can delegate to the existing intent blueprint builder by creating a normalized intent string that includes:

- Current user request.
- Selected task if any.
- Captured clarifications.
- Constraints.
- “Return a patch against the existing workflow, not a full replacement.”

### 9.5 `copilot-patch-compiler.service.ts`

Responsibilities:

- Compile `CopilotPlan` into existing `PlaybookIntentSuggestion` / workflow changes.
- Reuse existing builder for blueprint-based operations.
- Build deterministic `update_node`, `create_data_binding`, `create_edge`, etc.
- Run diagnostics enrichment.
- Produce patch preview.

MVP strategy:

- For `delegate_to_intent_blueprint`, call/reuse existing intent analysis flow internally.
- For deterministic operations, directly construct `PlaybookIntentWorkflowChange[]`.
- Always pass result through `PlaybookIntentSuggestionDiagnosticsService.enrichWorkflowPlan`.

### 9.6 `copilot-diagnostic-mapper.service.ts`

Responsibilities:

- Convert internal diagnostics into user-facing `DiagnosticCard[]`.
- Build `WorkflowDiagnosticReport`.
- Compute readiness score.
- Create next actions from known diagnostic codes.

Readiness scoring proposal:

```text
start = 100
- 30 per error blocker
- 12 per warning blocker
- 5 per info/warning minor issue
- 15 if external side effect without approval
- 15 if required input unbound
- 10 if connector binding missing
- 10 if output contract ambiguous
min 0, max 100
```

Status mapping:

```text
score >= 90 and no blockers -> ready
has unbound inputs / missing datasource / missing connector -> needs_configuration
has business-rule ambiguity / approval ambiguity -> needs_decision
has external destructive/sensitive action without HITL -> unsafe
has graph validation errors or no valid changes -> incomplete
```

Diagnostic mapping examples:

| Diagnostic code pattern | Card title | Action |
|---|---|---|
| `validator_rule_*required*` | Missing required input | `bind_resource` or `auto_wire` |
| `blueprint_binding_artifact_mismatch` | Incompatible data flow | Insert conversion/synthesis node |
| `builder_connector_ref_unknown_slug` | Unknown connector | Select available connector |
| `builder_connector_ref_unknown_action` | Unknown connector action | Select available action |
| `builder_node_template_key_unknown` | Unknown node template | Replace with compatible template |
| `builder_router_missing_output_labels` | Router incomplete | Configure router outputs |
| `builder_conditional_edge_invalid_router_label` | Invalid branch route | Fix router label |
| external send risk flag | External side effect | Add human approval |

### 9.7 `copilot-action-policy.service.ts`

Responsibilities:

- Decide which actions require confirmation.
- Decide which actions can be auto-applied if user enabled safe auto-apply.
- Enforce external side-effect policy.
- Enforce destructive action policy.
- Enforce HITL recommendation.

Policy examples:

```text
Read-only answer: no confirmation.
Add non-side-effect node: preview, then apply.
Update step description/prompt: preview, then apply.
Bind workspace/document: user must select resource unless already explicit.
Bind connector: user must confirm connector/action.
External send/create/update/delete action: require confirmation and recommend human approval.
Delete node: always confirm.
Run workflow: require no blockers, otherwise ask user to fix or force run.
Resume HITL interruption: use existing HITL resume flow.
```

---

## 10. Prompt templates

Add new built-in prompts in:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts
```

### 10.1 `copilot.route`

Purpose: classify user request.

System prompt draft:

```text
You are a workflow copilot intent router.
Classify the user's request against the current Playbook workflow context.
Return JSON only.
Do not propose workflow changes here. Only classify intent, risk, target scope, and missing decision points.

Allowed intentKind:
answer_question, diagnose_workflow, generate_workflow, add_steps, update_steps, delete_steps, rewire_graph, bind_resources, bind_connectors, configure_hitl, optimize_cost, optimize_reliability, optimize_quality, test_workflow, run_workflow, resume_interruption, unknown.

Return shape:
{
  "intentKind": "...",
  "mutating": true,
  "targetScope": "workflow|selected_node|node_by_name|execution|interrupt|unknown",
  "targetTaskId": null,
  "targetNodeName": null,
  "requiresClarification": false,
  "clarificationReason": null,
  "risk": "low|medium|high|critical",
  "summary": "...",
  "confidence": 0.0
}

Rules:
- If the user asks what/why/how about the workflow, use answer_question.
- If the user asks to improve, add, remove, rewire, bind, configure, optimize, test, run, or fix, mark mutating=true except diagnose_workflow.
- External communication, destructive operations, or writes to business systems are high risk.
- If selected node is relevant, prefer selected_node scope.
- Ask clarification only if the missing answer changes the workflow structure, datasource, connector action, HITL policy, output format, or external side effect.
```

### 10.2 `copilot.answer`

Purpose: read-only workflow Q&A.

System prompt draft:

```text
You are a workflow-aware copilot.
Answer the user's question using only the provided workflow context.
Do not invent unavailable connectors, resources, node IDs, or execution results.
If the answer is uncertain, say what is missing and suggest a safe next action.
Return JSON only:
{
  "message": "markdown answer",
  "confidence": 0.0,
  "suggestedActions": []
}
```

### 10.3 `copilot.plan`

Purpose: produce a patch-oriented plan.

System prompt draft:

```text
You are a workflow copilot planner.
Convert the user's request into a concise implementation plan that can be compiled into deterministic workflow changes.
Return JSON only.
Do not generate final frontend state.
Do not invent node template keys, connector slugs, connector action keys, skill slugs, resource IDs, workspace IDs, or document IDs.
Use only available catalog entries.
If a required choice is missing, return needsClarification=true with targeted questions.

Return shape:
{
  "title": "...",
  "summary": "...",
  "needsClarification": false,
  "questions": [],
  "operations": [
    { "type": "delegate_to_intent_blueprint", "normalizedIntent": "..." }
  ],
  "assumptions": [],
  "riskFlags": [],
  "userExplanation": "..."
}
```

---

## 11. Frontend type additions

Update:

```text
YellowStorm/front/src/modules/playbook/types.ts
```

Add frontend equivalents:

```ts
export type CopilotIntentKind =
  | 'answer_question'
  | 'diagnose_workflow'
  | 'generate_workflow'
  | 'add_steps'
  | 'update_steps'
  | 'delete_steps'
  | 'rewire_graph'
  | 'bind_resources'
  | 'bind_connectors'
  | 'configure_hitl'
  | 'optimize_cost'
  | 'optimize_reliability'
  | 'optimize_quality'
  | 'test_workflow'
  | 'run_workflow'
  | 'resume_interruption'
  | 'unknown';

export type CopilotResponseMode =
  | 'answer'
  | 'needs_clarification'
  | 'plan'
  | 'patch_preview'
  | 'diagnostic_report'
  | 'execution_action'
  | 'error';

export interface RequestWorkflowCopilotData {
  message: string;
  selectedTaskId?: string | null;
  origin?: 'designer_panel' | 'intent_bar' | 'canvas' | 'execution_panel' | 'node_editor';
  modeHint?: 'design' | 'diagnostic' | 'step' | 'execution' | 'interrupt' | null;
  applyPolicy?: 'preview_only' | 'auto_apply_safe' | 'force_apply' | null;
  referencedExecutionId?: string | null;
  referencedInterruptId?: string | null;
}

export interface WorkflowDiagnosticReport { ... }
export interface CopilotAction { ... }
export interface WorkflowPatchPreview { ... }
export interface WorkflowCopilotTurnResponse { ... }
```

Also extend existing `PlaybookIntentWorkflowPlanSuggestion` frontend type to include diagnostics if not already aligned with backend:

```ts
diagnostics?: PlaybookIntentDiagnostic[];
validationDiagnostics?: PlaybookIntentDiagnostic[];
repairSummary?: string | null;
```

---

## 12. Frontend API wrapper

Update:

```text
YellowStorm/front/src/modules/playbook/api.ts
```

Add:

```ts
export async function requestWorkflowCopilotTurn(
  playbookId: string,
  data: RequestWorkflowCopilotData,
): Promise<WorkflowCopilotTurnResponse> {
  const response = await apiClient.post<ApiResponse<WorkflowCopilotTurnResponse>>(
    `/playbooks/${playbookId}/copilot/turn`,
    data,
  );
  return response.data.data;
}
```

---

## 13. Frontend store updates

Update:

```text
YellowStorm/front/src/modules/playbook/store.ts
```

Add state:

```ts
workflowCopilotLoading: boolean;
workflowCopilotLastResponse: WorkflowCopilotTurnResponse | null;
workflowCopilotError: string | null;
```

Add actions:

```ts
requestWorkflowCopilotTurn: (playbookId: string, data: RequestWorkflowCopilotData) => Promise<WorkflowCopilotTurnResponse>;
clearWorkflowCopilotResponse: () => void;
```

Keep existing design messages. For MVP, when Copilot returns a response, append to design messages using existing design message storage if possible:

- `userQuery = data.message`
- `aiSummary = response.message`
- `status = completed | failed`

This keeps history and revert behavior consistent.

---

## 14. Frontend UX upgrade

### 14.1 Rename conceptually, not necessarily file name

Keep file path:

```text
PlaybookDesignerPanel.tsx
```

But update displayed product language from “Designer Assistant” to “Workflow Copilot” where appropriate.

### 14.2 Add context chips

At the top of the panel show chips:

- Current mode: Design / Diagnose / Execute / HITL.
- Selected step title if any.
- Current workflow readiness if available.
- Current execution state if in run mode.

### 14.3 Add response rendering types

Current panel mostly renders text messages and clarification UI. Add rendering for:

- `answer`
- `diagnostic_report`
- `patch_preview`
- `needs_clarification`
- `execution_action`

### 14.4 Patch preview card

Render:

- Title.
- Summary.
- Nodes added/updated/deleted.
- Edges added/deleted.
- Bindings added/deleted.
- Affected tasks.
- Risk badge.
- Business outcome.
- Actions:
  - Apply patch.
  - Edit request.
  - Ask follow-up.
  - Cancel.

If response contains `suggestion`, call existing `handleApplyIntentSuggestion` when user clicks Apply.

### 14.5 Diagnostic report card

Render:

- Readiness score.
- Readiness status.
- Blockers.
- Warnings.
- Assumptions.
- Risk flags.
- Next actions.

Each diagnostic card should have relevant buttons:

- Open node.
- Fix automatically.
- Bind source.
- Add approval.
- Ignore warning.

### 14.6 Clarification cards

Reuse existing clarification UI logic from `PlaybookDesignerPanel` and `PlaybookIntentBar`.

Support:

- Choice buttons.
- Resource picker.
- Custom answer.

When user answers, send another `/copilot/turn` with:

```text
Previous user request + clarification answer
```

or better:

```ts
{
  message: originalMessage,
  clarificationAnswers: [...]
}
```

The latter can be future work. For MVP, append answers into the message.

---

## 15. Integrating with existing intent flow

Update:

```text
YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts
```

Do not remove current functions.

Add a new hook or extend existing one:

```ts
useWorkflowCopilotFlow(...)
```

Responsibilities:

- Submit copilot turn.
- Handle response mode.
- If `patch_preview`, store response and render preview.
- If user applies patch, call `handleApplyIntentSuggestion(response.suggestion, options)`.
- If `diagnostic_report`, render diagnostic cards.
- If `needs_clarification`, render questions.
- If `execution_action`, delegate to existing execution/HITL handlers.

MVP shortcut:

- Integrate directly inside `PlaybookCanvasPage.tsx` first.
- Refactor into `useWorkflowCopilotFlow` after behavior is stable.

---

## 16. Multiphase implementation roadmap

## Phase 0 — Baseline validation and safety net

### Goal

Ensure current branch behavior is stable before adding the copilot layer.

### Tasks

1. Run existing backend tests related to playbook flow, intent parser, graph builder, and diagnostics.
2. Run existing frontend tests related to `PlaybookIntentBar`, `PlaybookDesignerPanel`, and canvas intent application.
3. Add one missing test if needed to ensure `PlaybookIntentWorkflowPlanSuggestion` can carry diagnostics end-to-end.
4. Verify current realtime construction still works.

### Files likely touched

- No production files unless type mismatch is found.
- Test files only.

### Acceptance criteria

- Existing intent generation still works.
- Existing design clarification still works.
- Existing realtime construction still works.
- Existing HITL interrupt panel still works.

---

## Phase 1 — Shared Copilot contracts

### Goal

Introduce backend/frontend types without changing behavior.

### Backend tasks

1. Create `playbook-workflow-copilot.interface.ts`.
2. Create `request-playbook-workflow-copilot.dto.ts`.
3. Export/import types where needed.
4. Add no-op `PlaybookWorkflowCopilotService` returning a static answer for now.

### Frontend tasks

1. Add matching types in `types.ts`.
2. Add API wrapper `requestWorkflowCopilotTurn`.
3. Add store action/state or temporary local component integration.

### Acceptance criteria

- Backend compiles.
- Frontend compiles.
- No user-visible behavior changes yet.

---

## Phase 2 — Copilot endpoint and read-only Q&A

### Goal

Allow user to ask questions about the workflow and get safe answers.

### Backend tasks

1. Add `POST /playbooks/:id/copilot/turn`.
2. Implement `CopilotContextAssemblerService` minimal version:
   - current playbook summary
   - selected task
   - current graph summary
   - available node titles
3. Implement `CopilotIntentRouterService` minimal version:
   - answer_question
   - diagnose_workflow
   - unknown
4. Implement read-only answer flow using `copilot.answer` prompt.
5. Add prompt seed entries:
   - `copilot.route`
   - `copilot.answer`

### Frontend tasks

1. Wire DesignerPanel submit to call copilot endpoint instead of only existing design intent path, behind a feature flag.
2. Render text answer messages.
3. Persist messages using existing design message mechanism.

### Feature flag

Add one of:

```ts
workflowCopilotEnabled
```

or reuse existing playbook features config.

### Acceptance criteria

The user can ask:

- “What does this workflow do?”
- “What is the selected step responsible for?”
- “Which steps use connectors?”
- “Where are the risky actions?”

and receive grounded answers without modifying the workflow.

---

## Phase 3 — Intent routing for mutating requests

### Goal

Classify mutating requests without applying them yet.

### Backend tasks

1. Expand `copilot.route` prompt.
2. Add deterministic fallback heuristics:
   - contains “add”, “insert”, “create” -> `add_steps`
   - contains “improve”, “optimize” with selected node -> `update_steps`
   - contains “delete”, “remove” -> `delete_steps`
   - contains “connect”, “wire”, “bind” -> `rewire_graph` or `bind_resources`
   - contains “approve”, “human”, “review” -> `configure_hitl`
   - contains “run”, “start” -> `run_workflow`
   - contains “test”, “dry run” -> `test_workflow`
3. Return route result in `CopilotTurnResponse` with `mode: 'plan'` and no patch yet.

### Frontend tasks

1. Render “I understood this as…” plan card.
2. Show risk and target scope.
3. No apply button yet unless a suggestion exists.

### Acceptance criteria

Requests are classified correctly:

- “Add a validation step after enrichment.” -> `add_steps`
- “Improve this step.” -> `update_steps`
- “Add approval before sending email.” -> `configure_hitl`
- “Use Salesforce as the source.” -> `bind_connectors` or `bind_resources`
- “Run the workflow.” -> `run_workflow`

---

## Phase 4 — Patch preview using existing intent builder

### Goal

For workflow edits, return a real patch preview using existing deterministic blueprint builder.

### Backend tasks

1. Implement `CopilotPlannerService` MVP.
2. For most mutating graph requests, delegate to existing `PlaybookFlowIntentService` logic:
   - Build normalized intent.
   - Include selected task.
   - Include current design history.
   - Include explicit instruction: produce a patch against the existing workflow.
3. Implement `CopilotPatchCompilerService` MVP:
   - Call existing intent analysis / blueprint builder internally.
   - Return top `PlaybookIntentSuggestion`.
   - Build `WorkflowPatchPreview` from suggestion impact.
4. Enrich with existing diagnostics.
5. Return `mode: 'patch_preview'`.

### Frontend tasks

1. Render patch preview card.
2. Add Apply button.
3. Apply by calling existing `handleApplyIntentSuggestion(response.suggestion)`.
4. Reuse existing save behavior.

### Acceptance criteria

User can ask from DesignerPanel:

- “Add a step to summarize the extracted data before the report.”
- “Insert a human approval before the email step.”
- “Add an evaluation step at the end.”

The Copilot returns a preview, and applying it mutates the graph correctly.

---

## Phase 5 — Diagnostics and readiness report

### Goal

Make the Copilot explain whether the workflow is actually runnable and what to fix next.

### Backend tasks

1. Implement `CopilotDiagnosticMapperService`.
2. Convert existing diagnostics into `DiagnosticCard[]`.
3. Compute readiness score/status.
4. Generate next actions.
5. Add diagnostic report to:
   - `diagnose_workflow` response
   - `patch_preview` response after building a suggestion
   - generation completion if reused by realtime construction later

### Frontend tasks

1. Render readiness report.
2. Show blockers first.
3. Show warnings second.
4. Show assumptions/risk flags.
5. Add action buttons.

### Acceptance criteria

User can ask:

- “Is this workflow ready to run?”
- “What is missing?”
- “Fix all obvious issues.”
- “Why can’t I run this?”

The Copilot returns a useful report with actionable fixes.

---

## Phase 6 — Deterministic repair actions

### Goal

Let the Copilot fix common graph issues without regenerating the whole workflow.

### Backend tasks

Implement deterministic repairs for:

1. Missing required input when exactly one compatible upstream output exists.
2. Missing human approval before external side effect.
3. Missing output contract on final step.
4. Router missing default label when labels exist.
5. Required document/workspace binding when user selected a resource.
6. Connector/action binding when user explicitly selected connector/action.

Add operation builders:

- `create_data_binding`
- `create_edge`
- `create_node` for human approval
- `update_node` for prompt/description/output ports/HITL config

### Frontend tasks

1. Diagnostic card “Fix automatically” button.
2. If backend returns a suggestion, apply with existing graph application logic.
3. If repair requires resource or connector choice, open existing resource picker or connector UI.

### Acceptance criteria

The Copilot can fix at least:

- unbound required inputs with a single valid source
- missing approval before external action
- incomplete final output format

without full workflow regeneration.

---

## Phase 7 — Step-level copilot

### Goal

Make selected-node improvement excellent.

### Backend tasks

For `update_steps`, support targeted updates:

- improve title/description
- improve prompt/instructions
- add expected result
- add/rename input/output ports
- bind connector/skill
- change model if allowed
- add retry policy
- add HITL policy
- add evaluation config

Return `update_node` changes only when possible.

### Frontend tasks

1. When user selects a node, show context chip in Copilot panel.
2. Add quick prompts:
   - Improve this step
   - Add expected output
   - Add approval
   - Bind connector
   - Make it cheaper
   - Make it more reliable
3. Patch preview should show the selected node as target.

### Acceptance criteria

With a node selected, user can ask:

- “Improve this step.”
- “Make this step use the CRM connector.”
- “Add expected output.”
- “Add retry policy.”

and get a targeted patch, not a full workflow rewrite.

---

## Phase 8 — Execution-aware copilot

### Goal

Let the Copilot reason about running workflows, interruptions, and failures.

### Backend tasks

1. Extend context assembler with execution context:
   - current execution status
   - failed/interrupted task
   - task result summary
   - HITL history
   - interrupt payload
2. Support intent kinds:
   - `resume_interruption`
   - `test_workflow`
   - `run_workflow`
3. For failure analysis, answer:
   - what failed
   - why likely failed
   - whether workflow should be patched
   - suggested permanent improvement
4. For HITL interruption, return compatible actions:
   - reply
   - approve
   - reject
   - remember feedback
   - apply feedback only to this run
   - update workflow permanently

### Frontend tasks

1. In `interrupt` mode, preserve existing HITL UX.
2. Add Copilot recommendations above the reply composer.
3. Add button: “Turn this answer into a workflow rule.”
4. Add button: “Update workflow permanently.”

### Acceptance criteria

During interrupted execution, Copilot can say:

- “The workflow is blocked because this step needs a clarification.”
- “Your answer can apply only to this run, downstream steps, or future runs.”
- “I can convert this into a reusable HITL rule.”

---

## Phase 9 — Dry-run and test workflow support

### Goal

Allow user to validate generated or modified workflow before full run.

### Backend tasks

1. Define dry-run semantics:
   - no external side effects
   - sample records only
   - connectors in read-only mode where possible
   - synthetic input if no real datasource selected
2. Add Copilot action `run_dry_test`.
3. If no dry-run execution API exists, return a guided action plan first.

### Frontend tasks

1. Add “Run dry test” button from Copilot patch preview/readiness report.
2. Show dry-run result summary in Copilot panel.
3. Offer follow-up fixes after dry-run.

### Acceptance criteria

User can ask:

- “Test this workflow on 3 records.”
- “Run a dry test before saving.”
- “Validate this workflow without sending anything externally.”

Copilot either runs safe dry-test or explains what must be configured first.

---

## Phase 10 — Observability, traces, and evaluation

### Goal

Make Copilot behavior debuggable and improvable.

### Backend tasks

1. Add trace entries for:
   - route prompt
   - answer prompt
   - plan prompt
   - generated plan
   - compiled patch
   - diagnostics
2. Extend or reuse existing `PlaybookFlowIntentTraceService`.
3. Add log events:
   - copilot_turn_started
   - copilot_route_resolved
   - copilot_patch_compiled
   - copilot_diagnostics_generated
   - copilot_turn_failed
4. Add latency and token usage if available from provider response.

### Frontend tasks

1. Optional debug drawer for development.
2. Show trace ID in dev mode.
3. Do not expose raw prompts to normal users.

### Acceptance criteria

A developer can inspect why the Copilot chose a route, what plan was produced, and why a patch was or was not applied.

---

## Phase 11 — Rollout and hardening

### Goal

Ship safely.

### Tasks

1. Add feature flag.
2. Enable for internal users first.
3. Add telemetry around:
   - route type distribution
   - patch preview acceptance rate
   - failed patch compilation
   - user clarification rate
   - diagnostics frequency
4. Add fallback to existing `intent-design` / `intent` behavior if copilot fails.
5. Ensure all destructive/risky actions require confirmation.

### Acceptance criteria

- Feature can be disabled without breaking existing builder.
- Existing Intent Bar still works.
- Existing DesignerPanel still works.
- Copilot adds value but is not required for baseline playbook creation.

---

## 17. Detailed PR breakdown for coding agent

### PR 1 — Contracts and no-op endpoint

Files:

- `interfaces/playbook-workflow-copilot.interface.ts`
- `dto/request-playbook-workflow-copilot.dto.ts`
- `services/copilot/playbook-workflow-copilot.service.ts`
- `controllers/playbook-flow.controller.ts`
- module provider registration file if needed
- frontend `types.ts`
- frontend `api.ts`

Deliverable:

- `/copilot/turn` returns static answer.

### PR 2 — Context assembler and read-only Q&A

Files:

- `services/copilot/copilot-context-assembler.service.ts`
- `services/copilot/copilot-intent-router.service.ts`
- `playbook-flow-prompt-seed.ts`
- `PlaybookDesignerPanel.tsx`
- store/api wiring

Deliverable:

- User can ask workflow questions in panel.

### PR 3 — Mutating route + plan preview

Files:

- `copilot-planner.service.ts`
- `copilot-patch-compiler.service.ts`
- `playbook-flow-prompt-seed.ts`
- frontend patch preview components

Deliverable:

- User gets patch preview for add/update workflow requests.

### PR 4 — Apply patch through existing suggestion path

Files:

- `PlaybookCanvasPage.tsx`
- `PlaybookDesignerPanel.tsx`
- `useWorkflowCopilotFlow.ts` if introduced

Deliverable:

- Apply button mutates workflow via existing `handleApplyIntentSuggestion`.

### PR 5 — Diagnostics/readiness cards

Files:

- `copilot-diagnostic-mapper.service.ts`
- `playbook-intent-suggestion-diagnostics.service.ts` if needed
- frontend diagnostic report card component

Deliverable:

- User can ask “Is this ready to run?” and receive actionable report.

### PR 6 — Deterministic repairs

Files:

- `copilot-patch-compiler.service.ts`
- `copilot-action-policy.service.ts`
- tests

Deliverable:

- Fix common issues without full regeneration.

### PR 7 — Step-level copilot polish

Files:

- `PlaybookDesignerPanel.tsx`
- `PlaybookCanvasPage.tsx`
- `copilot-planner.service.ts`

Deliverable:

- Selected-step improvements work reliably.

### PR 8 — Execution-aware copilot

Files:

- `copilot-context-assembler.service.ts`
- `PlaybookDesignerPanel.tsx`
- HITL-related store/API areas

Deliverable:

- Copilot helps during failed/interrupted runs.

---

## 18. Test plan

### Backend unit tests

Add tests for:

1. Intent router classification.
2. Context assembler with selected task.
3. Context assembler with execution context.
4. Diagnostic mapper readiness score.
5. Diagnostic mapper next action generation.
6. Patch compiler delegation to intent builder.
7. Deterministic repair for unbound required input.
8. Action policy confirmation requirements.

Suggested test files:

```text
YellowStorm/back/src/modules/playbook-flow/services/copilot/*.spec.ts
```

### Backend integration tests

Add tests for:

1. `POST /playbooks/:id/copilot/turn` read-only question.
2. `POST /playbooks/:id/copilot/turn` patch preview.
3. `POST /playbooks/:id/copilot/turn` diagnostic report.
4. Permission checks.

### Frontend tests

Add tests for:

1. DesignerPanel renders Copilot answer.
2. DesignerPanel renders patch preview.
3. Apply patch calls provided handler.
4. Diagnostic report renders blockers and next actions.
5. Clarification flow still works.
6. Existing interrupt mode still works.

Suggested files:

```text
YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.test.tsx
YellowStorm/front/src/modules/playbook/utils/useWorkflowCopilotFlow.test.ts
```

### Golden scenario tests

Create fixture workflows and assert expected behavior:

1. Empty workflow + “create a lead qualification workflow”.
2. Existing workflow + “add approval before sending email”.
3. Selected node + “improve this step”.
4. Missing binding + “fix missing inputs”.
5. Router workflow + “add fallback for failed validation”.
6. Interrupted execution + “remember this answer for future runs”.

---

## 19. Acceptance scenarios

### Scenario A — Ask about workflow

User:

```text
What does this workflow do?
```

Expected:

- Copilot answers in natural language.
- No graph mutation.
- No apply button.

### Scenario B — Add step

User:

```text
Add a validation step before the final report.
```

Expected:

- Copilot returns patch preview.
- Preview shows one node to create and relevant edges/bindings.
- User clicks Apply.
- Canvas updates.
- Workflow saves if no blockers.

### Scenario C — Improve selected step

User selects a node and asks:

```text
Improve this step and make the output more structured.
```

Expected:

- Copilot targets selected node.
- Patch preview shows update to selected node only.
- No unrelated graph rewrite.

### Scenario D — Add HITL before external action

User:

```text
Send the report to the customer automatically.
```

Expected:

- Copilot flags external side effect.
- Copilot suggests human approval before send.
- Requires confirmation.

### Scenario E — Diagnose workflow

User:

```text
Is this workflow ready to run?
```

Expected:

- Copilot returns readiness score.
- Shows blockers and warnings.
- Shows next actions.

### Scenario F — Repair workflow

User:

```text
Fix all obvious issues.
```

Expected:

- Copilot auto-fixes deterministic repairable issues.
- Asks focused questions for unresolved choices.
- Does not invent resources or connectors.

### Scenario G — Execution interruption

During HITL interruption, user asks:

```text
Use the available context and continue, but remember this for future runs.
```

Expected:

- Existing HITL resume flow is used.
- Feedback scope and remember flag are respected.
- Optional workflow rule/memory is created only if explicitly requested.

---

## 20. Safety and policy rules

Implement these rules in code, not only prompt text:

1. Never apply destructive operations without confirmation.
2. Never execute external side-effect connector actions from Copilot planning alone.
3. Never invent connector slugs, action keys, skill slugs, workspace IDs, document IDs, or folder IDs.
4. Never save a workflow with unbound required inputs unless explicitly allowed and visibly warned.
5. Never delete nodes without a confirmation dialog.
6. Never auto-run workflow after patching unless user explicitly asks to run.
7. Always recommend HITL before external send/write/destructive actions.
8. Always produce a preview for graph mutation.

---

## 21. UI copy guidelines

Use language that makes the Copilot feel collaborative:

Good:

```text
I can add this step and connect it after Lead Enrichment. It will not change the final report step.
```

Good:

```text
This workflow is almost ready. Two required inputs still need a source before it can run reliably.
```

Bad:

```text
Here is a JSON patch.
```

Bad:

```text
Done.
```

The Copilot should always explain:

- What it understood.
- What it plans to change.
- Why it matters.
- What still needs the user.

---

## 22. Data persistence strategy

MVP:

- Keep using existing design messages for visible chat history.
- Do not introduce durable copilot sessions yet.
- Store only user query, assistant summary, status, and snapshots as current design messages already do.

Future:

- Add `copilot_sessions` / `copilot_turns` collection if richer action history is needed.
- Persist patch previews and applied action IDs.
- Link turns to workflow definition revisions.

---

## 23. Feature flag strategy

Add feature flag:

```ts
workflowCopilotEnabled: boolean
```

Suggested behavior:

- Disabled: current DesignerPanel and Intent Bar behavior remains unchanged.
- Enabled: DesignerPanel submit uses `/copilot/turn` first.
- Fallback: if `/copilot/turn` fails, existing `handleSubmitDesignIntent` path can still run.

---

## 24. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Copilot over-mutates workflow | Always preview; deterministic compiler; validation before apply |
| LLM invents connectors/resources | Catalog-only prompts; backend validation rejects unknown refs |
| Bad patch creates broken graph | Diagnostics + validation + block save when required inputs unbound |
| UX becomes too complex | Reuse DesignerPanel; progressive action cards; hide debug details |
| Duplicate functionality with Intent Bar | Intent Bar remains fast command; DesignerPanel becomes full Copilot |
| Regression in HITL panel | Keep interrupt mode path unchanged; add tests before extending |
| Cost/latency | Route first; read-only answer lightweight; deterministic repair without LLM where possible |

---

## 25. Recommended implementation order for AI coding agent

Start here:

1. Add shared contracts.
2. Add no-op endpoint.
3. Add frontend API wrapper.
4. Wire DesignerPanel behind feature flag.
5. Implement read-only Q&A.
6. Implement route classification.
7. Implement patch preview using existing intent builder.
8. Implement apply button using existing suggestion application logic.
9. Implement diagnostics/readiness report.
10. Implement deterministic repairs.
11. Extend selected-step improvements.
12. Extend execution/HITL awareness.

Do not attempt all phases in one PR.

---

## 26. Definition of done

The feature is MVP-complete when:

- User can open one Copilot panel and ask anything workflow-related.
- Copilot can answer read-only workflow questions.
- Copilot can generate patch previews for graph edits.
- User can apply a patch from the Copilot panel.
- Copilot can diagnose readiness and missing configuration.
- Copilot can propose next best actions.
- Copilot can improve a selected step without rewriting the whole workflow.
- Copilot respects HITL/risk rules for external/destructive actions.
- Existing Intent Bar, realtime construction, design clarification, canvas apply logic, and HITL interrupt flow still work.

---

## 27. Final product target

The final experience should feel like this:

```text
User: Improve this workflow and make it safer before customer emails are sent.

Copilot: I found one external side effect: the customer email step. I recommend adding a human approval before it, and adding a validation step to check the report before approval.

I will:
1. Add “Validate report quality”.
2. Add “Manager approval before customer email”.
3. Connect validation -> approval -> email.
4. Keep the existing report generation step unchanged.

Risk: medium, because this affects an external communication path.

[Apply patch] [Edit plan] [Open email step] [Cancel]
```

That is the target: not a generator, but a real workflow copilot.
