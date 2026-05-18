import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FlowNode } from '../../schemas/playbook-flow.schema';
import type { FlowTaskResultDocument } from '../../schemas/playbook-flow-task-result.schema';
import type {
  FlowExecutionAdvisorTaskResponse,
  FlowExecutionJudgeHistoryEntry,
  FlowExecutionJudgeResult,
} from '../../interfaces/playbook-flow-execution-advisor.interface';
import { toGrpcStruct } from '../playbook-flow-execution.service';

@Injectable()
export class PlaybookFlowExecutionAdvisorMapper {
  buildEvaluateTaskRequest(params: {
    executionId: string;
    ownerId: string;
    flowId: string;
    node: FlowNode;
    taskResult: FlowTaskResultDocument | Record<string, unknown>;
    expectedResult: string | null;
    outputFormatGuide: string | null;
    baselineOutput: string | null;
  }): Record<string, unknown> {
    const metadata = (params.node.metadata ?? {}) as Record<string, unknown>;
    return {
      execution_id: params.executionId,
      owner_id: params.ownerId,
      playbook_id: params.flowId,
      task_id: params.node.id,
      task_title: params.node.label || params.node.id,
      task_description: params.node.description || String(metadata.description || ''),
      expected_result: params.expectedResult || '',
      output_format_guide: params.outputFormatGuide || '',
      baseline_output: params.baselineOutput || '',
      task_output: typeof params.taskResult.output === 'string'
        ? params.taskResult.output
        : JSON.stringify(params.taskResult.output ?? null),
      task_error: String(params.taskResult.error || ''),
      task_status: String(params.taskResult.status || ''),
      tool_trace: Array.isArray(params.taskResult.toolTrace)
        ? params.taskResult.toolTrace.map((item: any) => ({
            call_index: Number(item.callIndex || 0),
            tool_name: String(item.toolName || ''),
            output_summary: String(item.outputSummary || ''),
            args: toGrpcStruct((item.args ?? {}) as Record<string, unknown>),
          }))
        : [],
      artifacts_json: JSON.stringify(params.taskResult.artifacts ?? []),
      task_metadata: toGrpcStruct(metadata),
    };
  }

  mapGrpcJudgeResult(raw: Record<string, unknown>): FlowExecutionJudgeResult {
    const list = (key: string) => Array.isArray(raw[key]) ? raw[key].map(String) : [];
    const numberValue = (key: string) => {
      const value = raw[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    const stringValue = (key: string) => String(raw[key] || '');

    return {
      accuracyScore: numberValue('accuracy_score'),
      completenessScore: numberValue('completeness_score'),
      resultMatchingScore: numberValue('result_matching_score'),
      overallScore: numberValue('overall_score'),
      confidence: numberValue('confidence'),
      toolUsageScore: numberValue('tool_usage_score'),
      expectedResultSource: this.mapExpectedResultSource(raw.expected_result_source),
      expectedResultType: this.mapExpectedResultType(raw.expected_result_type),
      expectedResultMatched: Boolean(raw.expected_result_matched),
      expectedResultReason: stringValue('expected_result_reason'),
      missingFacts: list('missing_facts'),
      incoherences: list('incoherences'),
      unsupportedClaims: list('unsupported_claims'),
      handoffRisks: list('handoff_risks'),
      rewriteHints: list('rewrite_hints'),
      toolSelectionIssues: list('tool_selection_issues'),
      missingToolCalls: list('missing_tool_calls'),
      redundantToolCalls: list('redundant_tool_calls'),
      toolOutputUseIssues: list('tool_output_use_issues'),
      toolSequencingIssues: list('tool_sequencing_issues'),
      toolUsageStrengths: list('tool_usage_strengths'),
      toolUsageRecommendation: stringValue('tool_usage_recommendation'),
      safeAutoFixType: raw.safe_auto_fix_type === 'optimize_step' ? 'optimize_step' : 'none',
      recommendation: this.mapRecommendation(raw.recommendation),
      reason: stringValue('reason'),
    };
  }

  buildHistoryEntry(judgeResult: FlowExecutionJudgeResult, model: string | null, attemptNumber: number): FlowExecutionJudgeHistoryEntry {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      attemptNumber,
      model,
      judgeResult,
    };
  }

  buildResponse(params: {
    executionId: string;
    taskId: string;
    iteration?: number;
    taskStatus: string;
    taskOutput?: unknown;
    taskError?: string;
    judgeStatus: 'idle' | 'evaluating' | 'evaluated' | 'failed';
    judgeResult: FlowExecutionJudgeResult | null;
    judgeError: string | null;
    judgeHistory: FlowExecutionJudgeHistoryEntry[];
  }): FlowExecutionAdvisorTaskResponse {
    return {
      executionId: params.executionId,
      taskId: params.taskId,
      taskResult: {
        taskId: params.taskId,
        iteration: params.iteration,
        status: params.taskStatus,
        output: params.taskOutput,
        error: params.taskError,
        judgeStatus: params.judgeStatus,
        judgeResult: params.judgeResult,
        judgeError: params.judgeError,
        judgeHistory: params.judgeHistory,
      },
    };
  }

  private mapExpectedResultSource(value: unknown): FlowExecutionJudgeResult['expectedResultSource'] {
    return value === 'node_field' || value === 'golden_baseline' || value === 'none'
      ? value
      : 'none';
  }

  private mapExpectedResultType(value: unknown): FlowExecutionJudgeResult['expectedResultType'] {
    return value === 'exact_value'
      || value === 'semantic_description'
      || value === 'numeric_presentation'
      || value === 'document_generation'
      || value === 'baseline_comparison'
      || value === 'none'
      ? value
      : 'none';
  }

  private mapRecommendation(value: unknown): FlowExecutionJudgeResult['recommendation'] {
    return value === 'update_current_playbook' || value === 'generate_new_optimized_playbook' || value === 'none'
      ? value
      : 'none';
  }
}
