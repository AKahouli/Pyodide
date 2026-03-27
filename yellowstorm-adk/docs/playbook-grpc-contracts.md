# Playbook ADK gRPC Contracts

## Scope

This document summarizes the gRPC surface the ADK exposes for Playbook execution.

## Main RPCs

- `GeneratePlaybook`
- `RunPlaybookWorkflow`
- `ResumePlaybookWorkflow`
- `RunStep`
- `ResumeStep`
- `StopPlaybookWorkflow`
- `EvaluateSemanticMatch`

## Important Message Types

- `PlaybookTaskConfig`
- `PlaybookEdgeConfig`
- `RunPlaybookWorkflowRequest`
- `ResumePlaybookWorkflowRequest`
- `PlaybookTaskResult`
- `PlaybookStepUpdate`
- `PlaybookStreamChunk`
- `InterruptPayload`
- `SemanticMatch`
- `EvaluateSemanticMatchRequest`
- `EvaluateSemanticMatchResponse`

## Notable Task and Result Fields

Current contracts include:

- `PlaybookTaskConfig.input_files`
- `PlaybookTaskResult.tool_trace`
- `PlaybookTaskResult.llm_prompt_trace`
- `PlaybookTaskResult.semantic_match`

These fields support:

- document-scoped tool execution
- replay provenance
- prompt inspection
- semantic comparison against validated baselines

## Contract Roles

The ADK is responsible for:

- accepting normalized playbook graphs from Nest
- executing either a single step or a full workflow
- streaming step updates back to Nest
- suspending and resuming HITL workflows
- evaluating semantic similarity for completed task outputs

