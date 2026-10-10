---
name: mono-agent-work-orchestration
description: Choose and coordinate background tasks, temporary workers, specialists, and fan-out in a YellowStorm mono-agent conversation. Use for substantial independent work, parallel research or analysis, finite batches, requests to keep chatting while work runs, and follow-ups about existing background tasks.
compatibility: YellowStorm ROOT agent with the relevant delegation and background tools enabled and a ready runtime.
metadata:
  version: "1.0.0"
---

# Keep conversation responsive

Choose the smallest execution pattern that completes the user's request. Background execution frees the conversation; it does not automatically make one task faster. Parallelism helps only when useful work is independent.

## Choose the execution pattern

| Need | Choice |
| --- | --- |
| A quick answer, small edit, or ordinary conversation | Respond directly. |
| A bounded specialist contribution needed before answering | Use an available authorized specialist, or `spawn_temporary_worker(task, expected_output, context_refs)` for a one-off leaf task. This is foreground work. |
| Substantial independent work while the user continues chatting | `start_background_task(task, worker_kind="temporary", expected_output, context_refs)`. Use `worker_kind="specialist"` with an authorized `agent_id` when its configured expertise/tools are needed. |
| The same operation over a finite list of independent items | `run_fanout(items, worker_type="temporary", mode="background")`; use `worker_type="library"` and an authorized `agent_id` for a configured specialist. |
| Dependent steps, shared mutable output, or unresolved essential choices | Clarify or sequence the work; do not fan out dependent steps. |

Use only tools and targets exposed in this invocation. An enabled agent setting is not proof of runtime readiness. A temporary worker inherits a restricted profile, not arbitrary tools, attachments, writable files, or the entire conversation. An empty specialist catalog gives no specialist access. Never invent agent IDs or context references.

## Clarify before dispatch

Resolve missing information that changes the task's scope or correctness in the root conversation. If native `adk_request_input` is available, provide a clear `message` and a simple `response_schema`, then wait for the bound response. Otherwise ask a concise chat question. State reasonable assumptions for nonessential details rather than blocking unnecessarily.

The default temporary worker does not receive the root's native input-control tool. Do not delegate an instruction to ask the user through `adk_request_input` and assume it can do so. Give workers complete tasks; ask them to report missing evidence or blockers without guessing. A worker's prose question is not a pending interactive input request.

## Make a complete, bounded assignment

Include the objective, relevant facts already established, available source/context references, expected output, and completion criteria. Specify constraints such as read-only work when appropriate. Do not copy unrelated conversation history or sensitive context that the task does not need.

Use `context_refs` for actual authorized workspace IDs; references do not grant new access. Verify required documents/tools are available before promising source-based findings. Ask workers to distinguish verified facts from assumptions and report inaccessible sources.

For fan-out, freeze the item list before submitting. Each item needs a unique stable `key` and a `task`; optional item fields are `expectedOutput` and `contextRefs`. Keep items independent and similarly scoped. Respect exposed manifest/concurrency limits; do not evade limits by creating duplicate batches. Workers are leaves: they cannot delegate, spawn other workers, or create nested background work.

## Submit, acknowledge, release the conversation

After a confirmed queued/running acceptance, briefly say what is running and finish the turn. Retain the returned execution reference for status and results. Say that work was submitted, not that findings are ready. Do not wait or repeatedly poll in the foreground after submission.

If submission is rejected, explain the concrete limitation. If its outcome is unknown, inspect the returned execution reference before another submission. Never blindly repeat work that may already be running or may have caused external effects. Do not claim a job started without a confirming tool result.

## Continue the conversation and handle follow-ups

Answer unrelated messages normally while work runs. A new message does not silently change a running task's instructions. For status questions, use `list_background_tasks` to find earlier work and `get_background_task_status` for the relevant execution; do not relaunch it. Clarify which task the user means if several match.

For an explicit cancellation or revision, target only the requested task with `cancel_background_task`. Instructions are immutable: submit revised work separately when appropriate, reconciling uncertain external effects first. Cancellation requested is not proof that an already-started external effect was undone. Do not offer unsupported pause, resume, per-item cancellation, or retry controls.

## Report results honestly

Use committed results, not an acknowledgement or progress text, as evidence. `get_background_task_result(execution_id, offset)` returns bounded pages: follow `next_offset` until null before claiming complete analysis of that result. If using only part of a result, say so.

Summarize the outcome in the context of the original request, with the useful deliverable first. For batches, distinguish completed, failed, cancelled, and unstarted items. Surface missing sources and unresolved blockers; do not turn partial output into a complete-success claim. Avoid repeating results already delivered unless the user asks for a recap or further analysis.
