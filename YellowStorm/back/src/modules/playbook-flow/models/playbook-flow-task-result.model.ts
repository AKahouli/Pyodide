import { ADVISOR_SCORING_MODES, AdvisorScoringMode } from './playbook-flow.model';

export class FlowTaskToolTraceItem {
  callIndex!: number;

  toolName!: string;

  purpose?: string | null;

  args!: Record<string, unknown>;

  outputSummary?: string | null;

  status?: string | null;

  durationMs?: number | null;

  error?: string | null;
}

export class FlowTaskLlmPromptTraceItem {
  stage!: string;

  model!: string;

  prompt!: string;

  generatedOutput?: string | null;
}

export class FlowTaskPublicReasoningTraceItem {
  id!: string;

  type!: string;

  label!: string;

  description!: string;

  confidence?: number | null;
}

export class FlowTaskUsage {
  inputTokens?: number | null;

  outputTokens?: number | null;

  totalTokens?: number | null;

  model?: string | null;
}

export class FlowTaskSemanticFinding {
  key?: string | null;

  expected?: string | null;

  observed?: string | null;

  severity!: 'info' | 'warning' | 'fail';
}

export class FlowTaskSemanticMatch {
  matchScore?: number;

  semanticSimilarityScore?: number;

  evidenceConsistencyScore?: number;

  judgeScore?: number;

  reason?: string;

  missingPoints?: string[];

  changedPoints?: string[];

  preservedPoints?: string[];

  missingPointFindings?: FlowTaskSemanticFinding[];

  changedPointFindings?: FlowTaskSemanticFinding[];

  extraPointFindings?: FlowTaskSemanticFinding[];

  staleContextReferenceFindings?: FlowTaskSemanticFinding[];

  unsupportedClaimFindings?: FlowTaskSemanticFinding[];

  evaluationSource?: 'instantiated_replay' | 'runtime' | 'unknown' | null;

  model?: string;

  judgeUsed?: boolean;
}

export class FlowTaskJudgeResult {
  accuracyScore?: number;

  completenessScore?: number;

  resultMatchingScore?: number;

  overallScore?: number;

  confidence?: number;

  toolUsageScore?: number;

  relevanceScore?: number;

  specificityScore?: number;

  formatComplianceScore?: number;

  evidenceGroundingScore?: number;

  handoffReadinessScore?: number;

  hitlAppropriatenessScore?: number;

  determinismScore?: number;

  costEfficiencyScore?: number;

  stepOptimizationPriority?: number;

  playbookOptimizationPriority?: number;

  costOptimizationPriority?: number;

  estimatedTokenReductionPct?: number | null;

  estimatedLatencyReductionPct?: number | null;

  riskSeverity?: string;

  blockingIssueCount?: number;

  downstreamImpactLevel?: string;

  recommendedAction?: string;

  availableActions?: { optimizeStep: boolean; optimizePlaybook: boolean };

  expectedResultSource?: string;

  expectedResultType?: string;

  expectedResultMatched?: boolean;

  expectedResultReason?: string;

  missingFacts?: string[];

  incoherences?: string[];

  unsupportedClaims?: string[];

  handoffRisks?: string[];

  rewriteHints?: string[];

  toolSelectionIssues?: string[];

  missingToolCalls?: string[];

  redundantToolCalls?: string[];

  toolOutputUseIssues?: string[];

  toolSequencingIssues?: string[];

  toolUsageStrengths?: string[];

  toolUsageRecommendation?: string;

  costOptimizationHints?: string[];

  scriptReplacementHints?: string[];

  llmStillRequiredReasons?: string[];

  safeAutoFixType?: string;

  recommendation?: string;

  reason?: string;
}

export class FlowTaskJudgeHistoryEntry {
  id!: string;

  createdAt!: Date;

  attemptNumber?: number | null;

  model?: string | null;

  scoringMode?: AdvisorScoringMode;

  usage?: FlowTaskUsage | null;

  llmPromptTrace?: FlowTaskLlmPromptTraceItem[];

  judgeResult!: FlowTaskJudgeResult;
}

export class FlowTaskResult {
  executionId!: string;

  taskId!: string;

parentTaskId?: string;
runtimeSubgraphId?: string;
generatedLocalNodeId?: string;
generatedNodeTitle?: string;

  iteration!: number;

  status!: string;

  output?: unknown;

  displayText?: string;

  outputs?: Record<string, unknown>;

  artifacts?: Record<string, unknown>[];

  components?: Record<string, unknown>[];

  iteratorIterations?: Record<string, unknown>[];

  error?: string;

  startedAt?: Date;

  endedAt?: Date;

  toolTrace?: FlowTaskToolTraceItem[];

  reasoningChain?: FlowTaskPublicReasoningTraceItem[];

  llmPromptTrace?: FlowTaskLlmPromptTraceItem[];

  usage?: FlowTaskUsage | null;

  semanticMatch?: FlowTaskSemanticMatch | null;

  traceMetadata?: Record<string, unknown>;

  judgeStatus?: string;

  judgeResult?: FlowTaskJudgeResult | null;

  judgeScoringMode?: AdvisorScoringMode | null;

  judgeError?: string | null;

  judgeHistory?: FlowTaskJudgeHistoryEntry[];
}

