import { PendingApproval } from '../schemas/playbook-flow-execution.schema';
import type { ReplayPlanningSummary } from './playbook-flow-replay-plan.interface';
import {
  FlowLlmPromptTraceItem,
  FlowSemanticMatchSummary,
  FlowToolTraceItem,
  FlowUsageSummary,
} from './playbook-flow-observability.interface';
import { PublicReasoningTraceItem } from './playbook-flow-reasoning.interface';
import type { FlowExecutionJudgeHistoryEntry, FlowExecutionJudgeResult } from './playbook-flow-execution-advisor.interface';
import type { AdvisorScoringMode } from '../schemas/playbook-flow.schema';

export interface IFlowExecutionResponse {
  id: string;
  flowId: string;
  ownerId: string;
  schemaVersion: number;
  status: string;
  startedAt?: Date;
  endedAt?: Date;
  error?: string;
  recursionLimit: number;
  maxParallelism: number;
  inputContext?: Record<string, unknown>;
  idempotencyKey?: string;
  pendingApproval: PendingApproval | null;
  queuePosition?: number;
  threadId?: string;
  reflectionEnabled?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  replayPlanningByTask?: Record<string, ReplayPlanningSummary> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFlowExecutionListResponse {
  items: IFlowExecutionResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface IFlowTaskResultResponse {
  id: string;
  executionId: string;
  taskId: string;
  iteration: number;
  status: string;
  output?: unknown;
  displayText?: string;
  outputs?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  components?: Array<Record<string, unknown>>;
  error?: string;
  startedAt?: Date;
  endedAt?: Date;
  toolTrace?: FlowToolTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
  llmPromptTrace?: FlowLlmPromptTraceItem[];
  usage?: FlowUsageSummary | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  modelName?: string | null;
  semanticMatch?: FlowSemanticMatchSummary | null;
  traceMetadata?: Record<string, unknown>;
  judgeStatus?: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  judgeScoringMode?: AdvisorScoringMode | null;
  judgeResult?: FlowExecutionJudgeResult | null;
  judgeError?: string | null;
  judgeHistory?: FlowExecutionJudgeHistoryEntry[];
}

export interface IFlowExecutionDetailResponse extends IFlowExecutionResponse {
  taskResults: IFlowTaskResultResponse[];
  routerDecisions: IFlowRouterDecisionResponse[];
}

export interface IFlowRouterDecisionResponse {
  id: string;
  executionId: string;
  routerNodeId: string;
  iteration: number;
  label: string;
  decidedAt: Date;
}

export interface IResumeApprovalPayload {
  decision: string;
  payload?: Record<string, unknown>;
}
