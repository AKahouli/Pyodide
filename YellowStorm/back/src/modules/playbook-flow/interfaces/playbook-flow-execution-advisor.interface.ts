import type { AdvisorScoringMode } from '../schemas/playbook-flow.schema';

export interface FlowExecutionJudgeResult {
  accuracyScore: number;
  completenessScore: number;
  resultMatchingScore: number;
  overallScore: number;
  confidence: number;
  toolUsageScore: number;
  relevanceScore: number;
  specificityScore: number;
  formatComplianceScore: number;
  evidenceGroundingScore: number;
  handoffReadinessScore: number;
  hitlAppropriatenessScore: number;
  determinismScore: number;
  stepOptimizationPriority: number;
  playbookOptimizationPriority: number;
  riskSeverity: 'low' | 'medium' | 'high' | 'critical';
  blockingIssueCount: number;
  downstreamImpactLevel: 'none' | 'low' | 'medium' | 'high';
  recommendedAction: 'optimize_step' | 'optimize_playbook' | 'review_only' | 'add_hitl_guard' | 'improve_tooling' | 'improve_output_contract';
  availableActions: { optimizeStep: true; optimizePlaybook: true };
  expectedResultSource: 'node_field' | 'golden_baseline' | 'none';
  expectedResultType: 'exact_value' | 'semantic_description' | 'numeric_presentation' | 'document_generation' | 'baseline_comparison' | 'none';
  expectedResultMatched: boolean;
  expectedResultReason: string;
  missingFacts: string[];
  incoherences: string[];
  unsupportedClaims: string[];
  handoffRisks: string[];
  rewriteHints: string[];
  toolSelectionIssues: string[];
  missingToolCalls: string[];
  redundantToolCalls: string[];
  toolOutputUseIssues: string[];
  toolSequencingIssues: string[];
  toolUsageStrengths: string[];
  toolUsageRecommendation: string;
  safeAutoFixType: 'optimize_step' | 'none';
  recommendation: 'none' | 'update_current_playbook' | 'generate_new_optimized_playbook';
  reason: string;
}

export interface FlowExecutionJudgeUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  model?: string | null;
}

export interface FlowExecutionJudgePromptTraceItem {
  stage: string;
  model: string;
  prompt: string;
}

export interface FlowExecutionJudgeHistoryEntry {
  id: string;
  createdAt: string;
  attemptNumber: number | null;
  model: string | null;
  scoringMode: AdvisorScoringMode;
  usage?: FlowExecutionJudgeUsage | null;
  llmPromptTrace?: FlowExecutionJudgePromptTraceItem[];
  judgeResult: FlowExecutionJudgeResult;
}

export interface FlowExecutionAdvisorEvaluationResult {
  judgeResult: FlowExecutionJudgeResult;
  model: string | null;
  scoringMode: AdvisorScoringMode;
  usage?: FlowExecutionJudgeUsage | null;
  llmPromptTrace?: FlowExecutionJudgePromptTraceItem[];
}

export interface FlowExecutionAdvisorTaskResponse {
  executionId: string;
  taskId: string;
  taskResult: {
    taskId: string;
    iteration?: number;
    status: string;
    output?: unknown;
    error?: string;
    judgeStatus: 'idle' | 'evaluating' | 'evaluated' | 'failed';
    judgeScoringMode?: AdvisorScoringMode | null;
    judgeResult: FlowExecutionJudgeResult | null;
    judgeError: string | null;
    judgeHistory: FlowExecutionJudgeHistoryEntry[];
  };
}

export type AdvisorRemediationCategory = 'structure' | 'prompt' | 'contract' | 'handoff' | 'tooling' | 'evidence' | 'outputFormat' | 'format' | 'hitl' | 'determinism' | 'expected_result';
export type AdvisorRemediationSuggestedAction = 'optimize_step' | 'optimize_playbook' | 'add_hitl_guard' | 'improve_tooling' | 'improve_output_contract';

export interface AdvisorRemediationItem {
  id: string;
  category: AdvisorRemediationCategory;
  scope: 'task' | 'playbook';
  targetTaskId: string | null;
  title: string;
  description: string;
  rationale?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  suggestedAction: AdvisorRemediationSuggestedAction;
  blocking: boolean;
  editable: boolean;
  defaultSelected: boolean;
  source: {
    kind: string;
    field: string;
    index: number;
  };
}
