# Playbook Evaluation

> **Slug:** `playbook-evaluation` | **Status:** 🚧 draft | **Last Updated:** 2026-04-25 00:00 UTC

## Purpose

`playbook-evaluation` adds graph-native evaluation task nodes to playbook workflows.

The feature lets users:

- add one or more `Evaluation Task` nodes from the template toolbar
- connect upstream node outputs directly into evaluation nodes
- define expected results in natural language
- save immutable reference baselines per evaluation node
- persist evaluation executions over time for score tracking

## Scope

Included:

- evaluation task configuration on playbook nodes
- dedicated backend evaluation domain service
- baseline persistence and replacement rules
- evaluation execution history persistence
- prompt configurability through `Admin > Playbook Prompts`
- ADK runtime evaluation task execution
- frontend rendering of evaluation artifacts and baseline metadata

Excluded in the current implementation state:

- full dedicated evaluation-history comparison UI using the persisted evaluation-execution collection
- explicit execution-history baseline picker UI
- aggregate multi-node evaluation analytics page

## Architecture

```text
Upstream task nodes
    |
    v
Evaluation task node
    |
    +--> ADK evaluation execution
    +--> structured data artifact: playbook_evaluation_result
    +--> backend persistence in playbook_evaluation_executions
    +--> frontend execution detail rendering
```

### Backend

- `YellowStorm/back/src/modules/playbook/services/playbook-evaluation.service.ts`
  - owns evaluation-specific rules and persistence
  - normalizes and validates evaluation config
  - resolves and replaces baselines
  - persists dedicated evaluation execution records
- `YellowStorm/back/src/modules/playbook/schemas/playbook-evaluation-baseline.schema.ts`
  - immutable evaluation baseline records
- `YellowStorm/back/src/modules/playbook/schemas/playbook-evaluation-execution.schema.ts`
  - dedicated evaluation execution history records
- `YellowStorm/back/src/modules/playbook/services/playbook-prompt.service.ts`
  - seeds evaluation prompt keys for Admin prompt management

### ADK Runtime

- `yellowstorm-adk/src/langgraph_engine/step_executor.py`
  - detects `task_type == 'evaluation'`
  - resolves connected inputs through existing port-resolution flow
  - loads prompts from the prompt registry
  - calls the LLM judge
  - emits a `data` artifact with `type: playbook_evaluation_result`

### Frontend

- `YellowStorm/front/src/modules/playbook/utils/task-template-registry.ts`
  - registers the `Evaluation Task` template
- `YellowStorm/front/src/modules/playbook/components/PlaybookNodeEditor.tsx`
  - edits evaluation expectation and thresholds
  - shows active evaluation baseline metadata
- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`
  - renders evaluation artifact fallback output
  - shows evaluation baseline metadata
  - allows saving the current execution as the evaluation baseline

## Prompt Configuration

Evaluation prompts are configurable through `Admin > Playbook Prompts`.

Current built-in keys:

- `evaluation.task.system`
- `evaluation.task.user`

These prompts are consumed by the ADK runtime through the existing prompt registry path. No separate evaluation-only prompt store is used.

## Data Model

### Evaluation Task Config

Stored on the playbook task:

- `taskType: 'evaluation'`
- `evaluationConfig.expectation`
- `evaluationConfig.referenceBaselineId`
- `evaluationConfig.passThreshold`
- `evaluationConfig.warningThreshold`
- `evaluationConfig.weight`
- `evaluationConfig.rubricVersion`
- `evaluationConfig.weights`

### Baseline Record

Stored in `playbook_evaluation_baselines`:

- `playbookId`
- `evaluationTaskId`
- `sourceExecutionId`
- `sourceMode`
- `inputSnapshots[]`
- `createdByUserId`
- `replacedAt`

### Evaluation Execution Record

Stored in `playbook_evaluation_executions`:

- `playbookId`
- `executionId`
- `evaluationTaskId`
- `evaluationTaskTitle`
- `baselineId`
- `mode`
- `status`
- `score`
- `verdict`
- score breakdown fields
- `summary`
- `findings[]`
- `metrics`

## Baseline Rules

- one active baseline per `playbookId + evaluationTaskId`
- replacing a baseline marks the previous one with `replacedAt`
- baselines are immutable after creation
- baseline snapshots are scoped to the evaluation node's actual incoming edges from the execution snapshot

## Current APIs

- `GET /playbooks/:id/evaluations`
- `GET /playbooks/:id/evaluation-tasks/:taskId/baseline`
- `POST /playbooks/:id/evaluation-tasks/:taskId/baseline/from-execution`
- `POST /playbooks/:id/evaluation-tasks/:taskId/baseline/from-current-execution`

## Current UI State

Implemented now:

- add evaluation tasks from templates
- configure expected result and thresholds
- render evaluation results in execution detail
- view active evaluation baseline metadata
- save the current execution as an evaluation baseline

Not yet implemented as a complete UX:

- select an arbitrary prior execution as evaluation baseline from the UI
- full dedicated persisted evaluation-history selector and comparison UI
- aggregate evaluation analytics dashboard across multiple evaluation nodes

## Design Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Keep evaluation logic in `PlaybookEvaluationService` | Maintains clear domain boundaries and prevents playbook execution orchestration from absorbing evaluation rules | Embedding logic inside `PlaybookExecutionService` |
| Use graph-native evaluation tasks | Makes evaluation explicit and composable in the workflow graph | Hidden tagging or implicit terminal-node inference |
| Reuse Admin prompt registry | Keeps prompt management centralized and editable through existing tooling | Separate evaluation prompt config path |
| Persist dedicated evaluation execution records | Enables trend queries without scanning full execution documents | Reading only task artifacts from execution history |

## Related Features

- [`playbook`](/docs/playbook/README.md)
- [`playbook-advisor`](/docs/playbook-advisor/README_2026-04-11_16-10-04.md)
