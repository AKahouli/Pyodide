# Playbook Rewrite — Gap Remediation Plan

The remediation plan should not aim to “make the new backend imitate the old DAG module.” It should complete the rewrite contract from `PLAYBOOK_REWRITE_PLAN.md`: same external playbook feature, new loop-capable runtime, strict `controlEdges`/`dataBindings` split, iteration-aware execution, HITL, replay, scheduling, mail, and eventual legacy deletion.

## Main Correction

The previous gap report correctly identified old-vs-new communication differences, but it treated every missing old endpoint as a potential defect. With the rewrite plan in scope, some gaps are intentional:

| Old Gap | Real Status Under Rewrite Plan |
|---|---|
| `POST /playbooks/:id/execute` missing | Intentional replacement by `POST /playbooks/:id/executions` |
| `GET /playbooks/:id/executions/:execId` changed | Intentional replacement by `GET /executions/:id` |
| `stop` replaced by `cancel` | Intentional |
| `resume` replaced by `resume-approval` | Intentional for HITL |
| Trace replay / re-execute added | Intentional new model |
| `tasks/edges` replaced by `nodes/controlEdges/dataBindings` | Core design decision |
| `PlaybookOwnerGuard` replaced by `PermissionsGuard` | Intentional permission rewrite |

The real remediation plan is therefore: **finish the planned replacement contracts, remove stale old-contract frontend calls, and reintroduce only feature-equivalent successors where the plan requires parity.**

## Priority 0: Contract Alignment

First, freeze the public frontend/backend contract around the new model.

Required decisions:

| Area | Target Contract |
|---|---|
| External URL namespace | Keep `/playbooks` externally. `Flow` is internal runtime language. |
| Backend module | `playbook-flow` during rewrite, renamed to `playbook` in Phase 6. |
| Frontend module | Stays `front/src/modules/playbook`. |
| Persisted graph | `nodes`, `controlEdges`, `dataBindings`. |
| Execution start | `POST /playbooks/:id/executions` with optional `Idempotency-Key`. |
| Execution detail | `GET /executions/:executionId`. |
| HITL resume | `POST /executions/:executionId/resume-approval`. |
| Cancellation | `POST /executions/:executionId/cancel`. |
| Replay | `trace-replay` and `re-execute` remain separate. |

Immediate cleanup:

| File | Action |
|---|---|
| `front/src/lib/api/config.ts` | Remove or stop using stale old endpoints after replacement is complete. |
| `front/src/modules/playbook/api.ts` | Split old compatibility wrappers from real new-flow APIs, then delete old wrappers when call sites are migrated. |
| `front/src/modules/playbook/types.ts` | Make new flow types first-class, not bolted onto old `PlaybookTask`/`PlaybookEdge` types. |

## Priority 1: Restore Real-Time Execution

This is the biggest end-to-end blocker.

The rewrite plan explicitly says queue position and trace replay should broadcast via SSE, and Phase 5 says trace replay emits the same SSE events as live execution. The current refactored backend has no SSE layer.

Implement a new streaming layer, but with new runtime semantics.

Backend additions:

| Component | Purpose |
|---|---|
| `playbook-flow-stream.controller.ts` | `GET /playbooks/stream`, same external endpoint expected by frontend |
| `playbook-flow-stream-gateway.service.ts` | Per-user connection registry, multi-tab-safe event fanout |
| `playbook-flow-stream-auth.guard.ts` | Query-token auth equivalent to old stream guard |
| Execution event mapper | Convert gRPC runtime events into frontend-compatible playbook events |
| Queue event publisher | Emit queue position and active execution hydration |

Minimum event bridge:

| Python/gRPC Event | Frontend SSE Event |
|---|---|
| `ExecutionStarted` | `playbook_execution_start` |
| `NodeStarted` | `playbook_step_start` |
| `NodeCompleted` | `playbook_step_complete` |
| `NodeFailed` | `playbook_step_complete` or `playbook_execution_error` depending scope |
| partial node output, if available | `playbook_step_update` |
| `RouterDecision` | new or existing step update payload with router decision metadata |
| `IterationIncremented` | step update / execution metadata update |
| `ApprovalRequested` | `playbook_interrupt` or new approval-specific event |
| `ApprovalResolved` | step update / execution update |
| `ExecutionCompleted` | `playbook_execution_complete` |
| `ExecutionFailed` | `playbook_execution_error` |
| queue position changed | `playbook_execution_start` or new queue update event |

Recommendation: preserve the existing frontend SSE event names initially to reduce UI churn, but update payloads to include `iteration`, `nodeKind`, `routerDecision`, `pendingApproval`, `queuePosition`, and `recursionBudget`.

## Priority 2: Complete Execution Lifecycle

The new execution model should not restore old `skip-step`, `rerun-step`, and `resume-from-step` as-is unless they are explicitly valid in the new runtime.

Required endpoints:

| Flow | Endpoint | Status |
|---|---|---|
| Start execution | `POST /playbooks/:id/executions` | Present |
| List executions | `GET /playbooks/:id/executions` | Present |
| Read execution | `GET /executions/:id` | Present |
| Cancel execution | `POST /executions/:id/cancel` | Present |
| Resume HITL | `POST /executions/:id/resume-approval` | Present |
| Router decisions | `GET /executions/:id/router-decisions` | Present |
| Trace replay | `POST /executions/:id/trace-replay` | Present |
| Re-execute | `POST /executions/:id/re-execute` | Present |
| Delete execution | Needed for old UI parity unless intentionally removed |
| Delete all executions | Needed if existing UI still exposes it |
| Delete step result | Re-evaluate; old “step execution” does not map cleanly to iteration-keyed results |

Do not blindly port:

| Old Action | New Recommendation |
|---|---|
| `skip-step` | Only implement if runtime has a clear state transition for skipped node. Otherwise remove UI affordance. |
| `rerun-step` | Replace with re-execute or future targeted node re-execution. |
| `resume-from-step` | Avoid unless the new checkpointer supports safe branch continuation. |
| `stop` | Frontend should call `cancel`. |

## Priority 3: Finish Frontend Refactor Properly

The current frontend appears to still carry a compatibility layer that maps `Flow` back into old `Playbook` shapes. That is useful temporarily, but risky long-term.

Required frontend remediation:

| Area | Action |
|---|---|
| API layer | Retarget all execution calls to `playbookFlows.*`, not old `playbooks.*` where semantics changed |
| Canvas | Persist `controlEdges` and `dataBindings` separately |
| Canvas validation | Allow cycles only through routers with `maxIterations` |
| Router UI | Add output labels, conditional handles, terminal route visibility |
| Human approval UI | Replace old interrupt dialog with approval decision flow |
| Execution list | Group task results by `(taskId, iteration)` |
| Execution detail | Show iteration selector, router decisions, pending approval |
| Status badges | Add `queued`, `pending_approval`, `cancelled` |
| Settings | Add recursion limit and max parallelism |
| Replay UI | Separate trace replay vs re-execute |

Important: remove `console.log('[DEBUG] updatePlaybook body:', ...)` from `api.ts`.

## Priority 4: Restore Feature Parity Through New Semantics

These are not “old endpoint restoration” tasks. They are feature-successor tasks from the rewrite plan.

| Feature | New Implementation Direction |
|---|---|
| Intent | Port to `playbook-flow-intent.service.ts`; initially DAG-only output with default data bindings |
| Generation | Produce valid `FlowSnapshot`, initially sequential |
| Design chat | Port topology-agnostic design service and design messages |
| Node advisor | Adapt suggestions to iteration-aware results |
| Output format templates | Already mostly aligned; verify iteration awareness |
| Evaluation | Baselines anchored to `(taskId, iteration)` |
| Repeatability | Split into structural and content repeatability |
| Trace replay | Deterministic from task results + router decisions |
| Re-execution | Fresh run with divergence warning |
| Scheduling | Fire new execution service with idempotency |
| Mail trigger | Fire new execution service with webhook idempotency |
| Node templates | Add router, iterator, human approval kinds |

Missing parity that should likely be restored:

| Old Feature | Remediation |
|---|---|
| Design messages | Add new flow design message endpoints if UI still uses design chat history |
| Revert snapshot | Reintroduce as flow snapshot revert if still part of UX |
| Clone share | Port if sharing remains part of product scope |
| Integration link/public execute | Port if external execution is still required |
| Favorite | Port if list UI still uses favorite state |
| Bulk delete | Port if list UI still exposes bulk actions |

Features likely not worth restoring immediately:

| Old Feature | Reason |
|---|---|
| Old judge “update-current/generate-new/optimize-step” endpoints | DAG/single-output semantics; rewrite as advisor/remediation later |
| Old step-level rerun | Conflicts with loop/checkpoint semantics |
| Old skip-step | Needs explicit runtime semantics before exposing |

## Priority 5: Backend Runtime Hardening

The plan requires the backend to consume Python gRPC events and persist iteration-aware execution state.

Checklist:

| Area | Required Work |
|---|---|
| gRPC `Run` stream | Consume events continuously and map to DB writes |
| `task_results` | Compound unique key `(executionId, taskId, iteration)` |
| `router_decisions` | Append-only, drives trace replay |
| `executions` | Track `queued`, `running`, `pending_approval`, `completed`, `failed`, `cancelled` |
| Queue | Per-user FIFO, queue depth limit, queue position updates |
| Idempotency | 24h TTL, same request returns same execution id, mismatched body errors |
| Cancellation | Backend calls Python `Cancel(executionId)` |
| HITL | Backend calls Python `ResumeApproval(...)` |
| Error routing | Preserve `__error__` label semantics |
| Recursion budget | Enforce backend max and pass to LangGraph config |

## Priority 6: Route Compatibility Strategy

Because no production users exist, do not maintain duplicate old and new APIs. But the frontend must be fully retargeted.

Recommended route policy:

| Route Category | Decision |
|---|---|
| Core CRUD `/playbooks` | Keep |
| Execution start | Use `POST /playbooks/:id/executions`; delete frontend use of `/execute` |
| Execution read | Use `GET /executions/:id`; delete nested detail usage |
| Cancel | Use `/executions/:id/cancel`; delete frontend use of `/stop` |
| HITL resume | Use `/executions/:id/resume-approval`; delete old `/resume` unless needed for non-HITL |
| Triggers | Prefer new singular `/trigger/...` routes, update frontend config |
| Repeatability task | Use `/repeatability/tasks/:taskId`, update frontend config |
| Templates | Use `/playbook-flow-templates` during rewrite, rename in Phase 6 if desired |

## Suggested Remediation Sequence

1. Restore new SSE stream gateway and event mapping.
2. Fix frontend execution APIs to use only new execution routes.
3. Make execution surfaces iteration-aware.
4. Complete canvas control/data split and router/HITL UI.
5. Port design messages, intent, generation, and node advisor.
6. Port scheduling and mail trigger to new execution service.
7. Implement trace replay and re-execute end-to-end with UI actions.
8. Restore only required UX parity: favorite, bulk delete, clone share, integration/public execute if still product-required.
9. Delete old endpoint constants and compatibility wrappers.
10. Run full smoke: create flow, save loop, execute, stream progress, approve HITL, cancel, trace replay, re-execute, schedule, mail trigger.

## End-To-End Success Criteria

The remediation is complete when this works from UI without old DAG assumptions:

1. User creates a flow with `step → router → retry step → router → done`.
2. Control loop uses router labels and `maxIterations`.
3. Inputs are wired through `dataBindings`, not control edges.
4. Execution starts through `POST /playbooks/:id/executions`.
5. UI receives live SSE updates.
6. Iterations are visible per task.
7. HITL node pauses and resumes.
8. Cancel works within the planned latency.
9. Trace replay reproduces the same timeline.
10. Re-execute starts a new run and warns about divergence.
11. Schedule and mail triggers start executions through the new runtime.
12. No frontend call depends on old DAG-only endpoints.
