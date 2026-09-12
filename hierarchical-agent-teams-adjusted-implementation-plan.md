# Hierarchical Agent Teams: Adjusted Implementation Plan

**Repository:** `YellowsysOrg/YellowStorm-poc`  
**Branch reviewed:** `agara-worky-006`  
**Runtime reviewed:** `yellowstorm-adk`, `google-adk==2.8.0`  
**Review date:** 2026-09-12

## 1. Verdict

The supplied plan identifies the central defect correctly: an explicit Team is flattened to agent IDs before execution, and `manual_agents.py` then removes nested managers. The authored topology never reaches ADK.

Do not implement the supplied plan as written. It assumes native ADK `sub_agents` will preserve YellowStorm's delegated-agent capabilities, treats `task` mode as a deterministic return mechanism, hardcodes a `simple` runtime type that is not an established branch contract, and makes every saved Team executable without accounting for existing draft/generated Teams.

The smallest safe implementation is:

1. Prove the ADK execution mechanism before changing production contracts.
2. Preserve one explicit Team ID through conversation routing.
3. Send only the minimal topology required to reconstruct the tree.
4. Validate executable topology at execution time without breaking draft authoring.
5. Reuse exact agent hydration and current delegated-agent capabilities.
6. Make nested stream events actor-aware before enabling the feature.

Native ADK hierarchy is a candidate implementation, not an accepted architectural decision, until the Phase 0 spike passes.

## 2. Confirmed Current State

### Team domain

- `Team.members` already persists `agentId`, `parentAgentId`, sibling `order`, and canvas coordinates.
- `TeamService.updateHierarchy()` checks duplicate agents, self-reference, dangling parents, and cycles.
- It permits zero or multiple roots and does not constrain parent agent types.
- `CreateTeamDto.agentIds` and `TeamService.agentIdsToMembers()` create each supplied member as a root.
- Auto Builder can also produce structures that are valid for editing but not executable as one hierarchy.
- `TeamService.resolveAgentIds()` loads only owned active Teams, flattens them, and discards Team identity.
- Shared-Team reads already use Team-level authorization followed by `AgentService.findByIdsUnrestricted()`.

### Conversation and backend runtime

- `MessageController.resolveAgentIds()` merges direct agent mentions and Team members into one flat set.
- Sticky routing persists only `taggedAgentIds`.
- `MessageReplayContext` is persisted in PostgreSQL JSONB, so adding an optional Team field does not require a database migration.
- `ConversationAgentRequestBuilder` selects `RunSingleAgent` or `RunAgentTeam` from `agents.length` and emits `agent_mode: 'manual'` for teams.
- `AgentService.buildAgentsForStream()` adds or selects a generic manager for flat multi-agent chat.
- `AgentService.buildGrpcAgentsForPlaybook()` already hydrates an exact ID roster with models, prompts, tools, connector bindings, skills, knowledge bases, and guardrails.
- Both gRPC-agent builders currently serialize `agent_type` from `agentTypeName.toLowerCase()`. The supplied plan is correct that this must become `agentTypeSlug`; it is not already fixed on this branch.

### ADK runtime

- `chatbot_servicer.py` selects the first `agent_type == 'manager'` as manager configuration.
- `workflow_processor.py` supports only `auto`, `manual`, and `mono` modes.
- `manual_agents.py` removes every manager from the worker list and exposes all non-managers to one manager.
- Delegated workers currently run through `AgentDelegationFactory` and a separate `AgentRunner`, which supplies lifecycle behavior not obtained merely by constructing `Agent(...)`.
- `StreamingEventProcessor` attributes several activities to the selected top manager instead of `event.author`.
- Backend component contracts already support `actorId`/`actorName`, and protobuf activity messages already support `actor_id`/`actor_name`.

## 3. Corrections to the Supplied Plan

| Supplied decision | Evidence-based adjustment |
|---|---|
| Start with strict Team Builder/save validation | Start with an ADK spike and a persisted-Team inventory. Strict save validation would turn current draft/create/generated states into errors without a migration and an explicit draft-versus-executable distinction. |
| Every persisted Team has exactly one root | Keep structural save validation for drafts. Require exactly one root only when a Team is executed. |
| Only `manager` and `simple` agent types may execute | `manager` is established; `simple` is not. Require every parent and the root to have slug `manager`; allow any active non-manager type as a leaf. |
| Add `pattern`, `rootAgentId`, and nodes to the runtime DTO | Send `teamId` and nodes only. The one root is derived from `parentAgentId == null`; a pattern field has no second supported value. |
| Native `sub_agents` is the chosen runtime | Treat it as a hypothesis. ADK documents built-in-tool/sub-agent limitations, while YellowStorm workers rely on custom runner setup. |
| Nested managers use `mode='task'` to return automatically | ADK 2.8 defines task agents as agents that may chat with the user. Prove actual nested return and event behavior; do not infer it from the mode name. |
| Refactor all runtime factories before validating execution | Avoid the refactor unless the spike proves native hierarchy and identifies the exact shared construction boundary. |
| Add a complete reroot algorithm and helper immediately | Disable/remove the unsafe Set-as-root action for MVP. Users can rewire manager edges; add atomic reroot only when UX evidence requires it. |
| Persist a historical topology snapshot immediately | Persist `teamId` in replay JSONB and intentionally resolve the current Team, matching current replay behavior for mutable agent configuration. |
| Add sticky Team routing in the first slice | Explicit Team execution is turn-scoped in MVP. Clear sticky agent routing for that turn and defer sticky Team state until product semantics are defined. |
| Add a new telemetry model and hierarchy status components | Reuse current actor fields, logs, errors, and Team canvas. Add only fields proven necessary. |
| Add a rollout flag by default | First inventory existing Teams. Use coordinated deployment without a flag if safe; add one existing-style environment guard only if incompatible persisted data requires staged rollout. |

## 4. Product and Security Decisions

These are implementation requirements, not optional follow-ups.

### Explicit routing

- MVP accepts exactly one `teamId` for an AI turn.
- A Team mention cannot be combined with direct `agentIds` or another Team.
- A Team turn always calls `RunAgentTeam`, even if the Team currently contains one member.
- An unmentioned follow-up does not silently reuse the prior Team in MVP.
- Retry, regenerate, and corrective replay re-resolve the persisted `teamId` and current topology.

### Team access

- Team owner, read-share recipient, or write-share recipient may execute an active Team.
- Team access authorizes loading the Team's member agent definitions through the existing unrestricted exact-ID path.
- Connector credentials remain scoped to the requesting user.
- Workspace, tool, and other resource checks must retain the same behavior as execution of a shared agent. Team access must not become a generic bypass for unrelated resource authorization.
- Revoked Team access must make later replay fail closed.

Add focused security tests for a shared Team containing agents, knowledge bases, and connectors not owned by the caller. If current shared-agent semantics are inconsistent, resolve that security behavior before enabling shared-Team execution.

### Executable hierarchy

An executable Team must satisfy all of these checks in NestJS and independently at the ADK trust boundary:

1. The Team is active and contains at least one member.
2. Member agent IDs are unique.
3. Every referenced agent exists and is active.
4. Every non-null parent is another Team member.
5. No member is its own parent.
6. There is exactly one root.
7. The graph is acyclic and every member is reachable from the root.
8. The root's agent type slug is `manager`.
9. Every member with children has agent type slug `manager`.
10. Every gRPC agent has exactly one topology node and vice versa.
11. The hierarchy has at most 25 nodes and depth at most 5 for the MVP.

Non-manager leaves are executors regardless of their specific type slug. Do not introduce a second Team role field.

## 5. Minimal Runtime Contract

Keep reusable agent capability definitions separate from Team placement.

### NestJS type

```ts
interface TeamExecutionDefinition {
  teamId: string;
  nodes: Array<{
    agentId: string;
    parentAgentId: string | null;
    order: number;
  }>;
}
```

### Protobuf

Field `21` is unused in both current `RunAgentTeamRequest` definitions.

```proto
message AgentTeamNode {
  string agent_id = 1;
  string parent_agent_id = 2; // Empty means root; agent IDs cannot be empty.
  int32 order = 3;
}

message AgentTeamDefinition {
  string team_id = 1;
  repeated AgentTeamNode nodes = 2;
}

message RunAgentTeamRequest {
  // Existing fields remain unchanged.
  AgentTeamDefinition team_definition = 21;
}
```

Do not add topology fields to `Agent`. Do not add `pattern` or duplicate `root_agent_id`; both are unnecessary for the first supported execution model.

## 6. Implementation Sequence

### Phase 0: Blocking ADK proof and data inventory

Do not modify production routing in this phase.

Build a focused test/spike for this topology:

```text
Root manager
└── Nested manager
    └── Executor
```

Compare two implementations:

1. Native ADK `sub_agents` with nested manager `mode='task'` and executor `mode='single_turn'`.
2. Recursive direct-child delegation tools built on the existing `AgentDelegationFactory`/`AgentRunner` lifecycle.

The native option passes only if the test proves all of the following:

- Root can invoke only the nested manager, not the executor.
- Nested manager can invoke only its direct executor.
- Executor output returns to nested manager and then root without becoming an independent user conversation.
- Custom tools, one representative built-in tool, connector tools, skills, knowledge context, memory, citations, artifacts, and guardrails keep working through the same event stream.
- `event.author` identifies every executing node.
- Cancellation and exceptions propagate to the root request and terminate cleanly.
- No duplicate final assistant text is emitted.

If any must-have capability fails, select recursive direct-child tools and reuse the current delegated runner. Do not create a reduced-capability native path.

Also run a read-only Team inventory for root counts, depth, node counts, parent types, agent type slugs, inactive members, and shared Teams. Confirm or adjust the 25-node/5-depth limits before rollout.

**Deliverable:** a checked-in deterministic ADK test that records the selected mechanism. A throwaway script alone is insufficient.

### Phase 1: Team execution resolution

Add one pure executable-hierarchy validator near the Team domain. Keep the existing draft-safe checks in `updateHierarchy()`; reuse pure structural checks where that reduces duplication, but do not reject drafts solely for multiple roots or leaf roots on save.

Add `TeamService.resolveExecutionDefinition(userId, teamId)`:

1. Validate the ID and load one active Team through owner/read/write authorization.
2. Load its agents with the existing unrestricted exact-ID path.
3. Compare requested member IDs to returned active agent IDs and fail on any omission.
4. Validate the executable hierarchy using `agentType.slug`.
5. Return `teamId` and ordered nodes.

Add `agentType.slug` to enriched Team API responses and frontend Team types. Change both gRPC-agent builders from `agentTypeName.toLowerCase()` to `agentTypeSlug`, with regression tests for manager and non-manager types.

Do not extract a generic exact-agent factory in this phase. For Team execution, call `buildGrpcAgentsForPlaybook()` only after Team authorization and assert that its returned IDs exactly match the topology. Rename/refactor that method separately only if its name causes ongoing misuse.

### Phase 2: Preserve Team identity through conversation execution

Change routing so `teamIds` are not passed to `MessageController.resolveAgentIds()`.

For a Team turn:

- Reject multiple Teams or mixed Team/direct-agent mentions.
- Store `teamId` in `MessageReplayContext` JSONB.
- Do not persist expanded Team members as sticky `taggedAgentIds`.
- Let `StreamService` resolve the authorized current execution definition and exact Team agents.
- Pass `teamDefinition` to `ConversationAgentRequestBuilder`.
- Force `RunAgentTeam` with `agent_mode: 'hierarchical'` when the definition is present.

For non-Team turns, leave current direct-agent, flat multi-agent, platform-copilot, governed, widget, Worky, evaluation, and playbook paths unchanged.

The existing idempotency fingerprint already includes `teamIds`; retain that behavior. Replay must reauthorize `teamId` before hydrating agents.

### Phase 3: Extend and validate the gRPC boundary

Update both proto sources together:

- `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`
- `yellowstorm-adk/grpc/proto/chatbot.proto`

Then regenerate Python stubs with the repository command:

```powershell
conda run -n meta python grpc/generate_proto.py
```

Add matching Pydantic models to `chatbot_schema.py` and map protobuf empty parent IDs to `None` in `_convert_agent_team_request_v2()`.

The converter must derive the root and use that exact root manager's model and prompt. Remove the hierarchical path's dependency on the first manager in `pb_request.agents`.

Reject malformed topology before the first model call. Check mode/definition consistency so a hierarchical mode without a definition, or a definition under another mode, fails closed.

### Phase 4: Implement the selected hierarchical runtime

Add one hierarchical workflow entry point and route it before the existing flat manual workflow. Do not make `manual_agents.py` support both models.

Common requirements for either selected mechanism:

- Build each topology node once per request.
- Use stable unique runtime names such as `agent_<platform-agent-id>`.
- Build each manager's delegation surface from direct children only.
- Preserve sibling `order` when exposing children.
- Preserve every node's configured model, prompt, regular tools, connectors, skills, knowledge, memory, guardrails, citations, artifacts, and code/web capabilities.
- Append only a compact hierarchy instruction and direct-child descriptions to manager prompts.
- Run only the root as the user-facing entry point.
- Treat only root final text as the assistant answer.
- Enforce the same node/depth limits as NestJS.

If native ADK passed Phase 0, materialize `sub_agents` and use the proven modes exactly as tested. If it failed, recursively create manager delegation tools around existing delegated runners. Do not maintain both production implementations.

### Phase 5: Actor-aware streaming

Use `event.author` as the primary runtime actor key and map the stable runtime name to the matching request agent. Reuse existing actor fields for agent and tool activities.

Update attribution for:

- agent activity;
- tool activity;
- artifacts and citations where producer identity is available;
- delegation logs;
- usage logs;
- final-response selection.

Do not expose internal child text as separate assistant messages. Avoid logging prompts, tool credentials, connector headers, knowledge payloads, or full user content.

### Phase 6: Minimal Team Builder safeguards

Use `agentType.slug`, not labels, for behavior.

- Render a source handle only for `manager` nodes.
- Reject non-manager connection sources in `onConnect()`.
- Show the crown only when `parentAgentId` is null.
- Remove or disable the current Set-as-root action when another root exists; do not add reroot-path reversal in the MVP.
- Derive `hasChildren` from current members/edges after mutations instead of trusting stale node data.
- Surface backend executable-hierarchy errors through the existing i18n/toast pattern.
- Allow draft saves so users can repair old Teams incrementally.

No new hierarchy status component or duplicate full frontend validator is required. The backend remains authoritative.

### Phase 7: Rollout

Run the persisted-Team inventory from Phase 0 in the target environment.

- If active mentioned Teams already satisfy execution rules, deploy ADK first, then NestJS, then frontend in one coordinated rollout.
- If incompatible Teams exist, keep legacy flattening behind one temporary environment guard, expose repair errors in the Team Builder, migrate/repair affected Teams, then remove the guard.
- Do not silently flatten a Team that fails hierarchical validation once hierarchical execution is enabled.

Defer sticky Team follow-ups, topology snapshots, Auto Builder constraints, atomic reroot UX, multiple Teams, mixed Team/agent composition, conditional edges, per-edge schemas, and Team publishing/versioning.

## 7. Primary Files

### NestJS

- `YellowStorm/back/src/modules/team/team.service.ts`
- `YellowStorm/back/src/modules/team/team.service.spec.ts`
- `YellowStorm/back/src/modules/team/interfaces/team.interface.ts`
- `YellowStorm/back/src/modules/conversation/controllers/message.controller.ts`
- `YellowStorm/back/src/modules/conversation/controllers/message.controller.spec.ts`
- `YellowStorm/back/src/modules/conversation/interfaces/message.interface.ts`
- `YellowStorm/back/src/modules/conversation/services/stream.service.ts`
- `YellowStorm/back/src/modules/conversation/services/stream.service.spec.ts`
- `YellowStorm/back/src/modules/conversation/services/conversation-agent-request.builder.ts`
- `YellowStorm/back/src/modules/conversation/services/conversation-agent-request.builder.spec.ts`
- `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`
- `YellowStorm/back/src/modules/agent/agent.service.ts`
- `YellowStorm/back/src/modules/agent/agent.service.spec.ts`

Add at most one Team execution type/validator file if keeping it in `team.service.ts` would obscure the existing save behavior.

### Frontend

- `YellowStorm/front/src/modules/team/types.ts`
- `YellowStorm/front/src/modules/team/hooks/useTeamCanvas.ts`
- `YellowStorm/front/src/modules/team/components/OrgChartNode.tsx`
- Existing Team locale files and focused tests colocated with the affected logic.

### ADK

- `yellowstorm-adk/grpc/proto/chatbot.proto`
- `yellowstorm-adk/src/grpc_generated/chatbot_pb2.py`
- `yellowstorm-adk/src/grpc_generated/chatbot_pb2_grpc.py`
- `yellowstorm-adk/src/schema/chatbot_schema.py`
- `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`
- `yellowstorm-adk/src/smart_rag/engines/multi_agent/workflow_processor.py`
- One new hierarchical workflow module.
- Existing manager/delegation/streaming factories only where the Phase 0 result proves changes are needed.

## 8. Required Tests

### Team and routing

- Valid root manager with non-manager leaves.
- Valid nested manager and leaf grandchild.
- Multiple roots, no root, cycle, dangling parent, duplicate node, non-manager root, and non-manager parent.
- Missing or inactive member fails instead of being silently dropped.
- 26 nodes and depth 6 are rejected at execution.
- Draft save with multiple roots remains repairable.
- Shared Team read access executes; revoked/no access fails.
- One Team mention is preserved; mixed or multiple mentions are rejected.
- Team turns do not inject a generic manager or write expanded sticky agent IDs.
- Replay reauthorizes and re-resolves the Team.

### Contract

- NestJS payload to protobuf to Pydantic preserves `team_id`, `agent_id`, `parent_agent_id`, and `order`.
- Empty protobuf parent maps to `None` only for the root.
- Agent definitions and topology must have identical ID sets.
- Root configuration is selected by topology, not agent-array order.
- Hierarchical mode/definition mismatch fails before workflow execution.

### Runtime and streaming

- Root sees only direct children.
- Nested manager sees only its direct children.
- Child result returns up both levels.
- All configured capability categories selected in Phase 0 remain usable.
- Child exception and cancellation terminate cleanly.
- Events and tool activities carry the actual actor ID/name.
- Only root final text becomes the assistant answer.
- Existing `auto`, `manual`, and `mono` tests remain unchanged and pass.

### Frontend

- Non-manager node has no source handle and cannot create an outgoing edge.
- Root crown depends only on null parent.
- Unsafe Set-as-root action is unavailable.
- Local edge/member mutations do not leave stale child indicators.
- Backend execution errors are localized and visible.

## 9. Verification Commands

Run the narrow checks first, then package builds.

```powershell
# Backend
npm test -- --runInBand src/modules/team/team.service.spec.ts src/modules/conversation/controllers/message.controller.spec.ts src/modules/conversation/services/conversation-agent-request.builder.spec.ts src/modules/conversation/services/stream.service.spec.ts src/modules/agent/agent.service.spec.ts
npm run build

# Frontend
npm test -- src/modules/team
npm run build

# ADK, always in the required Conda environment
conda run -n meta python -m pytest tests/test_engines/test_multi_agent/test_workflow_processor.py tests/test_engines/test_multi_agent/test_hierarchical_team.py

# Proto regeneration from yellowstorm-adk
conda run -n meta python grpc/generate_proto.py
```

Also compare the two `chatbot.proto` files after the change and run one deterministic end-to-end gRPC test for `Root manager -> Nested manager -> Executor`.

## 10. Completion Criteria

The feature is complete when:

- One explicit Team reaches ADK with its exact authored topology.
- NestJS and ADK independently reject malformed or oversized trees before an LLM call.
- The root and every parent are manager-slug agents; active non-manager types work as leaves.
- No default manager is inserted and no nested manager is discarded.
- Each manager can invoke only direct children.
- Existing agent capabilities survive the selected runtime mechanism.
- Nested output returns to the root, and only the root emits final assistant text.
- Activity and tool events identify their real actors.
- Shared-Team authorization and capability access are covered by tests.
- Retry/regenerate/corrective replay preserve and reauthorize `teamId`.
- Existing direct-agent and flat multi-agent paths pass unchanged.
- Browser QA passes for Team editing on desktop and mobile with no console or network regressions.

## 11. Deferred Work

- Sticky Team routing across unmentioned follow-up turns.
- Immutable historical Team snapshots and Team versioning.
- Auto Builder generation constrained to executable hierarchies.
- Atomic reroot-path reversal.
- Multiple Teams or Team plus standalone-agent composition.
- Per-edge prompts, schemas, policies, or conditional routing.
- A second runtime implementation after one mechanism is selected.
