# YellowStorm Playbook Intent Blueprint v2 Implementation Plan

**Date:** 2026-06-28  
**Target branch:** `aga-worky-003`  
**Scope:** Playbook AI-assisted workflow autogeneration, intent blueprint generation, deterministic compilation, primitive node support.  
**Status:** Proposed implementation plan.

---

## 1. Executive summary

The current Playbook intent generation architecture is already going in the right direction:

```text
User intent
  -> intent.design_assessment
  -> intent.analyze
  -> compact blueprint JSON
  -> blueprint parser
  -> deterministic graph builder
  -> binding resolver
  -> workflow_plan suggestion
  -> frontend apply
```

This is the right foundation because the LLM does not directly generate the final runtime graph. Instead, the LLM produces a compact semantic blueprint, and the backend expands it deterministically.

However, the current blueprint contract is still too narrow for several workflow primitives. It works reasonably well for linear agent/action/iterator cases, but it is not expressive enough for robust router generation, human approval semantics, future primitive node types, deterministic repair, and end-to-end validation.

The goal of this plan is to introduce a **Blueprint IR v2** and a **Primitive Registry** so that AI-assisted workflow generation becomes:

- more deterministic;
- more robust against malformed LLM output;
- more extensible for future node types;
- more accurate for business logic such as routing conditions;
- easier to test with golden fixtures;
- safer for users who expect minimum manual adaptation after AI generation.

The recommended approach is **not** to remove the LLM from workflow design. The LLM should still infer the business intent, topology, task decomposition, template choice, and branch logic. But the backend must own the contract, validation, normalization, repair, and compilation.

---

## 2. Current implementation snapshot

### 2.1 Core files already involved

Backend:

```text
YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-intent-blueprint.interface.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-parser.service.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-builder.service.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-binding-resolver.service.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-node-template.service.ts
YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-node-template.interface.ts
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-node-template.schema.ts
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-validator.service.ts
```

Frontend:

```text
YellowStorm/front/src/modules/playbook/types.ts
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx
YellowStorm/front/src/modules/playbook/hooks/helpers/control-edge-serializer.ts
YellowStorm/front/src/modules/playbook/hooks/helpers/router-template.ts
YellowStorm/front/src/modules/playbook/components/PlaybookRouterConfigSection.tsx
YellowStorm/front/src/modules/playbook/components/RouterNode.tsx
```

Prompt keys:

```text
intent.design_assessment
intent.analyze
```

### 2.2 Current strengths

The current system already has several strong design choices:

1. **Compact blueprint contract**  
   The LLM returns a compact `blueprint`, not a full runtime workflow.

2. **Backend deterministic builder**  
   `PlaybookIntentGraphBuilderService` expands the blueprint into workflow changes.

3. **Parser normalization**  
   `PlaybookIntentBlueprintParserService` accepts several LLM-friendly field variants, such as `connector_refs` and `connectorRefs`, and normalizes them.

4. **Binding resolver**  
   `PlaybookIntentGraphBindingResolverService` deduplicates edges/bindings and can synthesize a binding from a port-aware edge.

5. **Node templates already contain primitive-level configs**  
   Node templates already include `iteratorConfig`, `routerConfig`, `humanApprovalConfig`, `retryPolicy`, `modelId`, `selectedAction`, etc.

6. **Runtime validator already contains important graph rules**  
   `PlaybookFlowValidatorService` already validates router condition configuration, router label coverage, cycle rules, iterator body DAG rules, required data bindings, binding type matches, and more.

### 2.3 Main gaps

The current implementation has a few important gaps:

#### Gap A — Router primitive is not represented in the blueprint

The prompt says the LLM should use a router for conditional logic, but the blueprint does not expose a `routerConfig` or a primitive-specific config section.

As a result, the LLM can choose a router node template, but it cannot formally define:

- output labels;
- branch labels;
- deterministic conditions;
- condition source node/port/path/operator/value;
- default label;
- max iterations;
- branch coverage.

This makes router generation under-specified and less deterministic.

#### Gap B — Links cannot explicitly represent conditional control flow

`PlaybookIntentBlueprintLink` currently has source/target refs and optional port ids, but does not include:

```ts
kind?: 'sequential' | 'conditional';
routerLabel?: string | null;
priority?: number | null;
```

The frontend can infer conditional edges when the source node is a router, but the intent blueprint should explicitly carry routing semantics.

#### Gap C — Required template ports are not strictly preserved

`mergePorts()` currently returns blueprint ports as-is when present, and may omit required template ports. The prompt says required ports must be respected, but the builder does not guarantee this.

#### Gap D — Artifact kind compatibility is inconsistent

The prompt asks for strict artifact transitions and conversion/synthesis nodes when kinds differ. The backend resolver currently treats `text`, `data`, `code`, and `document` as compatible, while the frontend binding application rejects mismatched artifact kinds strictly.

This can cause a backend-valid suggestion to be partially dropped by the frontend.

#### Gap E — Iterator body children are not feature-complete

`PlaybookIntentBlueprintIteratorStep` supports ports and `nodeTemplateKey`, but does not support:

- `agentHint`;
- `connectorRefs`;
- `skillRefs`;
- primitive-specific config;
- router config inside iterator body;
- human approval config inside iterator body.

This limits workflows like:

```text
For each invoice:
  extract data
  route by amount/risk
  call ERP action
  require approval if high risk
```

#### Gap F — Invalid blueprint output is mostly dropped, not repaired

If parsing/building fails, the current flow returns no suggestions. That protects runtime safety, but creates a poor user experience when a deterministic repair could have fixed the issue.

#### Gap G — Prompt logic is hard-coded, not generated from primitive specs

The prompt currently contains hand-written rules for node templates, ports, bindings, and iterator usage. It has a very small rule for routers. As more node types are added, this prompt will become harder to maintain.

#### Gap H — Confidence is fixed

The graph builder returns a fixed `confidence: 0.85`. Confidence should be computed from validation quality, unresolved assumptions, repair count, unknown references, and dropped elements.

---

## 3. Target architecture

### 3.1 Target pipeline

The target pipeline should become:

```text
User intent
  -> deterministic requirement precheck
  -> intent.design_assessment LLM wording layer
  -> intent.analyze LLM Blueprint IR v2 generation
  -> Blueprint IR v2 parser
  -> schema validation
  -> deterministic normalization
  -> deterministic repair pass
  -> primitive-aware compiler
  -> binding resolver
  -> final workflow validation dry-run
  -> quality score + diagnostics
  -> workflow_plan suggestion
  -> frontend pure application
```

### 3.2 Responsibilities

#### LLM responsibilities

The LLM should be responsible for:

- understanding business intent;
- decomposing the workflow into coherent steps;
- choosing appropriate `nodeTemplateKey` values;
- selecting relevant agents/connectors/skills from the provided catalog;
- defining business routing logic when needed;
- producing a compact Blueprint IR v2;
- surfacing assumptions and risk flags.

#### Backend responsibilities

The backend should be responsible for:

- parsing and normalizing the LLM output;
- validating against a strict schema;
- repairing safe structural errors;
- preserving required template contracts;
- compiling primitive configs into runtime graph changes;
- enforcing router/iterator/human approval topology rules;
- adding conversion nodes when artifact transitions require them;
- computing quality score and diagnostics;
- rejecting unsafe or semantically ambiguous repairs.

#### Frontend responsibilities

The frontend should be responsible for:

- rendering suggestions;
- applying deterministic workflow changes;
- displaying warnings and diagnostics;
- preserving runtime graph semantics;
- not inventing hidden business logic that was not present in the backend suggestion.

---

## 4. Blueprint IR v2 contract

### 4.1 Versioned blueprint root

Add a version field while keeping backward compatibility with the current blueprint shape.

```ts
export interface PlaybookIntentBlueprintV2 {
  version: 2;
  title: string;
  summary: string;
  nodes: PlaybookIntentBlueprintNodeV2[];
  links: PlaybookIntentBlueprintLinkV2[];
  bindings?: PlaybookIntentBlueprintBindingV2[];
  assumptions?: string[];
  riskFlags?: string[];
  diagnosticsHints?: string[];
}
```

Backward compatibility rule:

```text
If version is missing, parse as v1 and normalize to v2 internally.
```

### 4.2 Primitive-aware node shape

Add primitive-specific config while preserving existing fields.

```ts
export type PlaybookIntentPrimitiveKind =
  | 'agent'
  | 'action'
  | 'evaluation'
  | 'iterator'
  | 'router'
  | 'human_approval'
  | string;

export interface PlaybookIntentBlueprintNodeV2 {
  ref: string;
  label: string;
  purpose: string;
  nodeTemplateKey: string;
  agentHint?: string | null;

  primitive?: PlaybookIntentBlueprintPrimitiveConfig;

  inputPorts?: PlaybookIntentBlueprintPort[];
  outputPorts?: PlaybookIntentBlueprintPort[];

  connectorRefs?: PlaybookIntentBlueprintConnectorRef[];
  skillRefs?: PlaybookIntentBlueprintSkillRef[];

  iteratorBody?: PlaybookIntentBlueprintIteratorBodyV2;

  anchor?: {
    mode?: 'append' | 'before' | 'after' | 'as_input';
    targetTaskId?: string | null;
    targetRef?: string | null;
  };
}
```

### 4.3 Primitive config union

```ts
export interface PlaybookIntentBlueprintPrimitiveConfig {
  kind: PlaybookIntentPrimitiveKind;
  router?: PlaybookIntentBlueprintRouterConfig;
  iterator?: PlaybookIntentBlueprintIteratorConfig;
  humanApproval?: PlaybookIntentBlueprintHumanApprovalConfig;
  evaluation?: PlaybookIntentBlueprintEvaluationConfig;
  action?: PlaybookIntentBlueprintActionConfig;
  metadata?: Record<string, unknown>;
}
```

### 4.4 Router config

```ts
export interface PlaybookIntentBlueprintRouterConfig {
  outputLabels: string[];
  defaultLabel: string;
  maxIterations?: number | null;
  conditions: Array<{
    label: string;
    sourceRef: string;
    sourceIteratorRef?: string | null;
    sourcePort: string;
    path?: string | null;
    operator: 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
    value?: unknown;
  }>;
}
```

Normalization rules:

```text
- outputLabels must be unique.
- defaultLabel must be one of outputLabels.
- each condition.label must be one of outputLabels.
- condition source must refer to a node or iterator child that executes before the router.
- each outputLabel must have at least one outgoing conditional link or be intentionally terminal.
- maxIterations defaults to template.routerConfig.maxIterations or 1.
- if conditions exist, defaultLabel is mandatory.
```

### 4.5 Router links

Extend links to carry routing semantics:

```ts
export interface PlaybookIntentBlueprintLinkV2 {
  sourceRef: string;
  targetRef: string;
  sourceIteratorRef?: string | null;
  targetIteratorRef?: string | null;
  kind?: 'sequential' | 'conditional';
  routerLabel?: string | null;
  sourceOutputPortId?: string | null;
  targetInputPortId?: string | null;
  priority?: number | null;
}
```

Compilation rules:

```text
- If source node primitive.kind === router, default link kind is conditional.
- For conditional links, routerLabel is required.
- routerLabel must exist in source.routerConfig.outputLabels.
- sourceOutputPortId defaults to routerLabel when absent.
- Non-router nodes cannot produce conditional links.
```

### 4.6 Iterator body v2

Iterator steps should support the same semantic node capabilities as top-level nodes, except layout/anchor.

```ts
export interface PlaybookIntentBlueprintIteratorStepV2 {
  ref: string;
  title: string;
  description?: string;
  nodeTemplateKey: string;
  agentHint?: string | null;
  primitive?: PlaybookIntentBlueprintPrimitiveConfig;
  inputPorts?: PlaybookIntentBlueprintPort[];
  outputPorts?: PlaybookIntentBlueprintPort[];
  connectorRefs?: PlaybookIntentBlueprintConnectorRef[];
  skillRefs?: PlaybookIntentBlueprintSkillRef[];
}
```

Iterator body links should also support conditional routing:

```ts
export interface PlaybookIntentBlueprintIteratorBodyV2 {
  steps: PlaybookIntentBlueprintIteratorStepV2[];
  edges: Array<{
    sourceRef: string;
    targetRef: string;
    kind?: 'sequential' | 'conditional';
    routerLabel?: string | null;
    sourceOutputPortId?: string | null;
    targetInputPortId?: string | null;
  }>;
}
```

### 4.7 Human approval config

```ts
export interface PlaybookIntentBlueprintHumanApprovalConfig {
  promptTemplate: string;
  timeoutSeconds?: number | null;
  approvalMode?: 'approve_reject' | 'review_only' | 'clarification';
  requiredBeforeExternalSideEffect?: boolean;
}
```

### 4.8 Action config

```ts
export interface PlaybookIntentBlueprintActionConfig {
  connectorSlug?: string;
  actionKey?: string;
  fixedParams?: Record<string, unknown>;
  sideEffectLevel?: 'none' | 'workspace_write' | 'external_send' | 'destructive';
}
```

This is optional at first because connector refs already exist. It becomes useful for stricter action semantics.

---

## 5. Primitive Registry

### 5.1 Goal

Introduce a backend `Primitive Registry` that is the single source of truth for node primitive behavior.

This prevents the prompt from becoming a giant hard-coded document and makes future node types easier to add.

### 5.2 Proposed file

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-primitive-registry.service.ts
```

### 5.3 Core interface

```ts
export interface PlaybookPrimitiveSpec {
  kind: string;
  title: string;
  description: string;

  selectionRules: string[];
  topologyRules: string[];
  configSchemaHint: Record<string, unknown>;
  promptInstructions: string;

  normalizeConfig(args: {
    node: PlaybookIntentBlueprintNodeV2;
    template: FlowNodeTemplateResponse;
  }): PlaybookIntentBlueprintNodeV2;

  validateConfig(args: {
    node: PlaybookIntentBlueprintNodeV2;
    graph: PlaybookIntentBlueprintV2;
  }): PlaybookIntentDiagnostic[];

  compileConfig(args: {
    node: PlaybookIntentBlueprintNodeV2;
    template: FlowNodeTemplateResponse;
  }): Partial<PlaybookIntentTaskDraft>;
}
```

### 5.4 Built-in primitive specs

Initial specs:

```text
agent
 action
evaluation
iterator
router
human_approval
```

### 5.5 Router primitive spec

Router selection rules:

```text
Use router when the workflow must choose one or more downstream paths based on structured data, a prior assessment, a score, a boolean decision, a status, or a business rule.
Do not use router for simple sequential dependencies.
Do not use router when the branch is only a natural-language explanation and no graph branching is required.
```

Router topology rules:

```text
- Router must define outputLabels.
- Router must define defaultLabel when deterministic conditions exist.
- Every deterministic condition must reference a previous node output.
- Every condition label must be declared in outputLabels.
- Every declared non-reserved output label should have at least one conditional downstream link.
- If router is inside iterator, all branch targets must usually be inside the same iterator.
- A router in a cycle must have maxIterations > 0 and at least one terminal exit route.
```

Router prompt instructions:

```text
When choosing a router template, always include primitive.kind="router" and primitive.router.
Define outputLabels as stable snake_case labels.
Define defaultLabel.
Define deterministic conditions whenever a prior structured output can drive the branch.
For each branch, add a conditional link with routerLabel equal to one output label.
```

---

## 6. Prompt architecture changes

### 6.1 Current issue

The `intent.analyze` prompt currently carries general rules and a short router mention. This should be replaced by prompt sections generated from the template catalog and primitive registry.

### 6.2 New prompt variables

Add these variables to `buildIntentAnalysisContext()`:

```ts
primitive_catalog: JSON.stringify(primitiveRegistry.getPromptCatalog(), null, 2)
blueprint_schema_version: '2'
blueprint_schema_hint: JSON.stringify(buildBlueprintSchemaHint(), null, 2)
```

### 6.3 Enriched node template catalog

The current node template catalog sent to the LLM should include primitive configuration hints.

Add fields:

```ts
node_templates: nodeTemplates.items.map((template) => ({
  key: template.key,
  title: template.title,
  description: template.description || '',
  category: template.category,
  semanticNodeType: template.nodeType,
  primitiveKind: template.nodeType,
  isDefault: template.key === DEFAULT_GENERIC_NODE_TEMPLATE_KEY,
  inputPorts: ...,
  outputPorts: ...,
  recommendedAgentTypeSlug: template.recommendedAgentTypeSlug,
  selectedAction: template.selectedAction,
  requiredToolNames: template.requiredToolNames,
  iteratorConfig: template.iteratorConfig,
  routerConfig: template.routerConfig,
  humanApprovalConfig: template.humanApprovalConfig,
  retryPolicy: template.retryPolicy,
  modelId: template.modelId,
}))
```

### 6.4 New `intent.analyze` contract section

Replace the current blueprint shape with v2:

```text
Return JSON only.
Top-level shape:
{
  "blueprint": {
    "version": 2,
    "title": "...",
    "summary": "...",
    "nodes": [...],
    "links": [...],
    "bindings": [...]
  },
  "assumptions": [],
  "riskFlags": []
}
```

### 6.5 Router prompt excerpt

Add this generated section from the primitive registry:

```text
# Router Primitive Rules
Use a router when workflow execution must branch based on prior structured outputs or business rules.
A router node MUST include:
- primitive.kind = "router"
- primitive.router.outputLabels
- primitive.router.defaultLabel
- primitive.router.conditions when deterministic branching criteria are known

Each router condition MUST reference a previous node output:
- sourceRef
- sourcePort
- optional path
- operator
- value when required by operator

Each router branch MUST have a conditional link:
{
  "sourceRef": "router_ref",
  "targetRef": "downstream_ref",
  "kind": "conditional",
  "routerLabel": "declared_output_label"
}

If the router is inside an iterator, all related branch targets should be inside the same iterator unless the branch intentionally exits after aggregation.
```

### 6.6 Design assessment prompt change

`intent.design_assessment` should not always force broad clarification. Instead, deterministic precheck should identify missing requirements, then the prompt should convert them into concise user-facing questions.

New flow:

```text
RequirementAnalyzerService.detectMissingRequirements(intent, catalog, selectedNodeContext)
  -> missing requirements list
  -> intent.design_assessment asks questions only for these missing requirements
```

---

## 7. Backend implementation plan

## Phase 0 — Feature flag and compatibility mode

### 0.1 Add design setting

Add an optional design setting:

```ts
intentBlueprintVersion?: 1 | 2;
intentPrimitiveRegistryEnabled?: boolean;
intentRepairEnabled?: boolean;
```

Default recommendation:

```text
intentBlueprintVersion = 2
intentPrimitiveRegistryEnabled = true
intentRepairEnabled = true
```

During rollout, allow fallback to v1.

### 0.2 Keep parser backward compatible

Existing v1 blueprints must continue to work.

Rule:

```text
v1 parse -> v1 normalize -> internal v2 graph -> builder
v2 parse -> internal v2 graph -> builder
```

---

## Phase 1 — Extend backend interfaces

### 1.1 Modify blueprint interface

File:

```text
YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-intent-blueprint.interface.ts
```

Add:

```ts
export type PlaybookIntentBlueprintVersion = 1 | 2;
export type PlaybookIntentBlueprintEdgeKind = 'sequential' | 'conditional';
export type PlaybookIntentPrimitiveKind =
  | 'agent'
  | 'action'
  | 'evaluation'
  | 'iterator'
  | 'router'
  | 'human_approval'
  | string;
```

Add config types:

```ts
export interface PlaybookIntentBlueprintRouterCondition {
  label: string;
  sourceRef: string;
  sourceIteratorRef?: string | null;
  sourcePort: string;
  path?: string | null;
  operator: 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
  value?: unknown;
}

export interface PlaybookIntentBlueprintRouterConfig {
  outputLabels: string[];
  maxIterations?: number | null;
  conditions?: PlaybookIntentBlueprintRouterCondition[];
  defaultLabel?: string | null;
}

export interface PlaybookIntentBlueprintPrimitiveConfig {
  kind: PlaybookIntentPrimitiveKind;
  router?: PlaybookIntentBlueprintRouterConfig;
  iterator?: Record<string, unknown>;
  humanApproval?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
  action?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

Extend node:

```ts
primitive?: PlaybookIntentBlueprintPrimitiveConfig;
routerConfig?: PlaybookIntentBlueprintRouterConfig; // optional compatibility alias
humanApprovalConfig?: Record<string, unknown>;
```

Extend link:

```ts
kind?: PlaybookIntentBlueprintEdgeKind;
routerLabel?: string | null;
priority?: number | null;
```

Extend iterator step:

```ts
agentHint?: string | null;
connectorRefs?: PlaybookIntentBlueprintConnectorRef[];
skillRefs?: PlaybookIntentBlueprintSkillRef[];
primitive?: PlaybookIntentBlueprintPrimitiveConfig;
```

### 1.2 Extend task draft interfaces

Files:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts
YellowStorm/front/src/modules/playbook/types.ts
```

Extend `PlaybookIntentTaskDraft` with:

```ts
routerConfig?: RouterConfig | null;
humanApprovalConfig?: HumanApprovalConfig | null;
retryPolicy?: RetryPolicy | null;
modelId?: string | null;
```

Extend iterator body steps with:

```ts
routerConfig?: RouterConfig | null;
humanApprovalConfig?: HumanApprovalConfig | null;
toolBindings?: ToolBinding[];
skillBindings?: TaskSkillBinding[];
```

---

## Phase 2 — Primitive Registry service

### 2.1 Add service

Create:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-primitive-registry.service.ts
```

Register it in:

```text
YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts
```

### 2.2 Implement specs

Initial specs:

```ts
const AGENT_PRIMITIVE: PlaybookPrimitiveSpec = { ... };
const ACTION_PRIMITIVE: PlaybookPrimitiveSpec = { ... };
const ITERATOR_PRIMITIVE: PlaybookPrimitiveSpec = { ... };
const ROUTER_PRIMITIVE: PlaybookPrimitiveSpec = { ... };
const HUMAN_APPROVAL_PRIMITIVE: PlaybookPrimitiveSpec = { ... };
const EVALUATION_PRIMITIVE: PlaybookPrimitiveSpec = { ... };
```

### 2.3 Prompt catalog output

Expose:

```ts
getPromptCatalog(): Array<{
  kind: string;
  title: string;
  description: string;
  selectionRules: string[];
  topologyRules: string[];
  configSchemaHint: Record<string, unknown>;
  promptInstructions: string;
}>;
```

This output becomes `{primitive_catalog}` in the prompt.

---

## Phase 3 — Prompt updates

### 3.1 Update `playbook-flow-prompt-seed.ts`

File:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts
```

Update `intent.analyze`:

- bump version;
- use Blueprint v2 shape;
- add primitive catalog section;
- add explicit router contract;
- add edge kind/routerLabel rules;
- add conversion node instruction;
- add final checklist for primitive configs.

### 3.2 Prompt invariant checklist

New final checklist:

```text
Before returning JSON, validate:
- JSON only.
- blueprint.version = 2.
- refs are unique.
- nodeTemplateKey exists.
- primitive.kind matches selected template semanticNodeType unless explicitly compatible.
- routers include outputLabels and defaultLabel.
- router conditions reference prior node outputs.
- conditional links have routerLabel.
- routerLabel is declared in outputLabels.
- iterator body refs are scoped correctly.
- required inputs are bound, constant-bound, or risk-flagged.
- no duplicate binding target.
- artifact kinds match, or a conversion/synthesis node exists.
```

---

## Phase 4 — Parser v2

### 4.1 Extend parser

File:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-parser.service.ts
```

Add parsing for:

```text
blueprint.version
node.primitive
node.routerConfig / primitive.router
node.humanApprovalConfig / primitive.humanApproval
link.kind
link.routerLabel
link.priority
iterator step agentHint
iterator step connectorRefs
iterator step skillRefs
iterator step primitive
iterator body edge kind/routerLabel
```

### 4.2 Compatibility aliases

Accept both camelCase and snake_case:

```text
router_config -> routerConfig
router_label -> routerLabel
source_iterator_ref -> sourceIteratorRef
condition.source_node -> condition.sourceNode/sourceRef
condition.source_port -> condition.sourcePort
```

### 4.3 Parser diagnostics

Add diagnostic codes:

```text
blueprint_v2_invalid_version
blueprint_primitive_invalid
blueprint_router_config_invalid
blueprint_router_condition_invalid
blueprint_link_conditional_missing_label
blueprint_iterator_step_primitive_invalid
```

### 4.4 Do not silently drop critical router config

Current parser mostly drops invalid items. For router config, preserve a diagnostic and let the repair pass try to fix it before dropping the whole primitive.

---

## Phase 5 — Deterministic normalization and repair

### 5.1 Add normalizer service

Create:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-normalizer.service.ts
```

Responsibilities:

- normalize v1 to v2;
- infer `primitive.kind` from node template semantic type;
- preserve required template ports;
- normalize router output ports from outputLabels;
- normalize conditional links;
- normalize iterator body scoping;
- sanitize refs and labels.

### 5.2 Add repair service

Create:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-repair.service.ts
```

Safe deterministic repairs:

```text
- Add missing required template ports.
- Add router output ports from routerConfig.outputLabels.
- Set router link sourceOutputPortId = routerLabel when absent.
- Set conditional link kind when source primitive is router.
- Add defaultLabel when exactly one fallback label exists and no condition targets it.
- Remove duplicate outputLabels.
- Remove duplicate bindings to same target, keeping explicit binding over inferred binding.
- Insert conversion/synthesis node for clear artifact kind transitions.
- Topologically sort create_node changes based on links/bindings.
```

Unsafe repairs to avoid:

```text
- Inventing business conditions.
- Inventing document/workspace ids.
- Inventing connector slugs/action keys.
- Guessing branch labels when no labels are provided.
- Guessing approval policy for external side effects without user clarification.
```

### 5.3 Optional LLM repair stage

Add a second-pass prompt only if deterministic repair fails:

```text
intent.repair_blueprint
```

Input:

```json
{
  "originalBlueprint": {},
  "diagnostics": [],
  "allowedTemplates": [],
  "primitiveCatalog": [],
  "repairRules": []
}
```

Output:

```json
{
  "blueprint": { "version": 2, ... },
  "repairSummary": [],
  "remainingRisks": []
}
```

This should be limited to one retry.

---

## Phase 6 — Primitive-aware graph builder

### 6.1 Extend builder options

File:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-builder.service.ts
```

Inject primitive registry:

```ts
constructor(
  private readonly resolver: PlaybookIntentGraphBindingResolverService,
  private readonly primitiveRegistry: PlaybookFlowPrimitiveRegistryService,
) {}
```

For tests, provide a default registry instance.

### 6.2 Build node task with primitive config

In `buildCreateNodeChange()`:

```ts
const primitive = this.primitiveRegistry.resolve(node.primitive?.kind || template.nodeType);
const primitiveTaskPatch = primitive.compileConfig({ node, template });

const task: PlaybookIntentTaskDraft = {
  title: node.label,
  description: node.purpose || node.label,
  ...primitiveTaskPatch,
  nodeTemplateKey: template.key,
  ...
};
```

For router:

```ts
task.routerConfig = {
  outputLabels,
  maxIterations,
  conditions: normalizedConditions.map(...),
  defaultLabel,
};
```

### 6.3 Compile conditional links

In `buildCreateEdgeChange()`:

```ts
if (link.kind === 'conditional') {
  return {
    type: 'create_edge',
    edgeKind: 'conditional',
    routerLabel: link.routerLabel,
    sourceOutputPortId: link.sourceOutputPortId || link.routerLabel,
    ...
  };
}
```

This requires extending `PlaybookIntentWorkflowChange` for create_edge:

```ts
edgeKind?: 'sequential' | 'conditional';
routerLabel?: string | null;
priority?: number | null;
```

### 6.4 Preserve required template ports

Replace current `mergePorts()` behavior with:

```text
1. Start from all required template ports.
2. Add referenced template ports.
3. Overlay blueprint ports by id.
4. Add blueprint-only ports.
5. Validate duplicate ids and artifact kinds.
6. Never downgrade required=true from template unless explicitly allowed by primitive spec.
```

Pseudo-code:

```ts
private mergePorts(...) {
  const result = new Map<string, BuilderPort>();

  for (const templatePort of templatePorts || []) {
    if (templatePort.required || referencedTemplatePorts?.has(templatePort.id)) {
      result.set(templatePort.id, normalizeTemplatePort(templatePort));
    }
  }

  for (const blueprintPort of blueprintPorts || []) {
    const existing = result.get(blueprintPort.id);
    result.set(blueprintPort.id, {
      ...existing,
      ...blueprintPort,
      required: existing?.required === true || blueprintPort.required === true,
    });
  }

  return [...result.values()];
}
```

### 6.5 Support iterator child primitive configs

Update `buildIteratorStep()` to include:

```ts
agentSlug
routerConfig
humanApprovalConfig
toolBindings
skillBindings
retryPolicy
modelId
```

### 6.6 Conversion node injection

Add a deterministic conversion step when source/target kinds are not directly bindable but a known conversion exists.

Example:

```text
data -> text
```

Insert:

```text
prepare_report_context
```

Template selection strategy:

1. Look for enabled template with primitive kind `agent` or `action` and category `conversion` or key matching known converter.
2. Fallback to `generic.agent_step` with deterministic title/purpose.
3. Risk flag if no converter is available.

Initial known conversions:

```text
data -> text: summarize/format data as narrative context
document -> text: extract text from document
text -> data: structure/extract fields
image -> text: visual extraction / OCR-like analysis
```

---

## Phase 7 — Binding resolver alignment

### 7.1 Unify artifact compatibility

Current backend compatibility and frontend strict matching should be aligned.

Recommended policy:

```text
Bindings are strict by default.
If artifact kinds differ, compiler must insert a conversion/synthesis node.
Only allow direct mismatch when a primitive spec explicitly declares compatibleKinds.
```

Update:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-binding-resolver.service.ts
YellowStorm/front/src/modules/playbook/hooks/helpers/control-edge-serializer.ts
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx
```

### 7.2 Carry edge kind and router label

Extend create_edge changes:

```ts
{
  type: 'create_edge',
  edgeKind?: 'sequential' | 'conditional';
  routerLabel?: string | null;
  priority?: number | null;
}
```

The resolver should preserve these fields.

### 7.3 Binding from conditional edge

Do not synthesize a data binding for a router conditional edge unless it also has an explicit data port binding need.

Rule:

```text
sequential port-aware edge -> may synthesize data binding
conditional router edge -> control flow only by default
explicit binding -> data flow
```

This avoids accidentally treating router branch labels as text data outputs.

---

## Phase 8 — Frontend application updates

### 8.1 Extend frontend types

File:

```text
YellowStorm/front/src/modules/playbook/types.ts
```

Add to `PlaybookIntentTaskDraft`:

```ts
routerConfig?: RouterConfig | null;
humanApprovalConfig?: HumanApprovalConfig | null;
retryPolicy?: RetryPolicy | null;
modelId?: string | null;
```

Add to workflow change `create_edge`:

```ts
edgeKind?: ControlEdgeKind;
routerLabel?: string | null;
priority?: number | null;
```

Add to iterator body steps:

```ts
routerConfig?: RouterConfig | null;
humanApprovalConfig?: HumanApprovalConfig | null;
toolBindings?: ToolBinding[];
skillBindings?: TaskSkillBinding[];
```

### 8.2 Update `createIntentTask()`

File:

```text
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx
```

Add parameters:

```ts
routerConfig?: RouterConfig | null;
humanApprovalConfig?: HumanApprovalConfig | null;
retryPolicy?: RetryPolicy | null;
modelId?: string | null;
```

Task creation:

```ts
nodeType: matchedNodeType,
taskType: matchedNodeType === 'router'
  ? 'router'
  : matchedNodeType === 'iterator'
    ? 'iterator'
    : matchedNodeType === 'evaluation'
      ? 'evaluation'
      : 'generic',
routerConfig: routerConfig ?? matchedTemplate?.routerConfig ?? null,
humanApprovalConfig: humanApprovalConfig ?? matchedTemplate?.humanApprovalConfig ?? null,
retryPolicy: retryPolicy ?? matchedTemplate?.retryPolicy ?? null,
modelId: modelId ?? matchedTemplate?.modelId ?? null,
```

### 8.3 Update edge application

`applyEdgeChange()` should use `edgeKind` and `routerLabel`.

Pseudo-code:

```ts
const isConditional = change.edgeKind === 'conditional' || Boolean(change.routerLabel);
const edge = createProgrammaticEdge(...);
edge.type = isConditional ? 'conditional' : 'animated';
edge.animated = !isConditional;
edge.data = {
  ...edge.data,
  kind: isConditional ? 'conditional' : 'sequential',
  routerLabel: change.routerLabel ?? resolvedPorts.sourceOutputPortId,
  priority: change.priority ?? null,
};
```

### 8.4 Avoid data binding from router control edges

When appending a conditional edge, do not call `upsertNodeOutputBinding()` automatically.

Current `appendIntentEdge()` auto-binds required inputs. Add an option:

```ts
appendIntentEdge(source, target, sourcePort, targetPort, {
  kind: 'conditional',
  routerLabel,
  autoBind: false,
});
```

### 8.5 Iterator child router support

When creating iterator child tasks, pass child `routerConfig`, `toolBindings`, `skillBindings`, etc.

---

## Phase 9 — Design assessment deterministic precheck

### 9.1 Add requirement analyzer

Create:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-requirement-analyzer.service.ts
```

Responsibilities:

```text
- Detect whether datasource is required and missing.
- Detect whether final output format is missing.
- Detect whether trigger is missing when user intent implies automation.
- Detect external side effects and require approval/HITL clarification.
- Detect router need and missing branch rules.
- Detect required connector/action unavailability.
- Detect unresolved required template inputs.
```

### 9.2 Output shape

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

### 9.3 Integrate with `assessDesign()`

Before calling LLM:

```ts
const requirementGaps = this.requirementAnalyzer.analyze(...);
```

Add prompt variable:

```text
<Deterministic_Requirement_Gaps_JSON>
{requirement_gaps}
</Deterministic_Requirement_Gaps_JSON>
```

Prompt rule:

```text
Ask clarification only for the provided deterministic gaps unless the user request introduces a clearly new blocking ambiguity.
```

This reduces unnecessary questions while preserving quality.

---

## Phase 10 — Final validation dry-run

### 10.1 Validate compiled suggestion before returning

After builder + resolver, run a dry validation pass using the same rules as runtime validation.

Implementation strategy:

1. Build a predicted graph from existing flow + workflow changes.
2. Convert task drafts into `FlowNode`-like objects.
3. Convert create_edge changes into `ControlEdge`-like objects.
4. Convert create_data_binding changes into `DataBinding`-like objects.
5. Call `PlaybookFlowValidatorService.validate()` with draft options if necessary.

### 10.2 Draft validation options

Use stricter defaults, with limited draft allowances:

```ts
{
  allowDraftRouters: false,
  allowUnboundRequiredPorts: false,
  allowIncompleteNodeOutputBindings: false,
}
```

If validation fails:

```text
- Try deterministic repair once.
- If still invalid, return no workflow_plan and return a clarification/design warning.
```

### 10.3 Surface diagnostics

Extend suggestion with optional diagnostics:

```ts
validationDiagnostics?: PlaybookIntentDiagnostic[];
repairSummary?: string[];
```

Frontend can display:

```text
Generated with 2 safe repairs:
- Added missing required input port invoice_data.
- Added default route manual_review to router policy_decision.
```

---

## Phase 11 — Quality score

### 11.1 Replace fixed confidence

Replace fixed `confidence: 0.85` with computed confidence.

Proposed scoring:

```ts
let score = 1.0;
score -= 0.15 * errorDiagnostics.length;
score -= 0.05 * warningDiagnostics.length;
score -= 0.08 * repairSummary.length;
score -= 0.10 * genericTemplateFallbackCount;
score -= 0.12 * unresolvedRequiredInputCount;
score -= 0.10 * unverifiedRouterConditionCount;
score -= 0.10 * missingToolBindingCount;
score = clamp(score, 0.05, 0.98);
```

### 11.2 Confidence interpretation

```text
>= 0.85: ready to apply
0.70 - 0.84: apply with warnings
0.50 - 0.69: review recommended
< 0.50: ask clarification instead of applying
```

---

## 8. Testing strategy

## 8.1 Backend unit tests

### Parser tests

File:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-parser.service.spec.ts
```

Add tests:

```text
- parses v2 blueprint root
- parses primitive.router
- parses routerConfig alias
- parses conditional links
- rejects conditional link without routerLabel
- parses iterator child agentHint/connectors/skills
- preserves diagnostics for invalid primitive config
- converts v1 blueprint to internal v2 shape
```

### Normalizer/repair tests

New files:

```text
playbook-intent-blueprint-normalizer.service.spec.ts
playbook-intent-blueprint-repair.service.spec.ts
```

Test cases:

```text
- adds required template ports
- deduplicates router labels
- adds router output ports from labels
- sets sourceOutputPortId from routerLabel
- repairs defaultLabel when safe
- refuses to invent missing business condition
- inserts conversion node for data->text when converter template exists
```

### Graph builder tests

File:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-builder.service.spec.ts
```

Add tests:

```text
- builds router task with routerConfig
- builds conditional edges from router links
- does not synthesize data binding from conditional router edge
- builds iterator child router
- preserves required template ports
- rejects unknown router labels
- computes confidence based on diagnostics
```

### Binding resolver tests

File:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-binding-resolver.service.spec.ts
```

Add tests:

```text
- strict artifact mismatch is rejected
- conversion-ready mismatch is marked repairable
- conditional edge metadata is preserved
- sequential edge can synthesize binding
- conditional edge does not synthesize binding by default
```

## 8.2 Frontend unit tests

Files:

```text
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.test.tsx
YellowStorm/front/src/modules/playbook/hooks/helpers/control-edge-serializer.test.ts
YellowStorm/front/src/modules/playbook/components/RouterNode.test.tsx
YellowStorm/front/src/modules/playbook/components/PlaybookRouterConfigSection.test.tsx
```

Test cases:

```text
- applies routerConfig from intent task draft
- creates conditional edge with routerLabel
- does not auto-bind router conditional edge
- applies iterator child routerConfig
- preserves outputLabels in RouterNode
- serializes/deserializes conditional edges correctly
```

## 8.3 Golden fixtures

Create fixture folder:

```text
YellowStorm/back/src/modules/playbook-flow/test-fixtures/intent-blueprint-v2/
```

Fixtures:

```text
01-linear-agent-workflow.json
02-datasource-constant-binding.json
03-iterator-basic.json
04-router-basic-policy-decision.json
05-router-inside-iterator.json
06-action-connector-binding.json
07-human-approval-before-external-send.json
08-artifact-conversion-data-to-text.json
09-missing-required-input-clarification.json
10-future-primitive-noop.json
```

Each fixture should include:

```json
{
  "name": "router-basic-policy-decision",
  "inputBlueprint": {},
  "availableTemplates": [],
  "availableCatalog": {},
  "expectedDiagnostics": [],
  "expectedChangesShape": {},
  "expectedValidationStatus": "valid"
}
```

## 8.4 End-to-end acceptance scenarios

### Scenario 1 — Expense policy router

User intent:

```text
Create a workflow that reviews employee expense claims. If the amount is above policy limit, ask manager approval; otherwise prepare an approval summary.
```

Expected generated graph:

```text
Collect expense claims
  -> Assess policy compliance
  -> Router: route by above_limit
       requires_approval -> Manager approval
       auto_approve -> Prepare approval summary
       reject -> Prepare rejection note
```

Expected router config:

```json
{
  "outputLabels": ["requires_approval", "auto_approve", "reject"],
  "defaultLabel": "requires_approval",
  "conditions": [
    {
      "label": "requires_approval",
      "sourceNode": "assess_policy_compliance",
      "sourcePort": "policy_result",
      "path": "$.above_limit",
      "operator": "equals",
      "value": true
    }
  ]
}
```

### Scenario 2 — Iterator with router

User intent:

```text
For each incoming supplier invoice, extract fields, route high-risk invoices for review, and archive low-risk invoices.
```

Expected graph:

```text
Collect invoices
  -> Iterator invoices
       Extract invoice fields
       Assess risk
       Router risk route
          high_risk -> Human approval
          low_risk -> Archive invoice
```

### Scenario 3 — Artifact conversion

User intent:

```text
Analyze CRM leads and generate a management report.
```

Expected graph:

```text
Collect CRM leads [data]
  -> Enrich leads [data]
  -> Prepare report context [data -> text]
  -> Generate management report [document]
```

---

## 9. Suggested PR roadmap

### PR 1 — Blueprint IR v2 types and parser compatibility

Scope:

```text
- Extend backend blueprint interfaces.
- Add v2 parsing fields.
- Keep v1 compatibility.
- Add parser tests.
```

Files:

```text
playbook-flow-intent-blueprint.interface.ts
playbook-intent-blueprint-parser.service.ts
playbook-intent-blueprint-parser.service.spec.ts
```

Exit criteria:

```text
- v1 tests still pass.
- v2 router blueprint parses successfully.
- Invalid router config emits diagnostics.
```

### PR 2 — Primitive Registry and prompt catalog

Scope:

```text
- Add primitive registry service.
- Add primitive prompt catalog.
- Enrich node template prompt serialization.
- Update intent.analyze prompt.
```

Files:

```text
playbook-flow-primitive-registry.service.ts
playbook-flow-intent.service.ts
playbook-flow-prompt-seed.ts
playbook-flow.module.ts
```

Exit criteria:

```text
- Prompt contains primitive catalog.
- Node template catalog includes routerConfig/iteratorConfig/humanApprovalConfig.
- Existing prompt rendering tests pass.
```

### PR 3 — Normalizer and required port preservation

Scope:

```text
- Add blueprint normalizer.
- Preserve required template ports.
- Normalize router labels and router output ports.
```

Files:

```text
playbook-intent-blueprint-normalizer.service.ts
playbook-intent-graph-builder.service.ts
```

Exit criteria:

```text
- Required template ports cannot disappear.
- Router output labels become output ports.
- Existing builder tests pass.
```

### PR 4 — Router compilation end-to-end backend

Scope:

```text
- Add routerConfig to task drafts.
- Compile primitive.router into routerConfig.
- Add conditional edge support in workflow changes.
- Prevent data binding synthesis for router conditional edges.
```

Files:

```text
playbook-flow-intent.service.ts
playbook-intent-graph-builder.service.ts
playbook-intent-graph-binding-resolver.service.ts
```

Exit criteria:

```text
- Router fixture produces valid workflow_plan.
- Conditional edge includes routerLabel.
- No accidental data binding from router label.
```

### PR 5 — Frontend apply support for routerConfig and conditional edges

Scope:

```text
- Extend frontend types.
- Apply routerConfig from suggestion.
- Create conditional edges from workflow changes.
- Avoid auto-binding conditional router edges.
```

Files:

```text
front/src/modules/playbook/types.ts
front/src/modules/playbook/components/PlaybookCanvasPage.tsx
front/src/modules/playbook/hooks/helpers/control-edge-serializer.ts
```

Exit criteria:

```text
- Router generated by intent appears as RouterNode.
- Branch labels are visible.
- Router config editor shows generated conditions.
```

### PR 6 — Iterator child primitive support

Scope:

```text
- Extend iterator step blueprint and task draft.
- Allow agentHint, connectorRefs, skillRefs, routerConfig inside iterator body.
- Add tests for router inside iterator.
```

Exit criteria:

```text
- Iterator child router works.
- Iterator body edges can be conditional.
```

### PR 7 — Deterministic repair and conversion nodes

Scope:

```text
- Add repair service.
- Add safe repairs.
- Add conversion node insertion.
- Add repair summary diagnostics.
```

Exit criteria:

```text
- data->text fixture inserts conversion node.
- Invalid-but-repairable blueprint becomes valid.
- Unsafe repair returns clarification/diagnostic.
```

### PR 8 — Requirement analyzer and better design assessment

Scope:

```text
- Add deterministic requirement analyzer.
- Feed requirement gaps into intent.design_assessment.
- Reduce unnecessary clarification questions.
```

Exit criteria:

```text
- Missing datasource triggers datasource question.
- Missing router branch rules triggers business rule question.
- Complete low-risk intent goes ready_to_generate.
```

### PR 9 — Final validation dry-run and confidence scoring

Scope:

```text
- Predict graph after suggestion changes.
- Run validator before returning suggestion.
- Compute confidence from diagnostics.
- Surface repair summary and validation diagnostics.
```

Exit criteria:

```text
- Invalid final graph is not returned as ready suggestion.
- Confidence reflects quality.
- Frontend can show diagnostics.
```

---

## 10. Detailed implementation notes

### 10.1 Router output ports

Router output ports should be generated from `outputLabels`.

Recommended artifact kind:

```text
text
```

Reason: router output ports are primarily control handles, not business data payloads. They should not be used as data source unless explicitly bound.

Example:

```ts
function buildRouterOutputPorts(config: RouterConfig): PlaybookIntentBlueprintPort[] {
  return config.outputLabels.map((label) => ({
    id: label,
    name: label,
    artifactKind: 'text',
  }));
}
```

### 10.2 Router conditions source references

Blueprint uses `sourceRef` and `sourcePort`. Runtime uses `sourceNode` and `sourcePort`.

Compiler mapping:

```ts
sourceNode = resolveEndpointReference(condition.sourceRef, condition.sourceIteratorRef)
sourcePort = condition.sourcePort
```

For iterator child refs:

```text
sourceIteratorRef = parent iterator ref
sourceRef = child step ref
```

### 10.3 Conditional link validation

Validation rules before build:

```text
- sourceRef must resolve to router node.
- routerLabel must be present.
- routerLabel must exist in routerConfig.outputLabels.
- targetRef must exist.
- if source router is inside iterator, target should be inside same iterator unless explicitly allowed.
```

### 10.4 Data binding vs control edge

Keep this separation strict:

```text
Control edge = execution order / branching.
Data binding = data consumption.
```

A router edge should usually be pure control flow:

```json
{
  "sourceRef": "route_claim",
  "targetRef": "manager_approval",
  "kind": "conditional",
  "routerLabel": "requires_approval"
}
```

If the approval step also needs the policy result, add explicit binding:

```json
{
  "sourceKind": "node-output",
  "sourceRef": "assess_policy",
  "sourcePort": "policy_result",
  "targetRef": "manager_approval",
  "targetPort": "approval_context"
}
```

### 10.5 Template required ports

Required template ports should be treated as contract, not suggestion.

If the LLM omits a required port:

```text
Add it back.
If no binding exists, either auto-bind if there is exactly one compatible source or return a required input diagnostic.
```

### 10.6 Action node side effects

For action templates with external side effects, the generation process should add HITL or require design clarification unless the user explicitly approves.

Side effect levels:

```text
none
workspace_write
external_send
destructive
```

Examples:

```text
Send email -> external_send
Delete record -> destructive
Create workspace file -> workspace_write
Read CRM contact -> none
```

### 10.7 Future primitive extension

When adding a new primitive, implementation should require only:

```text
1. Add primitive spec.
2. Add optional config type.
3. Add compiler handler.
4. Add prompt catalog entry.
5. Add golden fixture.
```

The global prompt should not need large manual rewriting.

---

## 11. Example Blueprint IR v2

### 11.1 Expense approval workflow

```json
{
  "blueprint": {
    "version": 2,
    "title": "Expense policy review and approval workflow",
    "summary": "Review expense claims, route above-limit claims to manager approval, and produce final decision artifacts.",
    "nodes": [
      {
        "ref": "collect_expense_claims",
        "label": "Collect expense claims",
        "purpose": "Collect submitted expense claims and supporting documents.",
        "nodeTemplateKey": "generic.agent_step",
        "primitive": { "kind": "agent" },
        "inputPorts": [
          { "id": "claim_source", "name": "Claim source", "artifactKind": "document", "required": true }
        ],
        "outputPorts": [
          { "id": "claims", "name": "Claims", "artifactKind": "data" }
        ]
      },
      {
        "ref": "assess_policy_compliance",
        "label": "Assess policy compliance",
        "purpose": "Compare each claim against company policy and detect above-limit hotel expenses.",
        "nodeTemplateKey": "generic.agent_step",
        "primitive": { "kind": "agent" },
        "inputPorts": [
          { "id": "claims", "name": "Claims", "artifactKind": "data", "required": true }
        ],
        "outputPorts": [
          { "id": "policy_result", "name": "Policy result", "artifactKind": "data" }
        ]
      },
      {
        "ref": "route_policy_decision",
        "label": "Route policy decision",
        "purpose": "Route claims depending on whether prior written manager approval is required.",
        "nodeTemplateKey": "router.policy_decision",
        "primitive": {
          "kind": "router",
          "router": {
            "outputLabels": ["requires_approval", "auto_approve", "reject"],
            "defaultLabel": "requires_approval",
            "maxIterations": 1,
            "conditions": [
              {
                "label": "requires_approval",
                "sourceRef": "assess_policy_compliance",
                "sourcePort": "policy_result",
                "path": "$.above_limit",
                "operator": "equals",
                "value": true
              },
              {
                "label": "auto_approve",
                "sourceRef": "assess_policy_compliance",
                "sourcePort": "policy_result",
                "path": "$.above_limit",
                "operator": "equals",
                "value": false
              }
            ]
          }
        },
        "inputPorts": [
          { "id": "policy_result", "name": "Policy result", "artifactKind": "data", "required": true }
        ],
        "outputPorts": [
          { "id": "requires_approval", "name": "Requires approval", "artifactKind": "text" },
          { "id": "auto_approve", "name": "Auto approve", "artifactKind": "text" },
          { "id": "reject", "name": "Reject", "artifactKind": "text" }
        ]
      },
      {
        "ref": "manager_approval",
        "label": "Manager approval",
        "purpose": "Ask manager to approve above-limit expense claims before reimbursement.",
        "nodeTemplateKey": "human_approval.manager_review",
        "primitive": {
          "kind": "human_approval",
          "humanApproval": {
            "promptTemplate": "Please approve or reject this above-limit expense claim.",
            "approvalMode": "approve_reject"
          }
        },
        "inputPorts": [
          { "id": "approval_context", "name": "Approval context", "artifactKind": "data", "required": true }
        ],
        "outputPorts": [
          { "id": "approval_decision", "name": "Approval decision", "artifactKind": "data" }
        ]
      },
      {
        "ref": "prepare_final_response",
        "label": "Prepare final response",
        "purpose": "Generate the final reimbursement decision and supporting explanation.",
        "nodeTemplateKey": "generic.agent_step",
        "primitive": { "kind": "agent" },
        "inputPorts": [
          { "id": "decision_context", "name": "Decision context", "artifactKind": "data", "required": true }
        ],
        "outputPorts": [
          { "id": "final_response", "name": "Final response", "artifactKind": "document" }
        ]
      }
    ],
    "links": [
      {
        "sourceRef": "collect_expense_claims",
        "sourceOutputPortId": "claims",
        "targetRef": "assess_policy_compliance",
        "targetInputPortId": "claims"
      },
      {
        "sourceRef": "assess_policy_compliance",
        "sourceOutputPortId": "policy_result",
        "targetRef": "route_policy_decision",
        "targetInputPortId": "policy_result"
      },
      {
        "sourceRef": "route_policy_decision",
        "targetRef": "manager_approval",
        "kind": "conditional",
        "routerLabel": "requires_approval"
      },
      {
        "sourceRef": "route_policy_decision",
        "targetRef": "prepare_final_response",
        "kind": "conditional",
        "routerLabel": "auto_approve"
      },
      {
        "sourceRef": "manager_approval",
        "sourceOutputPortId": "approval_decision",
        "targetRef": "prepare_final_response",
        "targetInputPortId": "decision_context"
      }
    ],
    "bindings": [
      {
        "sourceKind": "node-output",
        "sourceRef": "collect_expense_claims",
        "sourcePort": "claims",
        "targetRef": "assess_policy_compliance",
        "targetPort": "claims"
      },
      {
        "sourceKind": "node-output",
        "sourceRef": "assess_policy_compliance",
        "sourcePort": "policy_result",
        "targetRef": "route_policy_decision",
        "targetPort": "policy_result"
      },
      {
        "sourceKind": "node-output",
        "sourceRef": "assess_policy_compliance",
        "sourcePort": "policy_result",
        "targetRef": "manager_approval",
        "targetPort": "approval_context"
      }
    ]
  },
  "assumptions": [
    "Claims contain enough structured information to detect whether an expense is above policy limit."
  ],
  "riskFlags": [
    "Manager approval is required before reimbursing above-limit hotel expenses."
  ]
}
```

---

## 12. Rollout strategy

### 12.1 Local/dev rollout

```text
- Enable Blueprint IR v2 by default in dev.
- Log all parser/build/repair diagnostics.
- Compare v1 and v2 output on the same intents.
```

### 12.2 Staging rollout

```text
- Enable v2 for internal users.
- Keep v1 fallback available.
- Track empty suggestion rate.
- Track repair rate.
- Track frontend apply warning rate.
- Track user manual edits after generation.
```

### 12.3 Production rollout

```text
- Enable v2 for new playbooks first.
- Enable v2 for selected existing playbooks later.
- Keep prompt versioned and rollback-safe.
```

### 12.4 Metrics

Add metrics/log fields:

```text
intent_blueprint_version
intent_generation_model
blueprint_parse_success
blueprint_repair_count
blueprint_validation_error_count
workflow_plan_change_count
router_node_count
iterator_node_count
conversion_node_count
frontend_apply_warning_count
manual_edits_after_generation_count
```

---

## 13. Risks and mitigations

### Risk 1 — Prompt becomes too long

Mitigation:

```text
Generate primitive prompt catalog compactly.
Include only enabled primitives/templates.
Limit examples to one per primitive type.
Use schema hints, not full schemas.
```

### Risk 2 — Router conditions are over-specified by LLM

Mitigation:

```text
Validate sourceRef/sourcePort/path/operator.
Require defaultLabel.
Ask clarification if business rule is not inferable.
Allow natural-language riskFlag instead of fake deterministic conditions.
```

### Risk 3 — Repairs alter business meaning

Mitigation:

```text
Only allow structural repairs.
Never invent business thresholds, external resource ids, or branch logic.
Expose repair summary.
Lower confidence when repairs are applied.
```

### Risk 4 — Frontend and backend graph semantics diverge

Mitigation:

```text
Add shared test fixtures.
Add control-edge serialization tests.
Avoid hidden frontend inference.
Persist routerConfig exactly from backend suggestion.
```

### Risk 5 — Future primitives need many code changes

Mitigation:

```text
Primitive Registry becomes the extension point.
Every primitive owns prompt hints, validation, normalization, compilation.
```

---

## 14. Definition of done

The implementation should be considered complete when:

```text
- Blueprint IR v2 is parsed and built end-to-end.
- v1 blueprints still work.
- Router nodes are generated with routerConfig, outputLabels, conditions, defaultLabel.
- Conditional router edges preserve routerLabel.
- Router conditional edges do not create accidental data bindings.
- Required template ports are always preserved.
- Iterator children support agent/connectors/skills/router/human approval configs.
- Artifact kind mismatch is repaired with conversion nodes or rejected with actionable diagnostics.
- Final graph validation runs before suggestions are returned.
- Confidence is computed from diagnostics and repairs.
- Golden fixtures cover linear, iterator, router, router-inside-iterator, action, approval, conversion, missing input, and future primitive cases.
- Frontend can apply generated router workflows without manual custom adaptation.
```

---

## 15. Recommended immediate next step

Start with PR 1 and PR 4 as the critical path:

```text
PR 1: Blueprint IR v2 parser compatibility.
PR 4: Router compilation end-to-end backend.
```

Reason:

```text
Router support is the clearest functional gap and the best proof that the new primitive-aware architecture works.
```

Once router generation is stable, apply the same primitive pattern to iterator children, human approval, conversion nodes, and future primitive types.
