# Playbook Backend Execution, Replay, and Recovery

## Scope

This document explains how `PlaybookExecutionService` orchestrates execution and how replay-related features fit into that flow.

## Execution Modes

### Single-step mode

Used when `singleStepTaskId` is present.

Behavior:

- only the selected task is executed
- all other tasks are marked skipped
- unary gRPC `RunStep` or `ResumeStep` is used

### Full-workflow mode

Used for normal DAG execution.

Behavior:

- backend sends the enabled graph to `RunPlaybookWorkflow`
- ADK and LangGraph handle dependency ordering internally
- backend consumes a gRPC stream and maps updates into SSE plus persistence

## In-Memory Step Buffers

`activeStepBuffers` holds live task state during workflow execution.

Purpose:

- reduce write amplification
- power `active-executions` catch-up reads
- preserve fresher state than the last DB flush

## Interrupt and Resume

Interrupts are stored as:

- execution `interruptPayload`
- human-feedback component on the task result

Resume behavior:

- human feedback is marked answered
- backend resumes either the unary step path or workflow stream path
- skip-step is implemented as a special resume with reason `__SKIP_STEP__`

## Replay Baselines

Replay support includes:

- capturing a validated replay from a completed task result
- activating a replay baseline per task
- preserving tool-call provenance
- optionally preserving output format

During execution, the backend sends:

- execution-wide mode
- per-step replay mode
- validated replay metadata

## Output-Format Support

The backend supports:

- replay-linked format-guide generation
- standalone output-format template capture

When a usable guide exists, backend execution preparation can append explicit formatting instructions to the task description before sending it to the ADK.

## Semantic Evaluation

Semantic evaluation compares a completed task result against the active replay baseline.

Flow:

1. task completes
2. backend locates active replay baseline
3. backend calls ADK `EvaluateSemanticMatch`
4. match data is stored on the task result
5. `evaluationHistory` is appended
6. frontend is updated through `playbook_step_evaluation_updated`

## Partial Re-Execution

### Rerun Step

Used to rerun a specific task within an existing execution.

Behavior:

- increments attempt number
- resets the selected task
- marks descendants stale
- preserves ancestor outputs

### Resume From Step

Used to recompute a subgraph from a chosen node forward.

Behavior:

- resets the chosen task and descendants
- rebuilds a subgraph
- seeds upstream outputs from previous completed work
- executes only the affected portion of the DAG

## Mental Model

`PlaybookExecutionService` is not just an executor.

It is the state-transition coordinator for:

- execution lifecycle
- replay provenance
- interrupt handling
- semantic evaluation
- partial recomputation

