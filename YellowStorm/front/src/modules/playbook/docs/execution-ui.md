# Playbook Frontend Execution UI

## Scope

This document describes how the frontend presents execution state for playbooks.

## Main Execution Surfaces

- `ExecutionPanel.tsx`: inline split-view execution experience on the canvas page
- `ExecutionHeader.tsx`: status, stop action, history switching
- `ExecutionStepList.tsx`: ordered task list with live status
- `ExecutionStepDetail.tsx`: detailed output and provenance view
- `HumanFeedbackInline.tsx`: inline interrupt response controls
- `InterruptDialog.tsx`: modal interrupt UX where needed

## Live Execution Flow

1. User starts execution from the canvas page.
2. The store opens the execution panel.
3. SSE events progressively update execution and task state.
4. The active task auto-focuses in the step list.
5. On interrupt, the interrupted step gets priority selection.

The canvas also reflects live task status so the user can see graph progress without leaving the editor.

## Step Detail Tabs

`ExecutionStepDetail.tsx` is the richest execution view.

It can display:

- step results and rendered components
- semantic evaluation and evaluation history
- tool trace
- replay argument diff against the baseline
- LLM prompt trace

## Replay and Output-Format UX

The execution detail view supports:

- saving a replay baseline from a completed step
- viewing replay provenance for a result
- selecting per-step replay mode:
  - `live`
  - `replay_strict`
  - `replay_flex`
  - `replay_adaptive`
- grabbing an output format from a step result
- surfacing replay format-guide and output-format-template status

## Semantic Evaluation UX

Evaluation state is shown per step.

The UI surfaces:

- current semantic match score
- embedding similarity
- evidence consistency
- judge score
- explanation
- missing points
- changed points
- historical evaluation runs

This is updated through `playbook_step_evaluation_updated`.

## Interrupt UX

Interrupt handling supports:

- approval requests
- review requests
- clarification requests

The frontend:

- renders pending human feedback in the step result stream
- allows users to respond inline
- optimistically marks the feedback item as answered before backend confirmation

## Partial Re-Execution UX

The frontend also supports:

- rerunning a step inside an existing execution
- resuming the DAG from a specific step forward

These flows rebuild the execution view optimistically so the user immediately sees the new running attempt.

