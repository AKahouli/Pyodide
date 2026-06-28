# YellowStorm Playbook Intent v2 — Remaining Gaps Resolution Plan

**Date:** 2026-06-28  
**Branch:** `aga-worky-003`  
**Scope:** Resolve the remaining reliability gaps after the Blueprint IR v2 / router implementation.

---

## 1. Objective

The current branch already implements the main Blueprint IR v2 foundation: `blueprint.version = 2`, `primitive`, `routerConfig`, `kind/routerLabel` links, enriched iterator body steps, backend router compilation, strict binding compatibility, frontend router task support, conditional edges, and diagnostics enrichment.

This plan focuses only on the remaining gaps required to make the feature production-ready:

1. Pass the full node template config into the backend graph builder.
2. Preserve iterator body conditional edge metadata when applying suggestions in the frontend.
3. Convert final validation diagnostics into an explicit apply-readiness policy.
4. Move primitive compile/validation logic into the Primitive Registry.
5. Add a real deterministic repair service with `repairSummary`.
6. Add deterministic requirement gaps for `intent.design_assessment`.
7. Add golden fixtures for Blueprint IR v2 regression tests.

---

## 2. P0 fixes

### 2.1 Backend: pass full template config to the graph builder

**Problem**

`buildIntentAnalysisContext()` sends rich template metadata to the prompt, but the `context.nodeTemplates` array used by `PlaybookIntentGraphBuilderService` does not include every field the builder expects. This can make template fallback fail for router, human approval, retry policy, and model config.

**File**

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts
```

**Change**

In the `nodeTemplates: nodeTemplates.items.map(...)` object returned from `buildIntentAnalysisContext()`, include:

```ts
selectedAction: template.selectedAction,
requiredToolNames: template.requiredToolNames,
routerConfig: template.routerConfig,
humanApprovalConfig: template.humanApprovalConfig,
retryPolicy: template.retryPolicy,
modelId: template.modelId,
```

**Acceptance criteria**

```text
- Router template fallback works when the LLM selects a router template but omits primitive.router.
- Human approval template config is preserved in generated task drafts.
- retryPolicy and modelId from templates are preserved in generated task drafts.
```

### 2.2 Backend: update builder template typing

**File**

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-builder.service.ts
```

**Change**

Extend `BuilderNodeTemplate`:

```ts
interface BuilderNodeTemplate {
  key: string;
  nodeType: string;
  enabled: boolean;
  recommendedAgentTypeSlug: string | null;
  selectedAction?: string | null;
  requiredToolNames?: string[];
  iteratorConfig?: unknown;
  routerConfig?: PlaybookIntentTaskDraft['routerConfig'];
  humanApprovalConfig?: PlaybookIntentTaskDraft['humanApprovalConfig'];
  retryPolicy?: PlaybookIntentTaskDraft['retryPolicy'];
  modelId?: string | null;
  inputPorts?: BuilderNodeTemplatePort[];
  outputPorts?: BuilderNodeTemplatePort[];
}
```

**Acceptance criteria**

```text
- No hidden casts are needed for known template runtime config.
- Unit tests can build typed router/human approval template fixtures.
```

### 2.3 Frontend: preserve iterator body conditional edge metadata

**Problem**

The backend emits iterator body edges with `edgeKind`, `routerLabel`, and `priority`, but the frontend currently applies iterator body edges through `appendIntentEdge()` without passing those fields. A router inside an iterator can therefore degrade into a normal edge.

**File**

```text
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx
```

**Change**

In the iterator body edge loop, replace the basic `appendIntentEdge(...)` call with:

```ts
appendIntentEdge(
  sourceId,
  targetId,
  resolvedPorts.sourceOutputPortId,
  resolvedPorts.targetInputPortId,
  {
    kind: edge.edgeKind,
    routerLabel: edge.routerLabel,
    priority: edge.priority,
    autoBind: edge.edgeKind !== 'conditional' && !edge.routerLabel,
  },
);
```

**Acceptance criteria**

```text
- Iterator body conditional edges render as conditional edges.
- `routerLabel` is preserved in edge data.
- Conditional iterator child edges do not auto-create data bindings.
```

### 2.4 P0 tests

Backend tests:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.spec.ts
- context.nodeTemplates includes routerConfig, humanApprovalConfig, retryPolicy, modelId.

YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-builder.service.spec.ts
- builder falls back to template.routerConfig.
- builder applies template.humanApprovalConfig.
- builder applies template.retryPolicy and modelId.
```

Frontend tests:

```text
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.test.tsx
- applying iteratorBody edgeKind=conditional creates a conditional edge.
- routerLabel is preserved.
- no data binding is auto-created for conditional iterator edges.
```

---

## 3. P1: validation gating

### 3.1 Goal

Final validation should not only lower confidence. It should classify the suggestion as:

```ts
type IntentSuggestionValidationStatus = 'valid' | 'valid_with_warnings' | 'blocked';
```

### 3.2 Files

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-suggestion-diagnostics.service.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts
YellowStorm/front/src/modules/playbook/types.ts
YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx
```

### 3.3 Behavior

```text
valid:
  no validation diagnostics

valid_with_warnings:
  only non-blocking diagnostics

blocked:
  required input remains unbound
  router condition source does not exist
  router label has no outgoing edge
  conditional edge source is not a router
  iterator body graph is invalid
  data binding endpoint is invalid
```

### 3.4 Suggestion payload extension

```ts
validationStatus?: 'valid' | 'valid_with_warnings' | 'blocked';
blockingReasons?: string[];
```

### 3.5 Frontend behavior

```text
- valid: normal apply.
- valid_with_warnings: allow apply but show diagnostics.
- blocked: show generated plan in review mode but disable one-click apply.
```

---

## 4. P1: Primitive Registry runtime hooks

### 4.1 Goal

The Primitive Registry currently provides prompt specs. It should also own primitive runtime behavior so future node types do not keep adding hard-coded logic to the graph builder.

### 4.2 File

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-primitive-registry.service.ts
```

### 4.3 Add runtime interface

```ts
export interface PlaybookPrimitiveRuntimeSpec {
  kind: string;

  normalizeNode(args: {
    node: PlaybookIntentBlueprintNode;
    template: BuilderNodeTemplate;
  }): PlaybookIntentBlueprintNode;

  validateNode(args: {
    node: PlaybookIntentBlueprintNode;
    template: BuilderNodeTemplate;
  }): PlaybookIntentDiagnostic[];

  compileTaskPatch(args: {
    node: PlaybookIntentBlueprintNode;
    template: BuilderNodeTemplate;
    diagnostics: PlaybookIntentDiagnostic[];
  }): Partial<PlaybookIntentTaskDraft>;

  normalizeOutputPorts?(args: {
    node: PlaybookIntentBlueprintNode;
    template: BuilderNodeTemplate;
    outputPorts?: PlaybookIntentBlueprintPort[];
  }): PlaybookIntentBlueprintPort[] | undefined;
}
```

### 4.4 Router runtime spec

Move these responsibilities from `PlaybookIntentGraphBuilderService` into the router primitive spec:

```text
- Build routerConfig.
- Validate outputLabels.
- Validate defaultLabel.
- Validate condition labels.
- Generate router output ports from outputLabels.
- Validate conditional edge labels.
```

### 4.5 Human approval runtime spec

Responsibilities:

```text
- Apply node.humanApprovalConfig if provided.
- Fallback to template.humanApprovalConfig.
- Validate promptTemplate when required.
```

### 4.6 Acceptance criteria

```text
- Router compile logic is delegated to the registry.
- Human approval config fallback is delegated to the registry.
- Adding a future primitive requires adding a primitive spec rather than editing graph builder core.
```

---

## 5. P1: deterministic repair service

### 5.1 Goal

Add a dedicated deterministic repair pass. Current parser/builder normalization is useful, but `repairSummary` is still effectively empty. The system should repair safe structural issues and explain what changed.

### 5.2 New file

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-repair.service.ts
```

### 5.3 Interface

```ts
export interface BlueprintRepairResult {
  blueprint: PlaybookIntentBlueprint;
  diagnostics: PlaybookIntentDiagnostic[];
  repairSummary: string[];
}

@Injectable()
export class PlaybookIntentBlueprintRepairService {
  repair(args: {
    blueprint: PlaybookIntentBlueprint;
    templates: BuilderNodeTemplate[];
    designCatalog: BuilderDesignCatalog;
    existingContext: IntentWorkflowValidationContext;
  }): BlueprintRepairResult;
}
```

### 5.4 Safe repairs

Implement first:

```text
1. Add missing required template ports.
2. Add router output ports from routerConfig.outputLabels.
3. For conditional edges, set sourceOutputPortId = routerLabel when missing.
4. If router link has routerLabel but no kind, set kind=conditional.
5. Deduplicate router outputLabels.
6. Deduplicate ports by id, preserving required=true.
7. Apply template defaultLabel when missing and compatible.
```

### 5.5 Unsafe repairs to avoid

```text
- Do not invent thresholds.
- Do not invent branch criteria.
- Do not invent datasource ids.
- Do not invent connector slugs or action keys.
- Do not invent branch targets.
- Do not invent human approvers.
```

### 5.6 Integration

Use the service in both paths:

```text
PlaybookFlowIntentService.normalizeConstructionOutput()
PlaybookFlowIntentConstructionService.buildBlueprintSuggestions()
```

Pipeline:

```text
parse -> repair -> build -> diagnostics enrich -> return suggestion
```

### 5.7 Acceptance criteria

```text
- `repairSummary` is populated when safe repairs are applied.
- Missing required ports are repaired.
- Missing router output ports are repaired.
- Conditional router edges are normalized.
- Unsafe repairs become diagnostics, not guessed logic.
```

---

## 6. P2: requirement analyzer for design assessment

### 6.1 Goal

Reduce generic clarification questions and make `intent.design_assessment` driven by deterministic gaps.

### 6.2 New file

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-requirement-analyzer.service.ts
```

### 6.3 Output contract

```ts
export interface IntentRequirementGap {
  id: string;
  category: 'datasource' | 'trigger' | 'input' | 'output' | 'business_rule' | 'approval' | 'scope';
  severity: 'blocking' | 'confirm' | 'optional';
  reason: string;
  suggestedQuestion: string;
  suggestedChoices?: string[];
  resourceSelector?: 'workspace_or_document' | 'destination_workspace';
}
```

### 6.4 Initial rules

```text
Datasource gap:
  If intent requires analysis/extraction/reporting over business data and no resource is selected.

Output gap:
  If final output format is ambiguous.

Trigger gap:
  If intent implies schedule, email trigger, or document arrival but trigger details are missing.

Router business rule gap:
  If intent implies branching but branch criteria are missing.

Approval gap:
  If intent implies external send, write-back, sensitive output, or approval gate.

Connector gap:
  If intent requires an unavailable connector/action.
```

### 6.5 Prompt integration

Add prompt variable:

```ts
requirement_gaps: JSON.stringify(requirementAnalyzer.analyze(...), null, 2)
```

Add to `intent.design_assessment` user template:

```text
<Deterministic_Requirement_Gaps_JSON>
{requirement_gaps}
</Deterministic_Requirement_Gaps_JSON>
```

Update system prompt:

```text
Ask clarification primarily for deterministic requirement gaps. Do not ask generic mandatory questions when the deterministic gap list is empty and the intent is complete.
```

### 6.6 Acceptance criteria

```text
- Complete low-risk intents can return ready_to_generate without forced datasource/output questions.
- Missing datasource triggers datasource question.
- Missing branch criteria triggers business_rule question.
- External action risk triggers approval question.
```

---

## 7. P2: conversion node insertion

### 7.1 Goal

When artifact kinds differ but a safe conversion is obvious, insert a conversion/synthesis node instead of dropping the data path.

### 7.2 Initial safe conversions

```text
data -> text
text -> data
document -> text
image -> text
```

### 7.3 Implementation location

Implement in:

```text
PlaybookIntentBlueprintRepairService
```

not in the binding resolver.

### 7.4 Converter selection order

```text
1. Template key matching conversion.* or *.conversion.*
2. Template category containing conversion, transformation, extraction, or synthesis
3. generic.agent_step fallback
```

### 7.5 Safety rules

Insert a converter only when:

```text
- source and target refs exist;
- source and target ports exist;
- mismatch is between one known source-target pair;
- direction is in the safe conversion list;
- no external side effect is introduced.
```

### 7.6 Acceptance criteria

```text
- data->text paths create a report-context converter node.
- document->text paths create an extraction converter node.
- unsupported conversions remain diagnostics.
```

---

## 8. Golden fixtures and regression harness

### 8.1 Backend fixture folder

```text
YellowStorm/back/src/modules/playbook-flow/test-fixtures/intent-blueprint-v2/
```

### 8.2 Required fixtures

```text
01-linear-agent-workflow.json
02-datasource-constant-binding.json
03-router-basic-policy-decision.json
04-router-template-config-fallback.json
05-router-inside-iterator.json
06-human-approval-before-external-action.json
07-action-connector-binding.json
08-required-template-port-repair.json
09-artifact-conversion-data-to-text.json
10-invalid-router-blocked.json
11-iterator-conditional-edge-frontend.json
```

### 8.3 Backend harness

Create:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-v2.fixtures.spec.ts
```

Pipeline:

```text
fixture inputBlueprint
  -> parser
  -> repair service
  -> graph builder
  -> binding resolver
  -> suggestion diagnostics
  -> assert expected shape
```

### 8.4 Frontend fixture coverage

Add frontend tests for:

```text
- router edge apply;
- iterator router edge apply;
- no auto-bind for conditional edges;
- routerConfig persistence;
- blocked suggestion UI state.
```

---

## 9. Optional refactor: shared compiler service

The immediate and streaming paths duplicate parse/build/enrich logic:

```text
PlaybookFlowIntentService.normalizeConstructionOutput()
PlaybookFlowIntentConstructionService.buildBlueprintSuggestions()
```

Create:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-compiler.service.ts
```

Interface:

```ts
compile(args: {
  raw: string;
  context: PlaybookIntentAnalysisContext;
}): PlaybookIntentSuggestion[];
```

Internal pipeline:

```text
parse -> repair -> build -> enrich diagnostics -> return suggestions
```

Acceptance criteria:

```text
- immediate generation and streamed construction produce equivalent suggestions for the same raw blueprint.
- parse/build/repair logic exists in only one service.
```

---

## 10. Definition of done

This remaining-gaps work is complete when:

```text
- Graph builder receives full node template config.
- Router template fallback works without LLM-emitted primitive.router.
- Iterator body conditional edges preserve edgeKind/routerLabel/priority in frontend apply.
- Conditional iterator edges do not create accidental data bindings.
- Validation status is valid / valid_with_warnings / blocked.
- Blocked suggestions are not one-click apply-ready.
- Primitive Registry owns at least router and human approval compile logic.
- Deterministic repair service populates repairSummary.
- Required ports and router output ports are repaired by a dedicated service.
- Safe conversion nodes are inserted for data->text and document->text cases.
- Requirement analyzer feeds deterministic gaps into design assessment.
- Golden fixtures cover linear, router, router template fallback, router inside iterator, human approval, conversion, and invalid-router cases.
```

---

## 11. Recommended immediate next action

Start with a small P0 PR:

```text
1. Add missing template config fields to context.nodeTemplates.
2. Preserve iterator body edgeKind/routerLabel/priority in frontend apply.
3. Add targeted backend and frontend tests.
```

This will stabilize the current implementation before introducing the larger repair and primitive-registry refactors.
