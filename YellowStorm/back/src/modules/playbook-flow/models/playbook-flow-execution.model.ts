import { ADVISOR_SCORING_MODES, AdvisorScoringMode } from './playbook-flow.model';
import { HITL_FEEDBACK_SCOPES, HITL_RISK_LEVELS, HitlFeedbackScope, HitlRiskLevel } from './playbook-flow-hitl.model';

export class ReplayPlanningMetadata {
  replayId!: string;

  validationVersion!: number;

  intentKey?: string | null;

  intentLabel?: string | null;

  contextMapping!: Record<string, unknown>[];

  executionPlan?: Record<string, unknown> | null;
}

export class SeededTaskOutput {
  nodeId!: string;

  iteration!: number;

  payload!: Record<string, unknown>;
}

export class PendingApproval {
  nodeId!: string;

  iteration!: number;

  prompt!: string;

  requestedAt?: Date;

  interruptType?: string;

  interruptId?: string;

  taskTitle?: string;

  taskDescription?: string;

  result?: string;

  payloadJson?: string;

  resumableActions?: string[];

  blockerRuleId?: string;

  blockerKind?: string;

  reasonCode?: string;

  riskLevel?: HitlRiskLevel;

  confidence?: number;

  downstreamNodeIds?: string[];

  feedbackScopeDefault?: HitlFeedbackScope;

  interruptPayload?: Record<string, unknown>;
}

export class HitlResponse {
  /** Normalized human answer used by resume, audit, memory, and replay flows. */
  action!: string;

  message?: string | null;

  approved?: boolean | null;

  reason?: string | null;

  feedback?: string | null;

  scope?: HitlFeedbackScope;

  remember?: boolean;
}

export class HitlEventLog {
  /** Immutable per-execution audit event for each HITL pause and response. */
  id!: string;

  nodeId!: string;

  iteration!: number;

  interruptId!: string;

  type!: string;

  blockerRuleId?: string | null;

  blockerKind?: string | null;

  reasonCode!: string;

  riskLevel!: HitlRiskLevel;

  prompt!: string;

  payload!: Record<string, unknown>;

  status!: string;

  response?: HitlResponse | null;

  downstreamNodeIds!: string[];

  createdAt!: Date;

  respondedAt?: Date | null;
}

export class ReplaySource {
  executionId!: string;

  taskId!: string;

  iteration?: number;
}

export class FlowExecution {
  flowId!: string;

  ownerId!: string;

  schemaVersion!: number;

  status!: string;

  startedAt?: Date;

  endedAt?: Date;

  error?: string;

  recursionLimit!: number;

  maxParallelism!: number;

  playbookExecutionSettings?: Record<string, unknown>;

  playbookPlannerSnapshot?: Record<string, unknown>;

  inputContext?: Record<string, unknown>;

  snapshot?: Record<string, unknown>;

  idempotencyKey?: string;

  pendingApproval?: PendingApproval | null;

  hitlEvents?: HitlEventLog[];

  queuePosition?: number;

  threadId?: string;

  singleStepTaskId?: string;

  advisorAutopilotEnabled?: boolean;

  advisorAutopilotTargetScore?: number;

  advisorAutopilotMaxTurns?: number;

  reflectionEnabled?: boolean;

  advisorScoringMode?: AdvisorScoringMode;

  seededTaskOutputs?: SeededTaskOutput[];

  executionMode?: string;

  stepExecutionModes?: Record<string, string>;

  replayPlanningByTask?: Record<string, ReplayPlanningMetadata>;

  modelIdOverride?: string;

  replaySource?: ReplaySource;

  createdAt?: Date;

  updatedAt?: Date;
}

