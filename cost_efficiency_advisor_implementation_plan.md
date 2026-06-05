# Cost Efficiency Advisor — Implementation Plan

**Goal:** Add a new Advisor recommendation category that makes playbook steps more cost-efficient by avoiding LLM inference when possible. The category should support prompt optimization, cheaper model suggestions, caching, deterministic routing, and validated Python-script replacement.

---

## 1. Executive summary

The new recommendation category should be named:

```ts
'cost_efficiency'
```

It should not be limited to prompt shortening. It should become a broader Advisor capability that detects when a step can be executed more cheaply through one of these strategies:

1. **Prompt cost optimization** — keep LLM execution, but reduce prompt size, duplicated instructions, over-broad context, or vague output contracts.
2. **Cheaper model suggestion** — keep LLM execution, but recommend a less expensive model for simple extraction, classification, formatting, or summarization.
3. **Result cache** — avoid repeat inference when the same deterministic inputs are seen again.
4. **Deterministic router/condition** — replace LLM decision-making with explicit router conditions when logic is simple.
5. **Validated Python-script replacement** — replace an LLM step with generated deterministic Python only when the step is a pure transformation and validation passes.

The safe default should be prompt cost optimization. Script replacement should be opt-in and require validation before apply.

---

## 2. Current architecture touchpoints

The implementation should be anchored around these existing files:

```txt
YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-execution-advisor.interface.ts
YellowStorm/back/src/modules/playbook-flow/dto/preview-advisor-remediation.dto.ts
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-task-result.schema.ts
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-execution-advisor.service.ts
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-execution-advisor.mapper.ts
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-heuristic-advisor-evaluator.service.ts
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-llm-advisor-evaluator.service.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts
YellowStorm/back/src/modules/conversation/proto/chatbot.proto

yellowstorm-adk/src/flow_engine/advisor/execution_advisor_models.py
yellowstorm-adk/src/flow_engine/advisor/execution_advisor_service.py
yellowstorm-adk/src/grpc_server/chatbot_servicer.py
yellowstorm-adk/grpc/proto/chatbot.proto
```

Optional later touchpoints:

```txt
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-node-template.schema.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts
yellowstorm-adk/src/flow_engine/runtime/*
yellowstorm-adk/src/flow_engine/tools/*
```

---

## 3. Product behavior

### 3.1 Advisor finding example

The user-facing finding should look like this:

```txt
Cost efficiency opportunity

This step used a high amount of LLM context for a deterministic transformation.
It appears to parse, normalize, and format structured data without requiring open-ended reasoning.

Recommended action:
Replace with a validated Python transform after test validation.

Estimated step-level LLM token reduction: 90–100%.
```

### 3.2 Action ladder

The Advisor should recommend the cheapest safe strategy, not always the most aggressive one.

| Strategy | Suggested action | Default selected | Apply path |
|---|---|---:|---|
| Prompt cleanup | `optimize_prompt_cost` | Yes | Existing optimize-step flow |
| Cheaper model | `switch_to_cheaper_model` | No | Node/model setting update |
| Cache | `add_result_cache` | No | Runtime metadata/policy update |
| Router condition | `optimize_playbook` or future `replace_with_router_condition` | No | Workflow plan |
| Python script | `replace_with_deterministic_script` | No | Dedicated script preview + validation flow |

---

## 4. Backend interface changes

### 4.1 Add category

File:

```txt
YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-execution-advisor.interface.ts
```

Change:

```ts
export type AdvisorRemediationCategory =
  | 'structure'
  | 'prompt'
  | 'contract'
  | 'handoff'
  | 'tooling'
  | 'evidence'
  | 'outputFormat'
  | 'format'
  | 'hitl'
  | 'determinism'
  | 'expected_result'
  | 'cost_efficiency';
```

### 4.2 Add suggested actions

Change:

```ts
export type AdvisorRemediationSuggestedAction =
  | 'optimize_step'
  | 'optimize_playbook'
  | 'add_hitl_guard'
  | 'improve_tooling'
  | 'improve_output_contract'
  | 'optimize_prompt_cost'
  | 'switch_to_cheaper_model'
  | 'add_result_cache'
  | 'replace_with_deterministic_script';
```

### 4.3 Extend judge result

Add to `FlowExecutionJudgeResult`:

```ts
costEfficiencyScore: number;
costOptimizationPriority: number;
estimatedTokenReductionPct: number | null;
estimatedLatencyReductionPct: number | null;
costOptimizationHints: string[];
scriptReplacementHints: string[];
llmStillRequiredReasons: string[];
```

Recommended defaults:

```ts
costEfficiencyScore: 50
costOptimizationPriority: 0
estimatedTokenReductionPct: null
estimatedLatencyReductionPct: null
costOptimizationHints: []
scriptReplacementHints: []
llmStillRequiredReasons: []
```

---

## 5. DTO validation changes

File:

```txt
YellowStorm/back/src/modules/playbook-flow/dto/preview-advisor-remediation.dto.ts
```

Update:

```ts
const REMEDIATION_CATEGORIES = [
  'structure',
  'prompt',
  'contract',
  'handoff',
  'tooling',
  'evidence',
  'outputFormat',
  'format',
  'hitl',
  'determinism',
  'expected_result',
  'cost_efficiency',
] as const;
```

This keeps remediation preview validation aligned with the interface.

---

## 6. Persistence schema changes

File:

```txt
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-task-result.schema.ts
```

Add these optional properties to `FlowTaskJudgeResult`:

```ts
@Prop({ required: false, type: Number, default: 50 })
costEfficiencyScore?: number;

@Prop({ required: false, type: Number, default: 0 })
costOptimizationPriority?: number;

@Prop({ required: false, type: Number, default: null })
estimatedTokenReductionPct?: number | null;

@Prop({ required: false, type: Number, default: null })
estimatedLatencyReductionPct?: number | null;

@Prop({ required: false, type: [String], default: [] })
costOptimizationHints?: string[];

@Prop({ required: false, type: [String], default: [] })
scriptReplacementHints?: string[];

@Prop({ required: false, type: [String], default: [] })
llmStillRequiredReasons?: string[];
```

No migration is required for existing documents if all fields have safe defaults.

---

## 7. Mapper changes

File:

```txt
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-execution-advisor.mapper.ts
```

### 7.1 Extend gRPC request

Include cost-relevant task execution data in `buildEvaluateTaskRequest`:

```ts
usage: toGrpcStruct({
  inputTokens: params.taskResult.usage?.inputTokens ?? null,
  outputTokens: params.taskResult.usage?.outputTokens ?? null,
  totalTokens: params.taskResult.usage?.totalTokens ?? null,
  model: params.taskResult.usage?.model ?? null,
}),
llm_prompt_trace: Array.isArray(params.taskResult.llmPromptTrace)
  ? params.taskResult.llmPromptTrace.map((item: any) => ({
      stage: String(item.stage || ''),
      model: String(item.model || ''),
      prompt: String(item.prompt || ''),
    }))
  : [],
```

Depending on proto naming, use snake_case for gRPC payload fields:

```txt
usage
llm_prompt_trace
```

### 7.2 Extend `mapGrpcJudgeResult`

Add:

```ts
costEfficiencyScore: numberValue('cost_efficiency_score') || 50,
costOptimizationPriority: numberValue('cost_optimization_priority'),
estimatedTokenReductionPct: nullableNumberValue('estimated_token_reduction_pct'),
estimatedLatencyReductionPct: nullableNumberValue('estimated_latency_reduction_pct'),
costOptimizationHints: list('cost_optimization_hints'),
scriptReplacementHints: list('script_replacement_hints'),
llmStillRequiredReasons: list('llm_still_required_reasons'),
```

Add helper:

```ts
const nullableNumberValue = (key: string) => {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
```

### 7.3 Extend `mapLlmJudgeResult`

Add:

```ts
costEfficiencyScore: score('costEfficiencyScore') || 50,
costOptimizationPriority: score('costOptimizationPriority'),
estimatedTokenReductionPct: nullableScore('estimatedTokenReductionPct'),
estimatedLatencyReductionPct: nullableScore('estimatedLatencyReductionPct'),
costOptimizationHints: list('costOptimizationHints'),
scriptReplacementHints: list('scriptReplacementHints'),
llmStillRequiredReasons: list('llmStillRequiredReasons'),
```

Add helper:

```ts
private nullableScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}
```

### 7.4 Extend recommended action mapper

Update `mapRecommendedAction` to allow:

```ts
|| value === 'optimize_prompt_cost'
|| value === 'switch_to_cheaper_model'
|| value === 'add_result_cache'
|| value === 'replace_with_deterministic_script'
```

---

## 8. Advisor remediation item generation

File:

```txt
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-execution-advisor.service.ts
```

Current remediation items are generated from judge result arrays. Add cost fields to `fieldMappings`:

```ts
{
  key: 'costOptimizationHints',
  category: 'cost_efficiency',
  defaultSelected: true,
  blocking: false,
},
{
  key: 'scriptReplacementHints',
  category: 'cost_efficiency',
  defaultSelected: false,
  blocking: false,
},
{
  key: 'llmStillRequiredReasons',
  category: 'cost_efficiency',
  defaultSelected: false,
  blocking: false,
},
```

Use custom severity logic:

```ts
const severity =
  category === 'cost_efficiency' && judgeResult.costOptimizationPriority >= 80
    ? 'high'
    : category === 'cost_efficiency' && judgeResult.costOptimizationPriority >= 50
      ? 'medium'
      : blocking
        ? 'high'
        : defaultSelected
          ? 'medium'
          : 'low';
```

Use custom action logic:

```ts
const suggestedAction =
  key === 'scriptReplacementHints'
    ? 'replace_with_deterministic_script'
    : category === 'cost_efficiency'
      ? 'optimize_prompt_cost'
      : category === 'tooling'
        ? 'improve_tooling'
        : category === 'handoff'
          ? 'optimize_playbook'
          : 'optimize_step';
```

---

## 9. Remediation intent behavior

File:

```txt
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-execution-advisor.service.ts
```

Update `buildRemediationIntent`.

### 9.1 Prompt cost optimization

When selected findings include `cost_efficiency` and the requested mode is `optimize-step`, add language like:

```txt
Optimize only the selected step for lower inference cost while preserving output quality.

Prefer:
- shorter and more explicit task instructions;
- removing repeated or generic instructions;
- narrowing required context;
- strict output contracts;
- deterministic rules where possible;
- cheaper execution hints when safe.

Do not replace the step with code in this flow.
```

This keeps the existing `intent.analyze` path safe.

### 9.2 Script replacement should not use `intent.analyze`

Do not push generated code through `intent.analyze`, because current `PlaybookIntentTaskDraft` supports task fields, ports, template type, and iterator body, but not script source, tests, runtime policy, dependencies, or validation results.

Script replacement should use a dedicated endpoint described in section 15.

---

## 10. LLM judge prompt changes

File:

```txt
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts
```

Update the `judge.node_reflection` prompt.

### 10.1 Add scoring fields

Add under scoring fields:

```txt
- "costEfficiencyScore": whether the step is already cost-efficient for its required reasoning level
- "costOptimizationPriority": expected value of reducing LLM inference cost for this step
```

### 10.2 Add cost section

Add:

```txt
Cost efficiency analysis:
- "estimatedTokenReductionPct": estimated percentage of LLM tokens that could be removed or avoided, or null if unknown
- "estimatedLatencyReductionPct": estimated percentage of latency that could be reduced, or null if unknown
- "costOptimizationHints": concrete low-risk changes to reduce prompt size, context, model cost, repeated inference, or unnecessary tool/LLM calls
- "scriptReplacementHints": concrete reasons this step may be safely replaced by deterministic code, empty if not safe
- "llmStillRequiredReasons": reasons LLM inference is still needed, such as judgment, research, synthesis, ambiguity, creative generation, or human-sensitive decision-making
```

### 10.3 Extend recommended action enum

Update prompt text:

```txt
"recommendedAction":
  "optimize_step" |
  "optimize_playbook" |
  "review_only" |
  "add_hitl_guard" |
  "improve_tooling" |
  "improve_output_contract" |
  "optimize_prompt_cost" |
  "switch_to_cheaper_model" |
  "add_result_cache" |
  "replace_with_deterministic_script"
```

### 10.4 Add cost rules

Add:

```txt
Only recommend "replace_with_deterministic_script" when the step is a pure deterministic transformation, parser, validator, formatter, calculator, filter, mapper, router, or schema normalizer.

Do not recommend script replacement when the task requires open-ended reasoning, creative writing, subjective judgment, current external knowledge, research, policy interpretation, human approval, sensitive decisions, or external side effects.

Prefer "optimize_prompt_cost" when cost can be reduced but LLM reasoning is still required.
```

---

## 11. ADK model changes

File:

```txt
yellowstorm-adk/src/flow_engine/advisor/execution_advisor_models.py
```

### 11.1 Extend `ExecutionAdvisorRequest`

Add:

```py
usage: dict[str, Any] = field(default_factory=dict)
llm_prompt_trace: list[dict[str, Any]] = field(default_factory=list)
```

### 11.2 Extend `ExecutionAdvisorResult`

Add:

```py
cost_efficiency_score: int = 50
cost_optimization_priority: int = 0
estimated_token_reduction_pct: int | None = None
estimated_latency_reduction_pct: int | None = None
cost_optimization_hints: list[str] = field(default_factory=list)
script_replacement_hints: list[str] = field(default_factory=list)
llm_still_required_reasons: list[str] = field(default_factory=list)
```

---

## 12. ADK deterministic cost analyzer

File:

```txt
yellowstorm-adk/src/flow_engine/advisor/execution_advisor_service.py
```

Create helper functions:

```py
def _estimate_prompt_tokens(request: ExecutionAdvisorRequest) -> int:
    usage_total = request.usage.get("totalTokens") or request.usage.get("total_tokens")
    if isinstance(usage_total, (int, float)) and usage_total > 0:
        return int(usage_total)

    prompt_chars = sum(len(str(item.get("prompt") or "")) for item in request.llm_prompt_trace)
    if prompt_chars > 0:
        return max(1, prompt_chars // 4)

    return max(1, len(request.task_description + request.task_output) // 4)
```

```py
def _looks_like_pure_transform(text: str) -> bool:
    keywords = {
        "parse", "normalize", "validate", "convert", "map", "filter",
        "sort", "calculate", "deduplicate", "extract", "format",
        "json", "csv", "table", "schema", "regex", "router", "condition"
    }
    lowered = text.lower()
    return any(keyword in lowered for keyword in keywords)
```

```py
def _looks_like_llm_required(text: str) -> list[str]:
    reasons = []
    lowered = text.lower()

    if any(k in lowered for k in ["research", "find latest", "current", "web", "news"]):
        reasons.append("The task appears to require external or current knowledge.")
    if any(k in lowered for k in ["write", "draft", "creative", "narrative", "persuasive"]):
        reasons.append("The task appears to require natural-language generation.")
    if any(k in lowered for k in ["analyze", "assess", "judge", "recommend", "strategy"]):
        reasons.append("The task appears to require semantic judgment or reasoning.")
    if any(k in lowered for k in ["approve", "human", "sensitive", "legal", "medical", "financial"]):
        reasons.append("The task may require human-sensitive review or policy judgment.")

    return reasons
```

```py
def analyze_cost_efficiency(request: ExecutionAdvisorRequest, determinism: int, specificity: int) -> dict[str, Any]:
    task_text = " ".join([
        request.task_title,
        request.task_description,
        request.expected_result,
        request.output_format_guide,
    ])

    estimated_tokens = _estimate_prompt_tokens(request)
    is_pure_transform = _looks_like_pure_transform(task_text)
    llm_reasons = _looks_like_llm_required(task_text)

    has_stable_contract = bool(request.expected_result.strip() or request.output_format_guide.strip())
    output_is_structured = request.task_output.strip().startswith(("{", "[", "|")) or "," in request.task_output[:200]

    hints = []
    script_hints = []

    priority = 0
    score = 75

    if estimated_tokens > 4000:
        priority += 30
        score -= 20
        hints.append("Prompt/context appears large; compact repeated instructions and only pass required upstream context.")

    if estimated_tokens > 8000:
        priority += 20
        hints.append("Step has very high token usage; consider splitting context or replacing deterministic parts.")

    if is_pure_transform and has_stable_contract:
        priority += 25
        hints.append("Task appears deterministic enough for cheaper execution.")
        if not llm_reasons and output_is_structured and determinism >= 70 and specificity >= 60:
            script_hints.append("Candidate for validated Python replacement because it looks like a pure structured transformation.")

    if llm_reasons:
        score -= 10
        hints.append("LLM inference may still be needed; optimize prompt and model before attempting replacement.")

    estimated_reduction = None
    if script_hints:
        estimated_reduction = 95
    elif hints:
        estimated_reduction = 25 if estimated_tokens <= 4000 else 40

    return {
        "cost_efficiency_score": max(0, min(100, score)),
        "cost_optimization_priority": max(0, min(100, priority)),
        "estimated_token_reduction_pct": estimated_reduction,
        "estimated_latency_reduction_pct": estimated_reduction,
        "cost_optimization_hints": hints,
        "script_replacement_hints": script_hints,
        "llm_still_required_reasons": llm_reasons,
    }
```

Call this inside `evaluate_task_execution` after determinism/specificity are computed:

```py
cost_findings = analyze_cost_efficiency(request, determinism, specificity)
```

Pass fields into `ExecutionAdvisorResult`.

### 12.1 Recommended action override

After existing recommended-action logic:

```py
if cost_findings["script_replacement_hints"] and cost_findings["cost_optimization_priority"] >= 70:
    recommended_action = "replace_with_deterministic_script"
elif cost_findings["cost_optimization_priority"] >= 50:
    recommended_action = "optimize_prompt_cost"
```

Only override if there is no blocking quality issue:

```py
if blocking_issue_count == 0:
    # allow cost action override
```

---

## 13. Proto and gRPC changes

Files:

```txt
yellowstorm-adk/grpc/proto/chatbot.proto
YellowStorm/back/src/modules/conversation/proto/chatbot.proto
```

Add request fields to `TaskAdvisorRequest`:

```proto
google.protobuf.Struct usage = <next_id>;
repeated TaskAdvisorPromptTraceItem llm_prompt_trace = <next_id>;
```

Add message:

```proto
message TaskAdvisorPromptTraceItem {
    string stage = 1;
    string model = 2;
    string prompt = 3;
}
```

Add result fields to `TaskAdvisorResult`:

```proto
int32 cost_efficiency_score = <next_id>;
int32 cost_optimization_priority = <next_id>;
google.protobuf.Value estimated_token_reduction_pct = <next_id>;
google.protobuf.Value estimated_latency_reduction_pct = <next_id>;
repeated string cost_optimization_hints = <next_id>;
repeated string script_replacement_hints = <next_id>;
repeated string llm_still_required_reasons = <next_id>;
```

If nullable numeric values are awkward in the current generated client, use `int32` with `-1` as unknown:

```proto
int32 estimated_token_reduction_pct = <next_id>;   // -1 means unknown
int32 estimated_latency_reduction_pct = <next_id>; // -1 means unknown
```

Then map `-1` back to `null` in TypeScript.

Update:

```txt
yellowstorm-adk/src/grpc_server/chatbot_servicer.py
```

Map new fields into `TaskAdvisorResult`.

Regenerate stubs for both backend and ADK after proto changes.

---

## 14. LLM evaluator changes

File:

```txt
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-llm-advisor-evaluator.service.ts
```

The LLM evaluator already includes prompt trace and records usage for advisor evaluation. Add task execution usage/prompt trace into the judge prompt variables if useful:

```ts
taskExecutionUsageJson: JSON.stringify(params.taskResult.usage ?? null, null, 2),
taskExecutionPromptTraceJson: JSON.stringify(params.taskResult.llmPromptTrace ?? [], null, 2),
```

Update the prompt seed user template to include:

```txt
Task execution usage:
{{taskExecutionUsageJson}}

Task execution prompt trace:
{{taskExecutionPromptTraceJson}}
```

Keep this compact. Do not pass full huge prompt traces blindly into the judge if they are too large. Prefer summaries:

```ts
private summarizePromptTrace(trace: unknown): Array<{ stage: string; model: string; chars: number; preview: string }> {
  ...
}
```

---

## 15. Dedicated Python script replacement flow

Script replacement should be separate from generic remediation preview.

### 15.1 New endpoints

Add endpoints similar to:

```txt
POST /playbook-flows/:flowId/advisor/remediations/script-preview
POST /playbook-flows/:flowId/advisor/remediations/script-apply
```

DTO:

```ts
export class PreviewAdvisorScriptReplacementDto {
  @IsString()
  executionId!: string;

  @IsString()
  targetTaskId!: string;

  @IsArray()
  items!: PreviewAdvisorRemediationItemDto[];

  @IsOptional()
  @IsArray()
  validationIterationIds?: number[];
}
```

Response:

```ts
export interface AdvisorScriptReplacementPreviewResponse {
  targetTaskId: string;
  candidate: {
    language: 'python';
    runtime: 'python3.11';
    script: string;
    entrypoint: 'run';
    inputContract: Record<string, unknown>;
    outputContract: Record<string, unknown>;
    dependencies: string[];
    deterministic: boolean;
  };
  validation: {
    status: 'passed' | 'failed' | 'needs_review';
    sampleCount: number;
    passedCount: number;
    failedCount: number;
    failures: Array<{
      iteration: number;
      reason: string;
      expectedSummary: string;
      actualSummary: string;
    }>;
  };
  estimatedTokenReductionPct: number | null;
  warnings: string[];
}
```

### 15.2 Script generation prompt

Add seed prompt:

```txt
key: 'advisor.generate_deterministic_script'
category: 'judge'
title: 'Advisor deterministic script generation'
```

System prompt:

```txt
You convert a deterministic playbook step into a safe Python transform.

Return JSON only with:
- language
- runtime
- entrypoint
- script
- inputContract
- outputContract
- dependencies
- assumptions
- unsafeReasons

Rules:
- Generate pure Python only.
- No network access.
- No file system access unless explicitly required by the contract.
- No subprocess.
- No dynamic imports.
- No eval or exec.
- No secrets.
- No external side effects.
- Expose function run(inputs: dict) -> dict.
- Preserve the declared output contract.
- If the task requires LLM reasoning, return unsafeReasons instead of code.
```

User prompt variables:

```txt
Playbook:
{{playbookJson}}

Selected task:
{{taskJson}}

Previous task result:
{{taskResultJson}}

Advisor findings:
{{advisorFindingsJson}}

Expected result:
{{expectedResult}}

Output format guide:
{{outputFormatGuide}}
```

### 15.3 Script validation

Validation should happen before apply.

Validation steps:

1. Load historical task inputs and outputs for the selected task.
2. Run generated script in a restricted sandbox.
3. Compare generated output to previous output and/or expected result.
4. Require exact or schema-compatible match for deterministic transforms.
5. Fail if script raises exception, imports unsafe modules, returns invalid shape, or produces unstable output.

Minimum validation policy:

```txt
- At least one sample must pass.
- All selected validation samples must pass.
- Script must be deterministic across two runs with same input.
- Output must match declared output ports.
- No blocked imports or side effects.
```

Blocked Python features:

```txt
eval
exec
compile
open
__import__
subprocess
socket
requests
httpx
urllib
os.system
pathlib.Path.write*
shutil
pickle
marshal
ctypes
```

Allowed standard modules:

```txt
json
re
math
statistics
datetime
decimal
csv
html
base64
hashlib
itertools
collections
typing
```

### 15.4 Apply script replacement

Initially store on node metadata:

```ts
metadata: {
  ...existingMetadata,
  executionStrategy: 'deterministic_script',
  scriptRuntime: 'python3.11',
  scriptEntrypoint: 'run',
  scriptSource: {
    kind: 'advisor_generated',
    language: 'python',
    code: generatedScript,
    sha256: scriptHash,
  },
  scriptValidation: {
    status: 'passed',
    sampleCount,
    passedCount,
    failedCount,
    appliedAt,
    appliedFromExecutionId,
  },
}
```

Later, move to a first-class node template or action configuration.

---

## 16. Runtime execution strategy

Add an execution strategy concept:

```ts
type FlowNodeExecutionStrategy =
  | 'llm'
  | 'deterministic_script'
  | 'cached'
  | 'router_condition';
```

For V1, store in metadata:

```ts
metadata.executionStrategy
```

For V2, promote to a first-class node field when stable.

Runtime behavior:

```txt
if node.metadata.executionStrategy === 'deterministic_script':
    run script executor
else:
    run existing LLM/agent executor
```

Task result should record:

```ts
traceMetadata: {
  executionStrategy: 'deterministic_script',
  scriptHash: 'sha256:...',
  llmInferenceSkipped: true,
  estimatedTokensAvoided: 1234,
}
```

This is important because future Advisor evaluations need to know when cost optimization worked.

---

## 17. Cost scoring model

### 17.1 Inputs

Use these signals:

```txt
taskResult.usage.inputTokens
taskResult.usage.outputTokens
taskResult.usage.totalTokens
taskResult.usage.model
taskResult.llmPromptTrace[].prompt length
taskResult.toolTrace
taskResult.output
node.description
node.metadata.expectedResult
outputFormatGuide
judgeResult.determinismScore
judgeResult.specificityScore
judgeResult.formatComplianceScore
```

### 17.2 Score definitions

```txt
costEfficiencyScore:
100 = already cheap or LLM clearly necessary
50  = moderate cost opportunity
0   = expensive and likely avoidable
```

```txt
costOptimizationPriority:
100 = high cost and strong deterministic alternative
50  = prompt/model/cache optimization likely useful
0   = no meaningful cost opportunity
```

### 17.3 Priority heuristics

Increase priority when:

```txt
+ high input token usage
+ high repeated prompt text
+ same step reruns often with same input
+ output is structured
+ task description is deterministic
+ expected result/output format guide exists
+ no unsupported claims
+ high determinism score
+ high format compliance score
```

Decrease priority when:

```txt
- task requires research
- task requires judgment
- task requires creative writing
- task requires current knowledge
- task triggers HITL/security/sensitive rules
- output is free-form synthesis
- unsupported claims or missing facts exist
```

---

## 18. Safety and governance rules

Script replacement must be blocked when:

```txt
- task has external side effects
- task sends emails/messages
- task writes to external systems
- task needs web/current data
- task requires human approval
- task is legal/medical/financial judgment
- task output is creative or subjective
- task uses hidden credentials/secrets
- validation sample fails
- script imports blocked modules
```

Prompt/model optimization may still be recommended in those cases.

---

## 19. Frontend behavior

Add a new remediation badge:

```txt
Cost efficiency
```

Recommended UI elements:

```txt
- Category badge: Cost efficiency
- Estimated token reduction
- Estimated latency reduction
- Suggested action
- Risk label
- “Optimize prompt” button
- “Preview script replacement” button when available
```

For script preview:

```txt
Panel sections:
1. Why this is a candidate
2. Generated Python
3. Input/output contract
4. Validation results
5. Warnings
6. Apply button disabled until validation passes
```

Default selection rules:

```txt
costOptimizationHints: selected by default
scriptReplacementHints: not selected by default
llmStillRequiredReasons: informational only
```

---

## 20. Testing plan

### 20.1 Unit tests

Backend:

```txt
- category validation accepts cost_efficiency
- remediation items are generated from costOptimizationHints
- scriptReplacementHints map to replace_with_deterministic_script
- mapGrpcJudgeResult maps new fields
- mapLlmJudgeResult maps new fields
- default values are safe when fields are absent
```

ADK:

```txt
- pure transform task creates scriptReplacementHints
- research task creates llmStillRequiredReasons
- high token usage creates costOptimizationHints
- low-token simple task has low priority
- blocking quality issues prevent recommendedAction override
```

### 20.2 Integration tests

```txt
- heuristic advisor returns cost fields through gRPC
- LLM advisor parses cost fields from judge JSON
- remediation preview still works for existing categories
- optimize-step with cost_efficiency returns update_node only
- script-preview rejects unsafe task
- script-preview validates safe transform
```

### 20.3 Regression tests

```txt
- existing judge history remains readable
- old judge results without cost fields do not break UI/API
- existing advisor scoring modes still work
- existing prompt seed remains JSON-compatible
```

---

## 21. Rollout plan

### Phase 1 — Cost category and prompt optimization

Deliver:

```txt
- Add cost_efficiency category
- Add cost fields to judge result
- Add prompt seed instructions
- Add remediation mapping
- Add backend defaults
- Show findings in UI
```

No script generation yet.

### Phase 2 — Deterministic candidate detection

Deliver:

```txt
- Add deterministic ADK cost analyzer
- Add usage and prompt trace to advisor request
- Add scriptReplacementHints
- Add llmStillRequiredReasons
- Do not apply code automatically
```

### Phase 3 — Script preview and validation

Deliver:

```txt
- Add script-preview endpoint
- Add script generation prompt
- Add sandbox validation
- Add validation response UI
- Require explicit user approval
```

### Phase 4 — Runtime deterministic execution

Deliver:

```txt
- Add executionStrategy metadata
- Add deterministic script executor
- Record llmInferenceSkipped in traceMetadata
- Add rollback path to restore LLM execution
```

### Phase 5 — Hardening

Deliver:

```txt
- First-class node template for python_transform
- Caching strategy
- Cheaper model recommendations
- Router-condition replacement
- Cost analytics dashboard
```

---

## 22. Minimal first PR checklist

A minimal first PR should include:

```txt
[ ] Add cost_efficiency to AdvisorRemediationCategory
[ ] Add cost_efficiency to PreviewAdvisorRemediationDto categories
[ ] Add cost fields to FlowExecutionJudgeResult
[ ] Add cost fields to FlowTaskJudgeResult schema
[ ] Update mapper defaults for LLM and gRPC judge results
[ ] Update judge.node_reflection seed prompt
[ ] Add cost field mappings in getRemediations
[ ] Add tests for DTO validation and mapper defaults
```

This PR can be merged without runtime script execution.

---

## 23. Suggested file-by-file patch outline

### `playbook-flow-execution-advisor.interface.ts`

```txt
- Add category: cost_efficiency
- Add suggested actions:
  - optimize_prompt_cost
  - switch_to_cheaper_model
  - add_result_cache
  - replace_with_deterministic_script
- Add cost fields to FlowExecutionJudgeResult
```

### `preview-advisor-remediation.dto.ts`

```txt
- Add cost_efficiency to REMEDIATION_CATEGORIES
```

### `playbook-flow-task-result.schema.ts`

```txt
- Add optional cost fields to FlowTaskJudgeResult
```

### `playbook-flow-execution-advisor.mapper.ts`

```txt
- Add mapping for new cost fields
- Add recommended action enum support
- Optionally add usage and prompt trace to heuristic gRPC request
```

### `playbook-flow-execution-advisor.service.ts`

```txt
- Add remediation mapping for costOptimizationHints and scriptReplacementHints
- Customize suggestedAction and severity for cost findings
- Add cost-specific wording in buildRemediationIntent for optimize-step
```

### `playbook-flow-prompt-seed.ts`

```txt
- Update judge.node_reflection output contract
- Add cost-efficiency scoring and rules
- Extend recommendedAction allowed values
```

### `execution_advisor_models.py`

```txt
- Add usage and llm_prompt_trace to request
- Add cost fields to result
```

### `execution_advisor_service.py`

```txt
- Add deterministic cost analyzer helpers
- Include cost fields in result
- Override recommendedAction only when quality is not blocking
```

### `chatbot.proto`

```txt
- Add request prompt trace/usage fields if heuristic analyzer needs them
- Add cost fields to TaskAdvisorResult
- Regenerate generated files
```

### `chatbot_servicer.py`

```txt
- Map cost fields from evaluate_task_execution result to TaskAdvisorResult
```

---

## 24. Acceptance criteria

The feature is complete when:

```txt
- Advisor can emit cost_efficiency remediation items.
- Existing advisor evaluations do not break if cost fields are missing.
- Cost findings appear with meaningful severity and suggested action.
- Prompt optimization works through the existing optimize-step remediation path.
- Script replacement is never auto-applied.
- Script replacement recommendations are only shown for deterministic candidates.
- Generated script preview cannot be applied unless validation passes.
- Runtime can skip LLM inference for approved deterministic script nodes.
- Trace metadata records that LLM inference was skipped.
```

---

## 25. Recommended naming

Use these names consistently:

```txt
Category: cost_efficiency
Action: optimize_prompt_cost
Action: switch_to_cheaper_model
Action: add_result_cache
Action: replace_with_deterministic_script
Score: costEfficiencyScore
Priority: costOptimizationPriority
Hints: costOptimizationHints
Hints: scriptReplacementHints
Reasons: llmStillRequiredReasons
Execution strategy: deterministic_script
Template type later: python_transform
```

---

## 26. Key implementation principle

Do not treat this as only a prompt optimization feature.

The strategic feature is:

```txt
The Advisor progressively converts expensive agentic steps into cheaper, validated, deterministic execution units whenever safe.
```

That makes the playbook engine more cost-efficient over time while preserving the flexibility of LLM-based execution for tasks that genuinely require reasoning.
