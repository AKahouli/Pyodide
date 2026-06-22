# YellowStorm Playbook Deterministic Builder Implementation Plan

## Purpose
Make playbook construction more deterministic, scalable for future node types, and less dependent on the heavy `intent.analyze` prompt. The goal is not to remove the LLM; it is to move the LLM from graph-mutation author to bounded intent/blueprint assistant while backend deterministic services own graph assembly, node-type behavior, edges, data bindings, validation, ordering, and streamable deltas.

## Did We Start This Already?
Yes, partially.

Already in place:
- `PlaybookFlowIntentService` builds reusable intent context and normalizes LLM suggestions before returning them.
- `PlaybookIntentGraphBindingResolverService` validates/repairs edge and data-binding candidates and logs dropped candidates.
- `PlaybookFlowIntentConstructionService` introduced realtime construction jobs and ordered stream events.
- Frontend application uses deterministic keys through `createIntentSuggestionApplicationKey()`, `createIntentSuggestionNodeId()`, and `createIntentSuggestionBindingId()`.
- Prior root docs focused on realtime node-by-node construction.

Still missing:
- Backend-owned deterministic blueprint-to-graph builder.
- Small intermediate intent blueprint contract.
- Central node-type construction registry for future node types.
- Realtime construction that streams builder-accepted deltas instead of partially parsed LLM JSON graph mutations.
- Reduced `intent.analyze` prompt that asks for intent structure, not final graph mechanics.

## Current Flow
```text
Frontend intent bar
  -> POST /playbooks/:id/intent or /intent-constructions
  -> PlaybookFlowIntentService builds prompt context
  -> LiteLLM returns suggestions/workflow_plan JSON
  -> backend normalizes and resolves graph changes
  -> frontend applies PlaybookIntentSuggestion changes deterministically
```

Key files:
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts` - heavy `intent.analyze` prompt.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts` - intent orchestration and normalization.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts` - realtime construction stream.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-binding-resolver.service.ts` - deterministic binding repair.
- `YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-node-template.interface.ts` - template node types.
- `YellowStorm/back/src/modules/playbook-flow/constants/node-kinds.ts` - runtime node kinds.
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx` - graph application path.
- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts` - manual, auto-apply, and realtime fallback flow.
- `YellowStorm/front/src/modules/playbook/utils/intent-application-key.ts` - deterministic application ids.

## Target Architecture
```text
User intent and clarifications
  -> compact LLM or heuristic blueprint
  -> backend blueprint parser
  -> backend graph builder
  -> node-type build registry
  -> graph binding resolver
  -> existing PlaybookIntentSuggestion/workflow_plan contract
  -> existing frontend application path
```

Ownership shift:
- User goal: remains LLM plus clarification flow.
- Step/template/resource hints: LLM proposes, backend validates.
- Graph mutations: move from LLM to backend graph builder.
- Runtime node kind: move from prompt/normalizer mix to node-type build registry.
- Edges/data bindings: move from LLM plus resolver to builder plus resolver.
- Impact counts: builder/normalizer only.
- Realtime progress: builder session events instead of LLM chunk parser.

Core rules:
- Preserve public contracts during early phases.
- Keep `PlaybookIntentSuggestion` and `workflow_plan` frontend application until backend builder parity is proven.
- Use the LLM for ambiguity, not deterministic graph mechanics.
- Do not introduce unsupported runtime node kinds without a separate runtime/proto/ADK change.
- Keep every graph candidate drop loud with WARN logs containing item id and rule.
- Keep `intent.analyze` customizable through the existing Admin prompt UI path.

## Phase 0: Baseline And Safety Net
Goal: lock current behavior before changing ownership.

Work:
1. Capture fixtures for current successful outputs.
2. Add focused tests around intent normalization, binding repair, realtime events, and fallback behavior.
3. Confirm current manual suggestion, auto-apply, and realtime construction paths still work.

Fixtures: empty draft to linear playbook, selected-node graph extension, parallel branches plus merge, router workflow, iterator workflow with isolated body steps, human approval workflow, constant binding from selected workspace/document clarification, and update-node remediation where topology must not change.

Likely files:
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.spec.ts` - golden normalization and fallback tests.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.spec.ts` - stream, replay, cancellation, and failure tests.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-binding-resolver.service.spec.ts` - resolver fixture coverage.
- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.test.tsx` - only if frontend behavior is touched.

Exit criteria:
- Focused tests pass before architecture changes.
- No public API or frontend behavior changes.

## Phase 1: Add Internal Blueprint Contract
Goal: introduce a small backend-only representation that is easier to produce than final graph mutations.

Create:
- `YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-intent-blueprint.interface.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-blueprint-parser.service.ts`

Suggested internal shape:
```ts
export interface PlaybookIntentBlueprint {
  title: string;
  summary: string;
  nodes: PlaybookIntentBlueprintNode[];
  links: PlaybookIntentBlueprintLink[];
  bindings?: PlaybookIntentBlueprintBinding[];
  assumptions?: string[];
  riskFlags?: string[];
}
```

Minimum node fields:
```ts
export interface PlaybookIntentBlueprintNode {
  ref: string;
  label: string;
  purpose: string;
  templateType?: string | null;
  nodeType?: 'agent' | 'action' | 'evaluation' | 'iterator' | 'router' | 'human_approval';
  resourceRefs?: string[];
}
```

Parser rules:
- Accept new `blueprint` output when present.
- Accept legacy `suggestions` / `workflow_plan` output as fallback.
- Normalize refs, labels, and resource refs once at this boundary.
- Log rejected blueprint items with rule and item id.
- Keep blueprint internal in this phase.

Exit criteria:
- Parser tests cover valid blueprint, duplicate refs, missing refs, unsupported node type, malformed links, and legacy fallback.
- No frontend changes.

## Phase 2: Add Deterministic Graph Builder
Goal: convert normalized blueprint input into the existing `PlaybookIntentSuggestion` / `workflow_plan` shape.

Create:
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-builder.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-graph-builder.service.spec.ts`

Builder responsibilities:
- Build `create_node`, `update_node`, `create_edge`, and `create_data_binding` changes from blueprint input.
- Generate stable node refs from blueprint refs and existing graph context.
- Prefer enabled node templates when `templateType` or `nodeType` is provided.
- Fill template-backed ports from templates, not LLM text.
- Create deterministic edge order from blueprint links.
- Create binding candidates only where ports are compatible.
- Delegate final edge/binding repair to `PlaybookIntentGraphBindingResolverService`.
- Recompute impact counts from accepted changes.

Modify:
- `YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts` - register parser and builder.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts` - prefer blueprint-to-builder path; fallback to legacy normalization.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.spec.ts` - assert blueprint and legacy paths return current public shape.

Exit criteria:
- Same blueprint input produces stable output across repeated runs.
- Legacy `workflow_plan` still works.
- Current frontend application path is unchanged.

## Phase 3: Add Node-Type Build Registry
Goal: support future node types without growing prompt instructions or scattered conditionals.

Create:
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-node-build-registry.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-intent-node-build-registry.service.spec.ts`

Initial mapping:
- `agent` -> `step`
- `action` -> `step`
- `evaluation` -> `step`
- `iterator` -> `iterator`
- `router` -> `router`
- `human_approval` -> `human_approval`

Registry responsibilities:
- Map frontend/template node type to supported runtime kind.
- Provide default construction behavior by node type.
- Reject unsupported future node types loudly until runtime support exists.
- Keep router, iterator, and human approval defaults out of the prompt.

Exit criteria:
- Adding a future node type has one obvious backend extension point.
- Tests cover every currently supported node type.

## Phase 4: Reduce `intent.analyze` Prompt Responsibility
Goal: shrink the prompt so the LLM emits compact intent structure instead of final graph mechanics.

Modify:
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts`

Remove LLM responsibility for final edge correctness, final data-binding correctness, impact count correctness, exact ports for template-backed nodes, full graph validator behavior, and long examples of every graph mutation shape.

Keep LLM responsibility for business goal, compact node list, template or node-type hints, business-level dependency links, resource usage intent, assumptions, and risk flags.

Migration behavior:
```text
If response has blueprint:
  parse blueprint -> graph builder -> workflow_plan
Else if response has legacy suggestions/workflow_plan:
  current normalization path
Else:
  current fallback suggestion
```

Exit criteria:
- Reduced prompt can generate valid playbooks through the builder path.
- Legacy prompt output is still accepted.
- Admin-customized prompt behavior remains supported.

## Phase 5: Make Realtime Construction Builder-Driven
Goal: stop graph construction from depending on partial LLM JSON chunks.

Current issue:
```text
PlaybookFlowIntentConstructionService
  -> stream LiteLLM JSON
  -> collect raw text
  -> extract complete changes from partial JSON
  -> normalize deltas
```

Target flow:
```text
PlaybookFlowIntentConstructionService
  -> collect/parse blueprint or staged blueprint sections
  -> deterministic builder session accepts nodes/links/bindings
  -> emit current node_delta/edge_delta/data_binding_delta events
```

Preserve current stream event names where possible: `started`, `progress`, `node_delta`, `edge_delta`, `data_binding_delta`, `completed`, `failed`, and `cancelled`.

Likely files:
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts` - route construction through builder session.
- `YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-intent-construction.interface.ts` - add optional metadata only if needed.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.spec.ts` - verify deterministic accepted deltas only.
- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts` - touch only if optional event handling changes.

Exit criteria:
- No partial JSON parsing is required for graph deltas.
- Retry/reconnect remains idempotent through construction id and sequence.
- Blocking `/intent` fallback still works if construction fails before applying deltas.

## Phase 6: Optional Server-Side Preview/Apply
Goal: eventually reduce frontend graph mutation ownership after builder parity is proven. Possible later API direction: `POST /playbooks/:id/intent-preview` and `POST /playbooks/:id/intent-apply`. Do not start here because it changes persistence ownership and has higher regression risk; only consider it after builder fixtures pass, realtime construction is builder-driven, and frontend deterministic application remains stable.

## Testing Strategy
Backend:
```bash
npm test -- playbook-flow-intent
npm test -- playbook-intent-graph-builder
npm test -- playbook-intent-node-build-registry
npm test -- playbook-flow-intent-construction
npm run build
```

Frontend if touched:
```bash
npm test -- playbook-intent-flow
npm test -- PlaybookIntentBar
npm run build
```

Required coverage: blueprint parser accepts valid blueprint and preserves legacy fallback; builder output is stable across repeated runs; builder does not emit unsupported runtime node kinds; router terminal route requirements remain valid; iterator body children do not leak into top-level graph changes; constant resource bindings preserve workspace/document metadata; invalid edge/binding candidates produce WARN logs with rule and item id; realtime construction emits only accepted deterministic deltas; cancellation and failed-before-apply fallback still work.

## Risks
| Risk | Mitigation |
|---|---|
| Prompt reduction lowers output quality | Keep dual parser support and legacy fallback until fixtures pass. |
| Builder misses complex graph cases | Start with golden fixtures from current LLM outputs. |
| Frontend auto-apply breaks | Preserve current suggestion/change contract in early phases. |
| Node-type mismatch across frontend/backend/runtime | Centralize mapping in node build registry and test all current types. |
| Realtime regression | Convert realtime only after blocking builder path is stable. |
| Silent drops hide bugs | Continue WARN logging every dropped candidate. |
| Services grow too large | Split parser, builder, registry, and resolver responsibilities. |

## Suggested Immediate Next Step
Implement Phase 0 and Phase 1 first:
1. Add golden tests around current intent normalization and realtime behavior.
2. Add backend-only blueprint interfaces and parser.
3. Add deterministic graph builder that emits current `workflow_plan` format.
4. Wire `PlaybookFlowIntentService` to prefer blueprint output while preserving legacy fallback.

This creates a safe seam before changing the prompt or realtime construction internals.

## Clarifications Before Implementation
These do not block this plan, but should be answered before coding Phase 2 or later:
1. Should the first builder version support only new-node construction, or selected-node update/rewrite too?
Answer : the first builder version should support  new-node construction and  selected-node update/rewrite too
2. Should router/iterator/human-approval blueprint generation be enabled immediately, or rolled out after linear/parallel fixtures pass?
Answer : router/iterator/human-approval blueprint generation should be enabled immediately
3. Do we want a feature flag for blueprint mode while legacy `intent.analyze` remains default during validation?
Answer : Absolutely yes, as a temporary measure until the deterministic builder is proven to be stable and reliable, it can be removed later so i should be able to enable/disable this flag anytime via Admin > Playbook Setting
4. Should eventual server-side apply be part of this initiative, or explicitly deferred until deterministic preview is stable?
Answer : deferred
