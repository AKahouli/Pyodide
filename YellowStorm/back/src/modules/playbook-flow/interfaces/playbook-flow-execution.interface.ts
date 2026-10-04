import { HitlEventLog, PendingApproval } from '../models/playbook-flow-execution.model';
import type { ReplayPlanningSummary } from './playbook-flow-replay-plan.interface';
import {
  FlowLlmPromptTraceItem,
  FlowSemanticMatchSummary,
  FlowToolTraceItem,
  FlowUsageSummary,
} from './playbook-flow-observability.interface';
import { PublicReasoningTraceItem } from './playbook-flow-reasoning.interface';
import type { FlowExecutionJudgeHistoryEntry, FlowExecutionJudgeResult } from './playbook-flow-execution-advisor.interface';
import type { AdvisorScoringMode } from '../models/playbook-flow.model';
import type { ApprovalDecision } from '../dto/resume-playbook-flow-approval.dto';

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
  playbookExecutionSettings?: Record<string, unknown>;
  inputContext?: Record<string, unknown>;
  idempotencyKey?: string;
  pendingApproval: PendingApproval | null;
  hitlEvents?: HitlEventLog[];
  queuePosition?: number;
  threadId?: string;
  replaySource?: { executionId: string; taskId: string; iteration?: number };
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
  artifacts?: Record<string, unknown>[];
  components?: Record<string, unknown>[];
  iteratorIterations?: Record<string, unknown>[];
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
  hitlHistory?: HitlEventLog[];
  parentTaskId?: string;
  runtimeSubgraphId?: string;
  generatedLocalNodeId?: string;
  generatedNodeTitle?: string;
}

export interface IFlowExecutionDetailResponse extends IFlowExecutionResponse {
  taskResults: IFlowTaskResultResponse[];
  routerDecisions: IFlowRouterDecisionResponse[];
  dynamicReasoningAttempts: Record<string, unknown>[];
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
  decision: ApprovalDecision;
  payload?: Record<string, unknown>;
}

export interface IResumeFromStepPayload {
  taskId: string;
  action?: string;
  interruptId?: string;
  iteration?: number;
  streaming?: boolean;
  message?: string;
  approved?: boolean;
  reason?: string;
  feedback?: string;
  scope?: string;
  remember?: boolean;
  payload?: Record<string, unknown>;
}

export interface IRunFromStepPayload {
  taskId: string;
  iteration?: number;
}
