import { PublicReasoningTraceItem } from './playbook-flow-reasoning.interface';

export interface FlowToolTraceItem {
  callIndex: number;
  toolName: string;
  purpose?: string | null;
  args: Record<string, unknown>;
  outputSummary?: string | null;
  status?: 'completed' | 'failed' | 'skipped' | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface FlowLlmPromptTraceItem {
  stage: string;
  model: string;
  prompt: string;
  generatedOutput?: string | null;
}

export interface FlowUsageSummary {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  model?: string | null;
}

export interface FlowSemanticMatchSummary {
  matchScore?: number;
  semanticSimilarityScore?: number;
  evidenceConsistencyScore?: number;
  judgeScore?: number;
  reason?: string;
  missingPoints?: string[];
  changedPoints?: string[];
  model?: string;
  judgeUsed?: boolean;
}

export interface FlowCompletedResultPayload {
  output: string;
  displayText?: string;
  outputs?: Record<string, unknown>;
  artifacts?: Record<string, unknown>[];
  components?: Record<string, unknown>[];
  toolTrace?: FlowToolTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
  llmPromptTrace?: FlowLlmPromptTraceItem[];
  usage?: FlowUsageSummary | null;
  semanticMatch?: FlowSemanticMatchSummary | null;
  traceMetadata?: Record<string, unknown>;
  iteratorIterations?: Record<string, unknown>[];
}
