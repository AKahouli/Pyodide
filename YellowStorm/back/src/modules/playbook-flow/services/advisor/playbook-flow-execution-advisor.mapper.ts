import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FlowNode } from '../../models/playbook-flow.model';
import type { TaskResultRecord } from '../../persistence/task-result.repository';
import type {
  FlowExecutionAdvisorEvaluationResult,
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
    taskResult: TaskResultRecord | Record<string, unknown>;
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
      usage: this.buildUsage(params.taskResult),
      llm_prompt_trace: Array.isArray(params.taskResult.llmPromptTrace)
        ? params.taskResult.llmPromptTrace.map((item: any) => ({
            stage: String(item.stage || ''),
            model: String(item.model || ''),
            prompt: String(item.prompt || ''),
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
    const numberValueWithDefault = (key: string, fallback: number) => {
      const value = raw[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };
    const stringValue = (key: string) => String(raw[key] || '');
    const nullableNumberValue = (key: string) => {
      const value = raw[key];
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    };

    return {
      accuracyScore: numberValue('accuracy_score'),
      completenessScore: numberValue('completeness_score'),
      resultMatchingScore: numberValue('result_matching_score'),
      overallScore: numberValue('overall_score'),
      confidence: numberValue('confidence'),
      toolUsageScore: numberValue('tool_usage_score'),
      relevanceScore: numberValue('relevance_score'),
      specificityScore: numberValue('specificity_score'),
      formatComplianceScore: numberValue('format_compliance_score'),
      evidenceGroundingScore: numberValue('evidence_grounding_score'),
      handoffReadinessScore: numberValue('handoff_readiness_score'),
      hitlAppropriatenessScore: numberValue('hitl_appropriateness_score'),
      determinismScore: numberValue('determinism_score'),
      costEfficiencyScore: numberValueWithDefault('cost_efficiency_score', 50),
      stepOptimizationPriority: numberValue('step_optimization_priority'),
      playbookOptimizationPriority: numberValue('playbook_optimization_priority'),
      costOptimizationPriority: numberValue('cost_optimization_priority'),
      estimatedTokenReductionPct: nullableNumberValue('estimated_token_reduction_pct'),
      estimatedLatencyReductionPct: nullableNumberValue('estimated_latency_reduction_pct'),
      riskSeverity: this.mapRiskSeverity(raw.risk_severity),
      blockingIssueCount: numberValue('blocking_issue_count'),
      downstreamImpactLevel: this.mapDownstreamImpactLevel(raw.downstream_impact_level),
      recommendedAction: this.mapRecommendedAction(raw.recommended_action),
      availableActions: { optimizeStep: true, optimizePlaybook: true },
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
      costOptimizationHints: list('cost_optimization_hints'),
      scriptReplacementHints: list('script_replacement_hints'),
      llmStillRequiredReasons: list('llm_still_required_reasons'),
      safeAutoFixType: raw.safe_auto_fix_type === 'optimize_step' ? 'optimize_step' : 'none',
      recommendation: this.mapRecommendation(raw.recommendation),
      reason: stringValue('reason'),
    };
  }

  mapLlmJudgeResult(rawContent: string): FlowExecutionJudgeResult {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawContent) as Record<string, unknown>;
    } catch {
      throw new Error('Advisor evaluation returned invalid JSON.');
    }

    const list = (key: keyof FlowExecutionJudgeResult) => Array.isArray(parsed[key]) ? parsed[key].map(String) : [];
    const score = (key: keyof FlowExecutionJudgeResult) => this.clampScore(parsed[key]);
    const text = (key: keyof FlowExecutionJudgeResult) => typeof parsed[key] === 'string' ? parsed[key] : '';
    const nullableScore = (key: keyof FlowExecutionJudgeResult) => this.nullableScore(parsed[key]);

    return {
      accuracyScore: score('accuracyScore'),
      completenessScore: score('completenessScore'),
      resultMatchingScore: score('resultMatchingScore'),
      overallScore: score('overallScore'),
      confidence: score('confidence'),
      toolUsageScore: score('toolUsageScore'),
      relevanceScore: score('relevanceScore'),
      specificityScore: score('specificityScore'),
      formatComplianceScore: score('formatComplianceScore'),
      evidenceGroundingScore: score('evidenceGroundingScore'),
      handoffReadinessScore: score('handoffReadinessScore'),
      hitlAppropriatenessScore: score('hitlAppropriatenessScore'),
      determinismScore: score('determinismScore'),
      costEfficiencyScore: Object.prototype.hasOwnProperty.call(parsed, 'costEfficiencyScore')
        ? score('costEfficiencyScore')
        : 50,
      stepOptimizationPriority: score('stepOptimizationPriority'),
      playbookOptimizationPriority: score('playbookOptimizationPriority'),
      costOptimizationPriority: score('costOptimizationPriority'),
      estimatedTokenReductionPct: nullableScore('estimatedTokenReductionPct'),
      estimatedLatencyReductionPct: nullableScore('estimatedLatencyReductionPct'),
      riskSeverity: this.mapRiskSeverity(parsed.riskSeverity),
      blockingIssueCount: typeof parsed.blockingIssueCount === 'number' && Number.isFinite(parsed.blockingIssueCount)
        ? Math.max(0, Math.round(parsed.blockingIssueCount))
        : 0,
      downstreamImpactLevel: this.mapDownstreamImpactLevel(parsed.downstreamImpactLevel),
      recommendedAction: this.mapRecommendedAction(parsed.recommendedAction),
      availableActions: { optimizeStep: true, optimizePlaybook: true },
      expectedResultSource: this.mapExpectedResultSource(parsed.expectedResultSource),
      expectedResultType: this.mapExpectedResultType(parsed.expectedResultType),
      expectedResultMatched: Boolean(parsed.expectedResultMatched),
      expectedResultReason: text('expectedResultReason'),
      missingFacts: list('missingFacts'),
      incoherences: list('incoherences'),
      unsupportedClaims: list('unsupportedClaims'),
      handoffRisks: list('handoffRisks'),
      rewriteHints: list('rewriteHints'),
      toolSelectionIssues: list('toolSelectionIssues'),
      missingToolCalls: list('missingToolCalls'),
      redundantToolCalls: list('redundantToolCalls'),
      toolOutputUseIssues: list('toolOutputUseIssues'),
      toolSequencingIssues: list('toolSequencingIssues'),
      toolUsageStrengths: list('toolUsageStrengths'),
      toolUsageRecommendation: text('toolUsageRecommendation'),
      costOptimizationHints: list('costOptimizationHints'),
      scriptReplacementHints: list('scriptReplacementHints'),
      llmStillRequiredReasons: list('llmStillRequiredReasons'),
      safeAutoFixType: parsed.safeAutoFixType === 'optimize_step' ? 'optimize_step' : 'none',
      recommendation: this.mapRecommendation(parsed.recommendation),
      reason: text('reason'),
    };
  }

  buildHistoryEntry(evaluation: FlowExecutionAdvisorEvaluationResult, attemptNumber: number): FlowExecutionJudgeHistoryEntry {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      attemptNumber,
      model: evaluation.model,
      scoringMode: evaluation.scoringMode,
      usage: evaluation.usage ?? null,
      llmPromptTrace: evaluation.llmPromptTrace ?? [],
      judgeResult: evaluation.judgeResult,
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
    judgeScoringMode?: import('../../models/playbook-flow.model').AdvisorScoringMode | null;
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
        judgeScoringMode: params.judgeScoringMode ?? null,
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

  private mapRiskSeverity(value: unknown): FlowExecutionJudgeResult['riskSeverity'] {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
      ? value
      : 'low';
  }

  private mapDownstreamImpactLevel(value: unknown): FlowExecutionJudgeResult['downstreamImpactLevel'] {
    return value === 'none' || value === 'low' || value === 'medium' || value === 'high'
      ? value
      : 'none';
  }

  private mapRecommendedAction(value: unknown): FlowExecutionJudgeResult['recommendedAction'] {
    return value === 'optimize_step'
      || value === 'optimize_playbook'
      || value === 'review_only'
      || value === 'add_hitl_guard'
      || value === 'improve_tooling'
      || value === 'improve_output_contract'
      || value === 'optimize_prompt_cost'
      || value === 'switch_to_cheaper_model'
      || value === 'add_result_cache'
      || value === 'replace_with_deterministic_script'
      ? value
      : 'review_only';
  }

  private buildUsage(taskResult: TaskResultRecord | Record<string, unknown>): Record<string, unknown> {
    const usage = (taskResult.usage ?? {}) as Record<string, unknown>;
    return {
      input_tokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
      output_tokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
      total_tokens: typeof usage.totalTokens === 'number' ? usage.totalTokens : 0,
      model: typeof usage.model === 'string' ? usage.model : '',
    };
  }

  private clampScore(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private nullableScore(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
  }
}
