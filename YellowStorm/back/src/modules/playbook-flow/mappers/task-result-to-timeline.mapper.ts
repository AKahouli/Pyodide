import { FlowTaskResult } from '../schemas/playbook-flow-task-result.schema';
import { IFlowTaskResultResponse } from '../interfaces/playbook-flow-execution.interface';
import {
  FlowLlmPromptTraceItem,
  FlowSemanticMatchSummary,
  FlowToolTraceItem,
  FlowUsageSummary,
} from '../interfaces/playbook-flow-observability.interface';
import { flattenUsage } from '../services/observability/playbook-flow-observability.mapper';

export function taskResultsToTimeline(results: FlowTaskResult[]): IFlowTaskResultResponse[] {
  return results.map((r) => {
    const doc = r as unknown as { _id?: string };
    return {
      id: (doc._id as string) || '',
      executionId: r.executionId,
      taskId: r.taskId,
      iteration: r.iteration,
      status: r.status,
      output: r.output,
      displayText: r.displayText,
      artifacts: r.artifacts,
      components: r.components,
      error: r.error,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      toolTrace: r.toolTrace as unknown as FlowToolTraceItem[] | undefined,
      llmPromptTrace: r.llmPromptTrace as unknown as FlowLlmPromptTraceItem[] | undefined,
      usage: r.usage as unknown as FlowUsageSummary | null | undefined,
      ...flattenUsage({ usage: r.usage as unknown as FlowUsageSummary | null | undefined }),
      semanticMatch: r.semanticMatch as unknown as FlowSemanticMatchSummary | null | undefined,
      traceMetadata: r.traceMetadata as unknown as Record<string, unknown> ?? {},
    };
  });
}
