# Playbook Evaluation Task Node Implementation Plan

> Scope: Add explicit, graph-native evaluation task nodes that can evaluate connected playbook results using natural-language expectations, optional immutable reference baselines, or both.

## Goals

- Let users add one or more `Evaluation task` nodes from the Templates toolbar.
- Let users connect any node outputs that should be evaluated directly into an evaluation node.
- Let each evaluation node define an expected result in natural language.
- Let each evaluation node optionally compare current connected inputs with a saved reference baseline.
- Persist every evaluation node execution so score improvement can be measured over time.
- Keep evaluation logic in a dedicated playbook evaluation backend service, separate from playbook execution orchestration.

## Non-Goals

- Do not replace normal playbook execution records.
- Do not require hidden global tagging of task executions as references.
- Do not infer evaluation scope from terminal nodes when an explicit evaluation node exists.
- Do not silently overwrite reference baselines on every run.
- Do not make the workflow pass only because execution completed successfully.

## Core Product Model

Evaluation becomes part of the graph.

```text
Financial extract node ----\
PDF generator node ---------+--> Evaluation task node --> Evaluation artifact
Summary node --------------/
```

Each `Evaluation task` asks:

```text
Given these connected inputs, did they satisfy this expectation, and how do they compare with the configured reference baseline?
```

A playbook may contain multiple evaluation nodes, for example:

- `Financial Metrics Evaluation`
- `PDF Report Evaluation`
- `Compliance Evaluation`
- `Customer Response Evaluation`

Each evaluation node owns its own configuration, baseline, execution history, and score trend.

## Evaluation Modes

The effective mode is derived from the node configuration.

| Mode | Trigger | Behavior |
|------|---------|----------|
| `semantic` | Natural-language expectation only | Judge connected inputs against the expected result text. |
| `reference` | Reference baseline only | Compare connected inputs against the saved baseline snapshot. |
| `hybrid` | Expectation and reference baseline | Judge both semantic compliance and baseline similarity. |

Semantic expectation should usually remain required in the UI for new evaluation nodes. Reference comparison is optional.

## Evaluation Node Configuration

Persist configuration on the task node, using the existing playbook task/template model where possible.

```ts
type EvaluationTaskConfig = {
  kind: 'evaluation';
  expectation: string;
  referenceBaselineId?: string | null;
  passThreshold: number;
  warningThreshold: number;
  weight: number;
  rubricVersion: string;
  weights: {
    semanticMatch: number;
    referenceMatch: number;
    artifactRequirements: number;
    formatCompliance: number;
    evidenceConsistency: number;
    executionHealth: number;
  };
};
```

Recommended defaults:

```ts
{
  passThreshold: 80,
  warningThreshold: 60,
  weight: 1,
  rubricVersion: 'evaluation-node-v1',
  weights: {
    semanticMatch: 40,
    referenceMatch: 20,
    artifactRequirements: 20,
    formatCompliance: 10,
    evidenceConsistency: 5,
    executionHealth: 5,
  },
}
```

When there is no reference baseline, redistribute `referenceMatch` weight into `semanticMatch`.

## Reference Baselines

Reference baselines belong to an evaluation node, not to arbitrary upstream nodes.

Supported baseline creation paths:

1. Select a previous execution.
2. Use current connected inputs as baseline.

Baseline creation must snapshot the connected inputs as seen by the evaluation node.

```ts
type PlaybookEvaluationBaseline = {
  id: string;
  playbookId: string;
  evaluationTaskId: string;
  sourceExecutionId: string;
  sourceMode: 'selected_execution' | 'current_inputs';
  inputSnapshots: Array<{
    sourceTaskId: string;
    sourceOutputPortId?: string | null;
    targetInputPortId?: string | null;
    output?: string | null;
    artifacts: Array<{
      id?: string;
      kind: string;
      name?: string;
      mimeType?: string;
      uri?: string;
      textPreview?: string;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  createdByUserId: string;
  createdAt: Date;
  replacedAt?: Date | null;
};
```

Rules:

- One active baseline per `playbookId + evaluationTaskId`.
- Replacing a baseline creates a new baseline and marks the previous one as replaced.
- Baselines are immutable after creation.
- Normal workflow execution must not automatically update the baseline.
- The UI must make baseline replacement explicit.

## Evaluation Execution Persistence

Store evaluation node outputs in two places:

1. As normal playbook step output/artifacts, so the execution panel can render them like other task results.
2. In a dedicated evaluation history collection, so trend queries do not need to scan all execution payloads.

```ts
type PlaybookEvaluationExecution = {
  id: string;
  playbookId: string;
  executionId: string;
  evaluationTaskId: string;
  evaluationTaskTitle: string;
  baselineId?: string | null;
  mode: 'semantic' | 'reference' | 'hybrid';
  status: 'running' | 'completed' | 'failed';
  score?: number;
  verdict?: 'pass' | 'warning' | 'fail';
  semanticScore?: number | null;
  referenceScore?: number | null;
  artifactScore?: number | null;
  formatScore?: number | null;
  evidenceScore?: number | null;
  executionHealthScore?: number | null;
  expectation?: string;
  rubricVersion: string;
  judgeModel?: string | null;
  summary?: string | null;
  findings: Array<{
    severity: 'info' | 'warning' | 'error';
    category: 'semantic' | 'reference' | 'artifact' | 'format' | 'evidence' | 'execution';
    sourceTaskId?: string | null;
    message: string;
  }>;
  metrics: {
    connectedInputCount: number;
    artifactCount: number;
    completedUpstreamSteps: number;
    failedUpstreamSteps: number;
    totalDurationMs?: number;
  };
  startedAt: Date;
  completedAt?: Date | null;
  error?: string | null;
};
```

## Dedicated Backend Service

Add a dedicated service under the existing playbook module.

Suggested files:

```text
YellowStorm/back/src/modules/playbook/services/playbook-evaluation.service.ts
YellowStorm/back/src/modules/playbook/services/playbook-evaluation.service.spec.ts
YellowStorm/back/src/modules/playbook/schemas/playbook-evaluation-baseline.schema.ts
YellowStorm/back/src/modules/playbook/schemas/playbook-evaluation-execution.schema.ts
YellowStorm/back/src/modules/playbook/dto/evaluation-config.dto.ts
YellowStorm/back/src/modules/playbook/dto/evaluation-baseline.dto.ts
```

`PlaybookEvaluationService` responsibilities:

- Identify evaluation task nodes in a playbook execution.
- Resolve connected upstream inputs for an evaluation node.
- Create and replace reference baselines.
- Run semantic, reference, or hybrid evaluation.
- Persist immutable evaluation execution records.
- Attach evaluation artifacts back to the playbook step result.
- Provide trend and history queries.
- Compute aggregate playbook scores across multiple evaluation nodes.

Keep `PlaybookExecutionService` focused on orchestration. It should call the evaluation service only when an evaluation task node executes or when evaluation history must be indexed after execution.

## Backend API

Add endpoints to the existing playbook controller unless the module already has a clearer controller split.

```http
GET /playbooks/:id/evaluations
GET /playbooks/:id/evaluations/trends
GET /playbooks/:id/evaluation-tasks/:taskId/evaluations
GET /playbooks/:id/evaluation-tasks/:taskId/baseline

POST /playbooks/:id/evaluation-tasks/:taskId/baseline/from-execution
POST /playbooks/:id/evaluation-tasks/:taskId/baseline/from-current-execution
DELETE /playbooks/:id/evaluation-tasks/:taskId/baseline
```

Example baseline creation from a selected execution:

```json
{
  "executionId": "execution-123"
}
```

Example baseline creation from current connected inputs:

```json
{
  "executionId": "execution-456",
  "evaluationExecutionId": "eval-exec-789"
}
```

Trend query response:

```ts
type PlaybookEvaluationTrendResponse = {
  playbookId: string;
  aggregate: Array<{
    executionId: string;
    score: number;
    verdict: 'pass' | 'warning' | 'fail';
    createdAt: string;
  }>;
  byEvaluationTask: Array<{
    evaluationTaskId: string;
    title: string;
    weight: number;
    points: Array<{
      executionId: string;
      score: number;
      verdict: 'pass' | 'warning' | 'fail';
      createdAt: string;
    }>;
  }>;
};
```

## ADK Execution Behavior

Evaluation tasks should be explicit task types in the runtime.

When the ADK sees a task with `kind: 'evaluation'`:

1. Resolve connected inputs through the existing port resolution pipeline.
2. Build an evaluation prompt from:
   - evaluation expectation
   - connected input summaries
   - connected artifacts
   - reference baseline snapshot, if configured
   - rubric version and weights
3. Run deterministic checks first.
4. Run LLM judge only when semantic or reference comparison requires it.
5. Emit a structured evaluation artifact.

Evaluation output artifact shape:

```ts
type EvaluationArtifact = {
  artifactKind: 'data';
  type: 'playbook_evaluation_result';
  score: number;
  verdict: 'pass' | 'warning' | 'fail';
  summary: string;
  semanticScore?: number | null;
  referenceScore?: number | null;
  artifactScore?: number | null;
  findings: Array<{
    severity: 'info' | 'warning' | 'error';
    category: string;
    sourceTaskId?: string | null;
    message: string;
  }>;
};
```

The backend should persist this artifact in both normal execution state and the dedicated evaluation history collection.

## Scoring And Verdicts

Scoring must be versioned with `rubricVersion`.

Recommended verdict thresholds:

```text
score >= passThreshold -> pass
score >= warningThreshold -> warning
score < warningThreshold -> fail
```

Recommended default score components:

- `semanticMatch`: Does the output satisfy the natural-language expected result?
- `referenceMatch`: Is the output equivalent to or better than the baseline?
- `artifactRequirements`: Were required artifact kinds and counts produced?
- `formatCompliance`: Does the output follow expected structure, schema, or document format?
- `evidenceConsistency`: Are claims supported by connected inputs?
- `executionHealth`: Did upstream tasks complete without failures or missing outputs?

Hybrid mode should not pass only because the reference matches. Required semantic expectations should be able to produce a warning or failure even when reference similarity is high.

## Multiple Evaluation Nodes

Each evaluation node is scored independently.

The playbook aggregate score should be computed from completed evaluation node scores:

```text
aggregateScore = sum(evaluationScore * evaluationWeight) / sum(evaluationWeight)
```

Rules:

- Ignore evaluation nodes that did not run only if they are disabled or unreachable by design.
- Treat failed required evaluation nodes as score `0` for aggregate scoring.
- Show aggregate score separately from individual evaluation node scores.
- Persist aggregate snapshots for trend rendering.

## Frontend UX

### Templates Toolbar

Add an `Evaluation task` template.

Default characteristics:

- one or more input ports accepting text, document, data, dashboard, image, and code artifacts
- one output port producing a `data` evaluation artifact
- task kind or template type set to `evaluation`

### Node Configuration Panel

Add evaluation-specific settings:

- expected result textarea
- pass threshold
- warning threshold
- evaluation weight
- rubric weights, optionally hidden under advanced settings
- reference baseline section

Baseline section actions:

- `Select previous execution as baseline`
- `Use current connected inputs as baseline`
- `View baseline`
- `Replace baseline`
- `Remove baseline`

All user-facing strings must use the frontend i18n layer.

### Execution Detail UI

For evaluation task results, render:

- score badge
- verdict badge
- summary
- score breakdown
- findings grouped by category
- connected input list
- baseline comparison metadata, if used
- `Save current connected inputs as baseline` action when no baseline exists or replacement is allowed

### Playbook Analytics UI

Add a playbook-level evaluation trends view:

- aggregate score over time
- per-evaluation-node trend lines
- latest verdict per evaluation node
- best score and latest score
- regressions since previous execution

## Data Flow And Contracts

Evaluation nodes should use normal graph edges and existing port metadata.

Important constraints:

- Preserve source and target port ids.
- Allow multiple upstream outputs into one evaluation input.
- Preserve artifact kinds and artifact metadata.
- Do not collapse evaluation inputs to plain text only.
- Do not require evaluation nodes to be the only terminal nodes.

## Testing Plan

### Backend Unit Tests

- Creates baseline from selected execution and snapshots connected inputs.
- Replacing baseline marks previous baseline as replaced.
- Evaluation execution records are immutable after completion.
- Hybrid scoring redistributes weights correctly when no baseline exists.
- Multiple evaluation nodes aggregate into a weighted playbook score.
- Failed required evaluation node contributes score `0` to aggregate.

### ADK Tests

- Evaluation task receives connected upstream artifacts through port resolution.
- Semantic-only evaluation emits structured evaluation artifact.
- Reference-only evaluation compares current input snapshot to baseline.
- Hybrid evaluation includes both semantic and reference scores.
- Evaluation task emits terminal step update on success and failure.

### Frontend Tests

- Templates toolbar can add an evaluation task node.
- Evaluation node settings persist expectation and thresholds.
- Baseline actions call the correct APIs.
- Execution detail renders score breakdown and findings.
- Trend view renders multiple evaluation nodes.

### Integration Tests

- Full workflow with two normal task nodes and one evaluation node produces an evaluation history record.
- Full workflow with multiple evaluation nodes produces individual and aggregate scores.
- Baseline created from execution N is used when evaluating execution N+1.

## Rollout Phases

### Phase 1: Semantic Evaluation Node

- Add evaluation task template.
- Add node config fields for expectation and thresholds.
- Add ADK evaluation task execution path.
- Persist evaluation node result as normal step output.
- Add dedicated backend evaluation history collection.
- Render evaluation result in execution detail.

### Phase 2: Reference Baselines

- Add baseline schemas and APIs.
- Support baseline from selected execution.
- Support baseline from current connected inputs.
- Add reference score and findings.
- Add baseline management UI.

### Phase 3: Hybrid Scoring And Trends

- Support hybrid score blending.
- Add aggregate playbook score.
- Add trends API.
- Add playbook evaluation analytics UI.
- Add regression detection between latest and previous scores.

### Phase 4: Advisor And Optimization Integration

- Let advisor/autopilot use evaluation node scores as objective functions.
- Suggest prompt/task changes based on low-scoring evaluation findings.
- Track score improvement across autopilot attempts.

## Open Decisions

- Whether `expectation` should be required or optional when a reference baseline exists.
- Whether evaluation nodes should support strict schema assertions in addition to natural language.
- Whether evaluation baselines should snapshot full artifact payloads or only durable references plus previews.
- Whether aggregate playbook score should include only evaluation nodes or also execution health for the whole graph.
- Which judge model should be used by default, and whether it should be configurable per evaluation node.

## Recommended First Slice

Implement Phase 1 first with a narrow semantic-only path:

1. Add `Evaluation task` template.
2. Add expectation and threshold config.
3. Execute evaluation node after connected inputs are resolved.
4. Emit structured evaluation artifact.
5. Persist immutable evaluation history record.
6. Render score, verdict, summary, and findings in execution detail.

This creates the durable evaluation foundation before adding baseline comparison and trend analytics.
