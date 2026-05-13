import { PendingApproval } from '../schemas/playbook-flow-execution.schema';
import { FlowTaskResult } from '../schemas/playbook-flow-task-result.schema';

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
  error?: string;
  startedAt?: Date;
  endedAt?: Date;
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
