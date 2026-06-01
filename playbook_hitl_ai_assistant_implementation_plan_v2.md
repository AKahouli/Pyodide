# Playbook Smart HITL + Blocker Management + HITL Memory Implementation Plan v2

**Repository scope:** `YellowsysOrg/YellowStorm-poc` only  
**Requested branch:** `aga-playbook-005`  
**Inspected snapshot:** latest merged PR #59 head commit `ac11e0dc4b10c800e32280401cfd6cb1e1ab243c`  
**Updated focus:** make HITL business-user friendly by enabling Smart HITL by default, adding workflow/node blocker management, updating hardcoded prompts, adding HITL Memory and feedback scope, and making HITL reusable by Replay.

---

## 1. Updated product direction

The current implementation treats HITL mostly as explicit node settings:

- `allowClarification`
- `interruptBefore`
- `interruptAfter`
- a dedicated `human_approval` node

That is acceptable for technical workflow designers, but it is not the right default for business users. Business users expect the agent to pause by itself when continuing would be unsafe, ambiguous, wasteful, or likely to produce useless downstream work.

The target behavior should be:

> Smart HITL is enabled by default. Agents continue automatically unless they detect a blocker: missing information, missing documents, ambiguous instructions, risky side effects, external sends, destructive actions, low confidence, explicit approval instructions, or other user-defined blocker rules.

The user should not have to know in advance where every clarification or approval gate belongs. Instead, YellowStorm should provide:

1. **Smart HITL default behavior** for every node.
2. **A business-friendly Blocker Management UI** to configure when agents must pause.
3. **Run-mode HITL assistant cards** that explain why the run paused and what will happen next.
4. **Feedback scope controls** so users decide whether feedback applies only to the current step, downstream steps, the current run, future node runs, or the whole workflow.
5. **HITL Memory** so accepted human feedback becomes reusable knowledge with user consent.
6. **Replay-aware HITL** so interventions become part of validated behavior instead of being lost as transient chat.

---

## 2. Current implementation recap

### 2.1 Existing frontend state

Current frontend types already contain useful primitives:

- `PlaybookTask.interruptBefore`
- `PlaybookTask.interruptAfter`
- `PlaybookTask.allowClarification`
- `PlaybookTask.humanApprovalConfig`
- `PlaybookExecution.interruptPayload`
- `PlaybookExecution.waitingForHumanInput`
- `PlaybookExecution.currentInterruptId`
- `PlaybookExecution.currentInterruptTaskId`
- `PlaybookExecution.hitlHistory`
- `HumanFeedbackData`
- `HitlHistoryEntry`

Relevant files:

- `YellowStorm/front/src/modules/playbook/types.ts`
- `YellowStorm/front/src/modules/playbook/store.ts`
- `YellowStorm/front/src/modules/playbook/components/PlaybookNodeEditor.tsx`
- `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- `YellowStorm/front/src/modules/playbook/components/InterruptDialog.tsx`
- `YellowStorm/front/src/modules/playbook/components/PlaybookHumanApprovalConfigSection.tsx`

Current issue: the default node editor draft sets explicit HITL toggles to `false`. This means business users get no clarification or approval unless they deliberately configure it.

### 2.2 Existing backend state

Current backend execution schema supports `pendingApproval`, `threadId`, execution statuses, and a gRPC `ResumeApproval` API.

Relevant files:

- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-execution.schema.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-stream-events.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow-execution.controller.ts`
- `YellowStorm/back/src/modules/playbook-flow/proto/playbook-flow.proto`

Current issue: `PendingApproval` is minimal. It stores only node, iteration, prompt, and requested date. It does not persist blocker reason, risk level, full interrupt payload, feedback scope, downstream impact, or memory decisions.

### 2.3 Existing ADK runtime

Current ADK step HITL already supports:

- clarification before execution,
- approval before execution,
- clarification after execution,
- review after execution,
- skip/reject/reply/approve actions,
- `hitl_checkpoint` for post-execution resume.

Relevant files:

- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- `yellowstorm-adk/src/flow_engine/nodes/step_hitl.py`
- `yellowstorm-adk/src/flow_engine/nodes/step_hitl_handlers.py`
- `yellowstorm-adk/src/flow_engine/nodes/human_approval.py`
- `yellowstorm-adk/src/flow_engine/grpc_service.py`
- `yellowstorm-adk/src/flow_engine/state.py`
- `yellowstorm-adk/src/flow_engine/runtime/events.py`
- `yellowstorm-adk/src/flow_engine/runtime/checkpointer.py`

Current issue: step HITL only activates when metadata flags exist. Smart agent-estimated HITL is not first-class yet.

---

## 3. LangGraph constraints to preserve

Smart HITL must stay LangGraph-correct:

1. `interrupt()` is the dynamic runtime primitive for asking for human input.
2. Interrupt payloads must be JSON-serializable.
3. A durable checkpointer is required for production.
4. Resume must use the same `thread_id`.
5. Resume payload must be passed through `Command(resume=...)`.
6. Code before `interrupt()` can run again after resume, so side effects before interrupts must be idempotent.
7. Multiple parallel interrupts need stable interrupt IDs and resume maps.
8. Replay can re-trigger interrupts when replaying after a checkpoint, so YellowStorm must decide when to reuse prior HITL memory and when to ask again.

---

## 4. Target model: Smart HITL policy

Add a first-class policy object at workflow and node level.

### 4.1 Backend schema proposal

Add to `Flow` and `FlowNode.metadata` or a typed subdocument on `FlowNode`:

```ts
export type HitlMode = 'auto' | 'manual' | 'off';
export type HitlSensitivity = 'minimal' | 'balanced' | 'strict';
export type HitlFeedbackDefaultScope =
  | 'step_only'
  | 'downstream_run'
  | 'entire_run'
  | 'future_node_runs'
  | 'future_workflow_runs';

export interface HitlPolicy {
  mode: HitlMode;
  sensitivity: HitlSensitivity;
  clarificationEnabled: boolean;
  approvalEnabled: boolean;
  reviewEnabled: boolean;
  propagateFeedbackDefault: boolean;
  defaultFeedbackScope: HitlFeedbackDefaultScope;
  inheritedFromWorkflow?: boolean;
  disabledReason?: string | null;
}
```

Default for new workflows and new nodes:

```ts
{
  mode: 'auto',
  sensitivity: 'balanced',
  clarificationEnabled: true,
  approvalEnabled: true,
  reviewEnabled: false,
  propagateFeedbackDefault: true,
  defaultFeedbackScope: 'downstream_run'
}
```

### 4.2 Legacy compatibility

Existing fields should remain during migration:

- `allowClarification`
- `interruptBefore`
- `interruptAfter`
- `humanApprovalConfig`

Compatibility rule:

```ts
if legacy flags are explicitly true:
  hitlPolicy.mode = 'manual'
else if hitlPolicy missing:
  hitlPolicy.mode = 'auto'
```

Do not delete legacy fields immediately. Use them as advanced overrides and remove later after migration.

---

## 5. Target model: blocker catalog

A blocker is a condition that tells the agent/runtime when it must pause.

### 5.1 Blocker schema

```ts
export type HitlBlockerKind =
  | 'missing_required_input'
  | 'missing_document'
  | 'ambiguous_instruction'
  | 'destructive_action'
  | 'external_send'
  | 'workspace_write'
  | 'sensitive_domain'
  | 'low_confidence'
  | 'cost_or_runtime_risk'
  | 'explicit_user_instruction'
  | 'custom';

export type HitlBlockerAction = 'clarify' | 'approve' | 'review' | 'stop';
export type HitlBlockerScope = 'workflow' | 'node';
export type HitlBlockerMatcherType =
  | 'deterministic'
  | 'tool_action'
  | 'input_binding'
  | 'llm_judge'
  | 'custom_expression';

export interface HitlBlockerRule {
  id: string;
  scope: HitlBlockerScope;
  nodeId?: string | null;
  enabled: boolean;
  kind: HitlBlockerKind;
  label: string;
  description: string;
  action: HitlBlockerAction;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  sensitivity: 'minimal' | 'balanced' | 'strict';
  matcherType: HitlBlockerMatcherType;
  matcherConfig: Record<string, unknown>;
  promptTemplate?: string | null;
  appliesToToolNames?: string[];
  appliesToConnectorActions?: string[];
  createdBy: 'system' | 'user' | 'assistant';
  createdAt: Date;
  updatedAt: Date;
}
```

### 5.2 Default blocker rules

Seed default blockers at admin/workflow level:

| Blocker | Default | Action | Risk | Description |
|---|---:|---|---|---|
| Missing required input | On | Clarify | High | Required input resolves to null/empty. |
| Missing document/file | On | Clarify | High | Task references a document/file that is unavailable. |
| Ambiguous instruction | On | Clarify | Medium | Agent cannot choose one safe interpretation. |
| Destructive action | On | Approve | Critical | Delete, overwrite, revoke, purge. |
| External send/share | On | Approve | Critical | Email, external API send, share, publish. |
| Workspace write | On | Approve or Review | Medium | Create/update workspace artifacts. |
| Sensitive domain | On | Approve | High | Legal, HR, finance, security, compliance. |
| Low confidence | Balanced+ | Clarify or Review | Medium | Agent confidence below policy threshold. |
| Cost/runtime risk | Strict | Approve | Medium | Large batch, many documents, long-running action. |
| Explicit instruction | On | Clarify/Approve | High | Task description says “ask before”, “confirm with me”, etc. |

### 5.3 Custom blocker examples

Business users should be able to add blockers from the UI without writing code:

- “Ask before sending anything to a customer.”
- “Ask if the contract is not signed.”
- “Ask if the invoice total is above 10,000 EUR.”
- “Ask before using a document marked draft.”
- “Require review before publishing a report.”

Internally these become structured rules with an LLM matcher or deterministic matcher.

---

## 6. Blocker Management UI

Add a dedicated UI named **HITL & Blockers**.

### 6.1 Workflow-level UI

Location options:

- Playbook settings drawer: `PlaybookFlowSettingsDrawer.tsx`
- Canvas toolbar menu
- New right-side panel tab: “HITL & Blockers”

Recommended design:

```text
Smart HITL
[ On ]  Sensitivity: [ Balanced v ]

Default behavior
[x] Ask when required data is missing
[x] Ask when documents are missing or ambiguous
[x] Ask before destructive actions
[x] Ask before external sends/shares
[x] Ask when confidence is low
[x] Apply user feedback to downstream steps by default

Blockers
[ Missing required input        Clarify   Workflow   On ]
[ External send/share           Approve   Workflow   On ]
[ Contract not signed           Clarify   Custom     On ]

[ + Add blocker ]
```

### 6.2 Node-level UI

In `PlaybookNodeEditor.tsx`, replace the primary advanced toggles with a business-friendly summary:

```text
Smart HITL for this step
[ Inherit from workflow: On ]

The agent may pause this step when required information is missing or approval is needed.

[ Configure step blockers ]
```

Advanced section:

```text
Advanced HITL rules
[ ] Always ask before this step
[ ] Always review after this step
[ ] Allow clarification questions
Max clarifications: [2]
```

### 6.3 Add blocker dialog

Fields:

```text
Blocker name
When should the workflow pause?
  [natural language description]

Action
  ( ) Ask for clarification
  ( ) Ask for approval
  ( ) Ask for review
  ( ) Stop branch

Applies to
  ( ) All workflow nodes
  ( ) Current node only
  ( ) Selected nodes

Severity
  Low / Medium / High / Critical

Ask message template, optional
  [textarea]

[Save blocker]
```

After save, call backend to normalize into a structured `HitlBlockerRule`.

### 6.4 Quick disable in run-mode HITL UI

Every interrupt card should expose:

- “Do not ask again for this run”
- “Disable this blocker for this step”
- “Disable Smart HITL for this node”
- “Save this as a workflow rule”

This satisfies the requirement that users can quickly disable auto-interrupt from HITL UI and node edit UI.

---

## 7. HITL run-mode assistant UX

Each HITL card should include:

1. **Why I paused**
   - blocker label,
   - reason code,
   - risk level,
   - confidence,
   - source evidence.

2. **What I need from you**
   - one clear question or approval request.

3. **What happens next**
   - downstream affected nodes,
   - branch behavior if approved/rejected/skipped,
   - whether feedback will be propagated.

4. **Recommended response**
   - optional assistant suggestion, never auto-approved for high-risk actions.

5. **Feedback scope selector**
   - this step only,
   - downstream steps in this run,
   - all remaining branches in this run,
   - future runs of this node,
   - future runs of this workflow.

6. **Memory checkbox**
   - “Remember this for future runs” disabled by default for sensitive approvals.

### 7.1 Recommended default scope

Default scope should be:

```text
Downstream steps in this run
```

The UI must explicitly tell the user:

> Your answer will be added to the workflow context and considered by downstream agents.

For destructive/external approvals, default scope should be:

```text
This action only
```

Approvals should not become future reusable memory unless explicitly saved.

---

## 8. HITL Memory model

HITL Memory should be separated into four layers.

### 8.1 Execution HITL audit trail

Immutable per-execution event log.

Purpose:

- compliance,
- debugging,
- Replay analysis,
- user trust.

Schema:

```ts
export interface HitlEventLog {
  id: string;
  executionId: string;
  flowId: string;
  nodeId: string;
  iteration: number;
  interruptId: string;
  type: 'clarification' | 'approval_request' | 'review_request';
  blockerRuleId?: string | null;
  blockerKind?: string | null;
  reasonCode: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  prompt: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'answered' | 'expired' | 'cancelled';
  response?: HitlResponse | null;
  downstreamNodeIds: string[];
  createdAt: Date;
  respondedAt?: Date | null;
}
```

### 8.2 Run-scoped human context

This is the most important layer for your feedback requirement.

Add to ADK `ExecutionState`:

```py
human_context: Annotated[list[dict[str, Any]], append]
```

Each entry:

```json
{
  "id": "hitl-ctx-...",
  "source_node_id": "contract_review",
  "interrupt_id": "contract_review:clarification:1",
  "scope": "downstream_run",
  "message": "Use the signed May 2026 contract, not the draft.",
  "applies_to_node_ids": ["risk_summary", "client_response"],
  "created_at": "..."
}
```

Downstream prompt builders must include a section:

```text
Human guidance from earlier workflow steps:
- Use the signed May 2026 contract, not the draft.

Follow this guidance when it is relevant to your task. If it conflicts with your task instructions, pause for clarification instead of guessing.
```

### 8.3 Playbook memory

Optional, user-approved, persistent memory attached to workflow or node.

Examples:

- “For this playbook, always use signed documents over drafts.”
- “For this node, ask before sending external client messages.”
- “Legal summaries must be reviewed by a human before completion.”

Schema:

```ts
export interface HitlMemory {
  id: string;
  ownerId: string;
  flowId: string;
  nodeId?: string | null;
  memoryType: 'semantic' | 'episodic' | 'procedural' | 'approval_policy';
  source: 'hitl_feedback' | 'blocker_rule' | 'replay_validation' | 'manual';
  title: string;
  content: string;
  normalizedInstruction: string;
  appliesTo: 'node' | 'workflow' | 'agent' | 'workspace';
  status: 'active' | 'draft' | 'archived';
  sensitivity: 'normal' | 'sensitive';
  createdFromExecutionId?: string;
  createdFromInterruptId?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 8.4 Replay HITL memory

Replay needs its own projection of HITL data.

When a replay baseline is captured, also capture:

- interrupt reason,
- user answer,
- selected feedback scope,
- downstream nodes affected,
- whether the answer changed output,
- whether it is reusable,
- fingerprint of context at the time of answer.

Schema extension:

```ts
export interface ReplayHitlMemorySnapshot {
  interruptId: string;
  nodeId: string;
  iteration: number;
  type: 'clarification' | 'approval_request' | 'review_request';
  blockerKind: string;
  reasonCode: string;
  prompt: string;
  responseAction: string;
  responseMessage: string | null;
  responseScope: string;
  downstreamNodeIds: string[];
  reusableInReplay: boolean;
  contextFingerprint: string;
}
```

---

## 9. Feedback scope rules

### 9.1 Scope semantics

| Scope | Runtime behavior | Persisted? | Replay behavior |
|---|---|---:|---|
| `step_only` | Applies only to current interrupted node. | Execution log only | Used only for that replayed node. |
| `downstream_run` | Adds guidance to downstream nodes after source node. | Execution log + state | Reused if context fingerprint matches or Replay mode allows adaptive use. |
| `entire_run` | Adds guidance to all remaining runnable nodes. | Execution log + state | Same as downstream but broader. |
| `future_node_runs` | Creates draft/active node memory after user confirms. | Yes | Used as node procedural memory. |
| `future_workflow_runs` | Creates workflow-level memory after user confirms. | Yes | Used in future live/replay runs. |

### 9.2 Sensitive approval rule

For destructive/external side effects:

- default scope must be `step_only`,
- memory checkbox must be off,
- reusable approval must require explicit confirmation,
- replay must not auto-approve unless the context fingerprint matches and the blocker rule allows reusable approval.

---

## 10. Replay integration

HITL and Replay should reinforce each other.

### 10.1 Replay baseline capture

When saving a validated replay baseline, include:

- HITL events for that execution/task,
- human context entries visible to the task,
- whether the task output depended on human feedback,
- memory snapshots active during the run,
- blocker rules that triggered or did not trigger.

### 10.2 Replay run behavior

#### Strict replay

- Reuse human feedback only if context fingerprint matches.
- If a required HITL response was part of the baseline but context changed, block with reason `hitl_context_drift`.
- Do not silently skip approvals.
- Re-trigger approval for side effects unless approval memory is explicitly reusable.

#### Flex replay

- Use HITL memories as guidance.
- Re-ask if the blocker condition is still present and memory is not marked reusable.
- Include HITL drift in replay report.

#### Adaptive replay

- Use HITL memories as semantic and procedural hints.
- If current inputs differ, ask for confirmation before applying old feedback to high-impact outputs.

### 10.3 Replay reports

Extend replay reports with:

```ts
hitlSummary: {
  baselineHitlCount: number;
  runtimeHitlCount: number;
  reusedMemoryCount: number;
  newClarificationCount: number;
  approvalReaskedCount: number;
  hitlContextDrift: boolean;
  findings: Array<{
    severity: 'info' | 'warning' | 'fail';
    message: string;
    nodeId: string;
  }>;
}
```

### 10.4 Replay UX

In the Replay panel, show:

- “This replay reused 2 human clarifications.”
- “Approval was re-asked because the recipient changed.”
- “Output changed because user feedback scope was downstream_run.”
- “Suggested memory: save clarification as node instruction.”

---

## 11. Prompt update requirements

This is mandatory. Smart HITL will fail if prompts still tell agents only to “complete the task” without defining when to pause.

### 11.1 Backend prompt seeds to update

File:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts`

Update these prompt templates:

1. `intent.analyze`
   - Add blocker and HITL policy awareness.
   - Allow suggestions to include HITL policy patches and blocker rules.
   - Ask the model to suggest blockers when the user intent implies risk, missing data, external actions, or compliance.

2. `playbook.generate`
   - Generated workflows should include default Smart HITL and blocker hints.

3. `task.system`
   - Agents must know they are allowed and expected to pause when blocked.

4. `task.clarification`
   - Replace generic “If you need clarification…” with blocker-aware instructions.

5. `replay.final_synthesis`
   - Include HITL memory/context used during replay.

6. `replay.adaptive_tool_args`
   - Respect reusable HITL memory but never reuse unsafe approvals blindly.

7. `judge.node_reflection`
   - Evaluate whether the step should have asked for clarification or approval.

8. `judge.execution_summary`
   - Summarize HITL value and suggest blocker/memory improvements.

9. `judge.optimize_step`
   - When optimizing a step, preserve or improve HITL policy and blocker hints.

10. `playbook.generation_new`
    - Generate FlowSnapshot with Smart HITL defaults and optional blocker policy metadata.

### 11.2 New prompt templates to add

Add built-in prompt keys:

```ts
hitl.blocker.detect
hitl.blocker.normalize
hitl.interrupt.explain
hitl.resume.normalize
hitl.memory.extract
hitl.memory.summarize
hitl.replay.reuse_policy
hitl.post_run.suggestions
```

#### `hitl.blocker.detect`

Purpose: decide if a node should pause.

Inputs:

- node title/description,
- resolved inputs,
- expected output contract,
- tool/action request,
- blocker catalog,
- active memories,
- replay mode,
- sensitivity.

Output JSON:

```json
{
  "shouldInterrupt": true,
  "type": "clarification",
  "reasonCode": "missing_document",
  "riskLevel": "high",
  "confidence": 0.91,
  "message": "Which signed contract should I use?",
  "suggestedChoices": [],
  "downstreamImpact": ["risk_summary", "client_response"],
  "memoryCandidate": false
}
```

#### `hitl.resume.normalize`

Purpose: map free-text user replies into typed resume payloads.

Output JSON:

```json
{
  "action": "reply",
  "message": "Use the signed May 2026 contract.",
  "approved": null,
  "reason": null,
  "feedback": "Use the signed May 2026 contract.",
  "scope": "downstream_run",
  "remember": false
}
```

#### `hitl.memory.extract`

Purpose: propose memory candidates after a HITL response.

Output JSON:

```json
{
  "shouldRemember": true,
  "memoryType": "procedural",
  "title": "Prefer signed contracts",
  "normalizedInstruction": "For contract-related tasks, use signed versions over drafts unless the user says otherwise.",
  "appliesTo": "workflow",
  "sensitivity": "normal"
}
```

### 11.3 ADK hardcoded prompt builders to update

Files:

- `yellowstorm-adk/src/flow_engine/nodes/step_prompt.py`
- `yellowstorm-adk/src/flow_engine/nodes/step_hitl.py`
- `yellowstorm-adk/src/flow_engine/nodes/step_hitl_handlers.py`

Add prompt sections:

```text
Smart HITL policy:
{{hitl_policy_json}}

Active blocker rules:
{{blocker_rules_json}}

Human guidance from earlier workflow steps:
{{human_context_json}}

Reusable HITL memory:
{{hitl_memory_json}}
```

Add mandatory instruction:

```text
If a blocker applies, do not guess and do not continue blindly. Request the appropriate HITL action using the runtime HITL mechanism. If the blocker is missing data or ambiguity, ask one concise clarification. If the blocker is a destructive/external side effect, request approval before executing the side effect. If the user provided earlier human guidance, apply it to this step when relevant; if it conflicts with current instructions, pause for clarification.
```

### 11.4 Prompt versioning

Every updated built-in prompt must bump `version`.

Suggested versions:

- `intent.analyze`: v4
- `task.system`: v2
- `task.clarification`: v2
- `judge.node_reflection`: v3
- `judge.execution_summary`: v2
- `judge.optimize_step`: v2
- `replay.final_synthesis`: v2
- `replay.adaptive_tool_args`: v2
- `playbook.generation_new`: v2

Add migration logic that updates built-in prompts only when they are still built-in and not user-customized.

---

## 12. Backend implementation plan

### Phase B1 — schema and migration

Add schemas:

- `playbook-flow-hitl-blocker.schema.ts`
- `playbook-flow-hitl-event.schema.ts`
- `playbook-flow-hitl-memory.schema.ts`

Extend:

- `playbook-flow.schema.ts` with workflow `hitlPolicy` and blocker settings.
- `FlowNode` with `hitlPolicy` or `metadata.hitlPolicy`.
- `playbook-flow-execution.schema.ts` with `pendingInterrupts`, `hitlEvents`, or references to a separate collection.
- `PendingApproval` to include full interrupt payload and scope.

Migration:

- For flows without `hitlPolicy`, set workflow policy to Smart HITL auto/balanced.
- For nodes without policy, set inherit.
- Preserve existing manual flags.
- Add feature flag to allow staged rollout if needed: `playbook-flow.smartHitlDefaultEnabled`.

### Phase B2 — blocker service

Create:

- `playbook-flow-hitl-blocker.service.ts`
- `playbook-flow-hitl-memory.service.ts`
- `playbook-flow-hitl-context.service.ts`
- `playbook-flow-hitl-prompt.service.ts`

Responsibilities:

- resolve workflow + node HITL policy,
- resolve blocker rules,
- evaluate deterministic blockers,
- call LLM blocker detection when needed,
- normalize custom blocker definitions,
- store interrupt events,
- convert HITL responses into memory candidates.

### Phase B3 — APIs

Add endpoints:

```http
GET    /playbooks/:flowId/hitl/policy
PATCH  /playbooks/:flowId/hitl/policy
GET    /playbooks/:flowId/hitl/blockers
POST   /playbooks/:flowId/hitl/blockers
PATCH  /playbooks/:flowId/hitl/blockers/:blockerId
DELETE /playbooks/:flowId/hitl/blockers/:blockerId
POST   /playbooks/:flowId/hitl/blockers/normalize

GET    /playbooks/:flowId/nodes/:nodeId/hitl/policy
PATCH  /playbooks/:flowId/nodes/:nodeId/hitl/policy

GET    /executions/:executionId/hitl/events
GET    /executions/:executionId/hitl/pending
POST   /executions/:executionId/hitl/:interruptId/resume
POST   /executions/:executionId/hitl/:interruptId/disable-blocker

GET    /playbooks/:flowId/hitl/memories
POST   /playbooks/:flowId/hitl/memories
PATCH  /playbooks/:flowId/hitl/memories/:memoryId
DELETE /playbooks/:flowId/hitl/memories/:memoryId
```

Keep existing `resume-approval` as a compatibility wrapper.

### Phase B4 — SSE events

Add event types:

```ts
playbook_hitl_interrupt_created
playbook_hitl_interrupt_updated
playbook_hitl_interrupt_resolved
playbook_hitl_memory_suggested
playbook_hitl_memory_saved
playbook_hitl_blocker_disabled
playbook_hitl_policy_updated
playbook_replay_hitl_summary_updated
```

Existing `playbook_interrupt` can remain for compatibility.

---

## 13. ADK implementation plan

### Phase A1 — state changes

Update `ExecutionState`:

```py
human_context: Annotated[list[dict[str, Any]], append]
hitl_events: Annotated[list[dict[str, Any]], append]
hitl_policy: dict[str, Any]
hitl_blockers: list[dict[str, Any]]
hitl_memory: list[dict[str, Any]]
```

### Phase A2 — request contract

Extend gRPC `RunRequest` or snapshot metadata to include:

- workflow HITL policy,
- node HITL policies,
- blocker rules,
- active HITL memory,
- replay HITL memory.

If proto changes are expensive, encode under `snapshot.settings` or per-node `metadata` first, then formalize proto later.

### Phase A3 — blocker detection before execution

Before `_execute_step`, run deterministic checks:

- missing required input,
- null/empty bound input,
- missing expected document/file,
- explicit approval instruction detected in description,
- action node mapped to destructive/external operation.

Then optionally run `hitl.blocker.detect` LLM check for ambiguity/low confidence.

If blocker triggers, emit `NodeSuspended` with richer payload:

```json
{
  "type": "clarification",
  "reason_code": "missing_document",
  "blocker_rule_id": "...",
  "risk_level": "high",
  "message": "Which signed contract should I use?",
  "task_description": "...",
  "downstream_node_ids": ["..."],
  "feedback_scope_default": "downstream_run",
  "resumable_actions": ["reply", "skip", "disable_blocker"]
}
```

### Phase A4 — approval inside tools

For destructive/external connector actions, implement LangGraph interrupts inside tool wrappers where possible.

This is safer than relying only on node-level descriptions because the actual risky operation is known at tool-call time.

Examples:

- send email,
- delete document,
- share/publish,
- write to workspace,
- call external webhook/API.

### Phase A5 — resume handling

Normalize resume payload:

```py
{
  "action": "reply|approve|reject|skip|disable_blocker",
  "message": "...",
  "feedback": "...",
  "reason": "...",
  "approved": true,
  "scope": "downstream_run",
  "remember": false,
  "interrupt_id": "..."
}
```

If scope is downstream/run, append to `human_context`.

If action is disable blocker, emit a command response to backend so backend updates policy/blocker state.

### Phase A6 — downstream prompt injection

Update `step_prompt.py` to inject:

- applicable human context,
- active workflow/node memory,
- HITL policy,
- Replay HITL memory when in replay mode.

### Phase A7 — durable resume

Current active-execution map is not enough for long-lived HITL. Add a durable resume path:

- backend persists `threadId = executionId`,
- ADK can recreate graph from stored snapshot,
- ADK can invoke `Command(resume=...)` with same thread ID even after process restart,
- backend can continue streaming events after resume.

---

## 14. Frontend implementation plan

### Phase F1 — types

Update `types.ts` with:

- `HitlPolicy`
- `HitlBlockerRule`
- `HitlEventLog`
- `HitlMemory`
- `HitlFeedbackScope`
- `HitlInterruptPayload` extended fields
- `ReplayHitlSummary`

### Phase F2 — API client

Update `api.ts` with blocker/policy/memory APIs.

Add:

```ts
getHitlPolicy(flowId)
updateHitlPolicy(flowId, patch)
getHitlBlockers(flowId)
createHitlBlocker(flowId, data)
normalizeHitlBlocker(flowId, naturalLanguageRule)
updateHitlBlocker(flowId, blockerId, patch)
deleteHitlBlocker(flowId, blockerId)
getHitlMemories(flowId)
saveHitlMemory(flowId, data)
resumeHitlInterrupt(executionId, interruptId, payload)
```

### Phase F3 — store

Update `store.ts`:

- keep blocker catalog in state,
- keep pending HITL events in execution cache,
- support multiple pending interrupts,
- apply feedback scope optimistically,
- handle HITL memory suggested/saved events,
- handle blocker disable events.

### Phase F4 — Blocker Center UI

Create components:

- `HitlBlockerCenter.tsx`
- `HitlBlockerRuleCard.tsx`
- `HitlBlockerEditorDialog.tsx`
- `HitlPolicySummaryCard.tsx`
- `HitlMemoryPanel.tsx`

### Phase F5 — Node Editor UI

Update `PlaybookNodeEditor.tsx`:

- replace default HITL toggles with Smart HITL summary,
- add “Configure step blockers”,
- keep advanced toggles in collapsed expert section,
- add fast node-level disable.

### Phase F6 — Run-mode assistant

Update `PlaybookDesignerPanel.tsx`:

- make interrupt mode the primary HITL UI,
- show why paused,
- show downstream impact,
- show feedback scope selector,
- show memory checkbox,
- support suggested choices,
- support disable blocker actions,
- support multiple pending interrupt queue.

`InterruptDialog.tsx` can become a fallback or compact quick action UI.

---

## 15. Design-mode AI suggestions

Update intent suggestions to support HITL/blocker changes.

### 15.1 Extend intent operation types

Add:

```ts
'update_hitl_policy'
'create_blocker_rule'
'update_blocker_rule'
'delete_blocker_rule'
'create_hitl_memory'
```

### 15.2 Design assistant examples

User says:

> “Make sure legal reviews all client responses before they are sent.”

Assistant suggestion:

- add `external_send` blocker,
- action = approval,
- scope = workflow,
- risk = critical,
- apply to nodes with external send tools.

User says:

> “If the contract is unsigned, ask me which document to use.”

Assistant suggestion:

- add custom blocker,
- matcher = LLM judge or document metadata rule,
- action = clarification,
- scope = workflow or selected node.

---

## 16. Testing plan

### 16.1 Backend tests

Add tests for:

- default Smart HITL policy migration,
- blocker CRUD,
- blocker normalization,
- deterministic blocker evaluation,
- pending interrupt persistence,
- multiple interrupts,
- resume with feedback scope,
- memory suggestion creation,
- disabled blocker behavior,
- Replay HITL summary.

### 16.2 ADK tests

Add tests for:

- missing input triggers clarification by default,
- destructive tool triggers approval,
- explicit “ask before” in description triggers approval,
- feedback becomes downstream `human_context`,
- downstream node prompt receives human context,
- `step_only` feedback does not leak downstream,
- replay strict reuses only matching HITL memory,
- replay reasks approval when context changes,
- process restart/durable resume.

### 16.3 Frontend tests

Add tests for:

- workflow blocker center toggles,
- node-level blocker override,
- add custom blocker flow,
- quick disable from HITL card,
- feedback scope selector,
- memory checkbox,
- multiple pending interrupts,
- replay HITL summary rendering.

---

## 17. Rollout plan

### Phase 0 — shadow mode

Add Smart HITL detection in shadow mode:

- do not interrupt,
- log what would have triggered,
- collect false-positive examples.

### Phase 1 — Smart HITL for deterministic blockers

Enable only:

- missing required input,
- missing document,
- destructive/external tool approval.

### Phase 2 — business UI

Release Blocker Center and node Smart HITL UI.

### Phase 3 — LLM-estimated blockers

Enable ambiguity and low-confidence blocker detection under Balanced/Strict sensitivity.

### Phase 4 — HITL Memory

Enable execution-scoped human context first. Then add user-approved persistent memory.

### Phase 5 — Replay integration

Capture HITL memory in validated replay baselines and replay reports.

### Phase 6 — optimization loop

After runs, assistant suggests:

- add blocker rule,
- save memory,
- update node description,
- add required input port,
- add missing data binding,
- convert repeated HITL into permanent workflow design.

---

## 18. Final UX target

The final experience should feel like this:

1. Business user runs a workflow.
2. Agent reaches a step with missing or risky information.
3. Workflow assistant pauses and says why.
4. User answers once and chooses feedback scope.
5. Downstream agents use the answer automatically.
6. Workflow completes.
7. Replay records the human intervention.
8. Assistant suggests saving the lesson as a blocker, memory, or design improvement.

This makes HITL a complementary killer feature next to Replay:

- Replay makes successful workflow behavior repeatable.
- Smart HITL makes uncertain workflow behavior safe and recoverable.
- HITL Memory turns user supervision into reusable workflow intelligence.

