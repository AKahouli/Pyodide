# Playbook HITL Remaining Steps

This file lists the remaining work to process from [playbook_hitl_ai_assistant_implementation_plan_v2.md](C:/prog/YellowStorm-poc/playbook_hitl_ai_assistant_implementation_plan_v2.md), based on the current repository state.

Assumption:
- Recently completed and therefore excluded from this remaining list: HITL auto-open after refresh, HITL thread persistence after submit, clarification follow-up suppression after `Ignore` / limit-reached, and the chat-thread label cleanup in the run sidebar.

## Remaining sections from the implementation plan

### 6. Blocker Management UI

- Finish end-to-end validation of the workflow-level `HITL & Blockers` UI.
- Verify the node-level Smart HITL summary and override behavior against backend policy persistence.
- Verify the add-blocker dialog flow, especially normalization from natural language into backend blocker rules.
- Verify quick disable actions from the run-mode HITL UI:
  - `Do not ask again for this run`
  - `Disable this blocker for this step`
  - `Disable Smart HITL for this node`
  - `Save this as a workflow rule`

### 7. HITL run-mode assistant UX

- Complete the business-user UX polish pass for the HITL sidebar so it feels like a clean copilot conversation.
- Re-check that every interrupt shows:
  - why the workflow paused
  - what the user needs to answer
  - what happens next
  - downstream impact
  - feedback scope
  - memory consent
- Validate multi-interrupt queue handling in real browser runs.

### 8. HITL Memory model

- Verify execution HITL audit trail persistence and retrieval end to end.
- Finish run-scoped `human_context` propagation checks across downstream nodes.
- Finish persistent playbook/node HITL memory flows:
  - create
  - save
  - update
  - archive/delete
- Finish Replay HITL memory snapshot support and its persistence model.

### 9. Feedback scope rules

- Verify runtime semantics for all scopes:
  - `step_only`
  - `downstream_run`
  - `entire_run`
  - `future_node_runs`
  - `future_workflow_runs`
- Verify sensitive approval defaults:
  - default scope is `step_only`
  - memory checkbox is off
  - reusable approval requires explicit confirmation
  - replay does not auto-approve unless fingerprint/rule conditions allow it

### 10. Replay integration

- Finish HITL baseline capture in replay data.
- Finish strict/flex/adaptive replay behavior around reused HITL feedback and context drift.
- Finish replay HITL summary/report generation.
- Finish replay UX surfacing:
  - reused clarifications
  - re-asked approvals
  - downstream impact of prior feedback
  - suggested memory creation

### 11. Prompt update requirements

- Verify all required backend built-in prompt seeds are updated and versioned as planned.
- Verify the new HITL prompt keys exist and are actually consumed:
  - `hitl.blocker.detect`
  - `hitl.blocker.normalize`
  - `hitl.interrupt.explain`
  - `hitl.resume.normalize`
  - `hitl.memory.extract`
  - `hitl.memory.summarize`
  - `hitl.replay.reuse_policy`
  - `hitl.post_run.suggestions`
- Verify prompt migration/version bump behavior for non-customized built-ins.

### 12. Backend implementation plan

- Re-check B1-B4 completion against real API usage, not only code presence:
  - schema and migration behavior
  - blocker/memory/context/prompt services
  - HITL policy/blocker/memory APIs
  - SSE event coverage
- Validate contract consistency across frontend, backend, and ADK for all HITL fields.

### 13. ADK implementation plan

- Re-check durable resume behavior after ADK restart for long-lived interrupts.
- Verify approval-inside-tools behavior with real risky connector/tool calls.
- Verify downstream prompt injection for:
  - human context
  - workflow/node HITL memory
  - replay HITL memory
- Re-check blocker detection behavior in realistic runs beyond deterministic cases.

### 14. Frontend implementation plan

- Re-check the full frontend HITL stack in browser:
  - types
  - API client
  - Zustand/query integration
  - Blocker Center UI
  - Node Editor UI
  - run-mode assistant UI
- Verify Smart HITL toggle behavior end to end after backend/ADK restart.

### 15. Design-mode AI suggestions

- Extend design intent operations to cover HITL/blocker/memory actions.
- Verify that design-mode AI suggestions can propose:
  - workflow HITL policy updates
  - blocker creation/update/deletion
  - HITL memory creation

### 16. Testing plan

- Fill remaining backend automated tests for blocker CRUD, memory suggestions, multiple interrupts, disabled blocker behavior, and replay HITL summaries.
- Fill remaining ADK tests for replay reuse rules, process restart/durable resume, and approval-inside-tools behavior.
- Fill remaining frontend tests for blocker center flows, node overrides, disable-from-card behavior, replay HITL summary rendering, and broader queue flows.
- Run targeted browser validation for the remaining business flows after service restarts.

### 17. Rollout plan

- Implement or verify the staged rollout items:
  - shadow mode
  - deterministic Smart HITL phase
  - business UI release readiness
  - LLM-estimated blocker phase
  - HITL memory rollout
  - replay integration rollout
  - post-run optimization suggestions

### 18. Final UX target

- Finish the final business-user copilot pass so the experience matches the target workflow:
  - user runs workflow
  - agent pauses with a clear reason
  - user answers once
  - downstream nodes reuse the answer correctly
  - replay records the intervention
  - assistant suggests blocker/memory/design improvements

## Immediate next validation steps

1. Restart the ADK service and verify the new clarification suppression path in a real run.
2. Verify Smart HITL can be turned off and actually suppresses step-level HITL behavior.
3. Re-test blocker disable actions and memory/scope behavior from the browser.
