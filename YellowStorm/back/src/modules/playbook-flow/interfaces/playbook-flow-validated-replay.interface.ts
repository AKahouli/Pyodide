import type {
  FlowTaskJudgeResult,
  FlowTaskPublicReasoningTraceItem,
  FlowTaskSemanticMatch,
  FlowTaskToolTraceItem,
  FlowTaskUsage,
} from '../models/playbook-flow-task-result.model';
import type {
  ReplayAcceptedExample,
  ReplayContextVariable,
  ReplayDriftPolicy,
  ReplayReasoningStage,
  ReplaySemanticChecklistItem,
  ReplayToolTraceTemplateItem,
} from './playbook-flow-replay-template.interface';

/**
 * A validated replay baseline (playbook.validated_replays, roadmap P5): its document shape and the
 * enums and helpers the module shares. Ids are strings.
 */

export type ReplayMode = 'replay_strict' | 'replay_flex' | 'replay_adaptive';

export enum FlowReplayValidationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum FlowReplayValidationMode {
  STRICT = 'replay_strict',
  FLEX = 'replay_flex',
  ADAPTIVE = 'replay_adaptive',
  LEGACY_STRICT = 'strict_replay',
}

export function normalizeReplayMode(value: unknown): ReplayMode {
  if (value === FlowReplayValidationMode.FLEX) return FlowReplayValidationMode.FLEX;
  if (value === FlowReplayValidationMode.ADAPTIVE) return FlowReplayValidationMode.ADAPTIVE;
  return FlowReplayValidationMode.STRICT;
}

export function serializeReplayMode(value: unknown): FlowReplayValidationMode {
  if (value === FlowReplayValidationMode.FLEX) return FlowReplayValidationMode.FLEX;
  if (value === FlowReplayValidationMode.ADAPTIVE) return FlowReplayValidationMode.ADAPTIVE;
  return FlowReplayValidationMode.STRICT;
}

export enum FlowReplayFormatGuideStatus {
  DISABLED = 'disabled',
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
}

export enum FlowReplayOutputContractType {
  FREEFORM = 'freeform',
  MARKDOWN_SECTIONS = 'markdown_sections',
  JSON_SCHEMA = 'json_schema',
}

export interface FlowReplayToolCall {
  callIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  outputSummary?: string;
  status?: string | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface FlowReplayLLMPromptTraceItem {
  stage: string;
  model: string;
  prompt: string;
  generatedOutput?: string | null;
}

export interface FlowReplayConfig {
  replayOutputFormat: boolean;
  replayToolTrace: boolean;
  replayReasoningChain: boolean;
}

export interface FlowReplayFingerprints {
  inputContextHash?: string | null;
  flowSnapshotHash?: string | null;
  nodeSnapshotHash?: string | null;
  agentConfigHash?: string | null;
  modelConfigHash?: string | null;
  toolConfigHash?: string | null;
  outputContractHash?: string | null;
}

export interface FlowReplayBehaviorBaseline {
  decisionInvariants: string[];
  qualityChecks: string[];
  knownFailureModes: string[];
  behaviorSummary?: string;
}

export interface FlowReplayToolPolicy {
  requiredTools: string[];
  forbiddenTools: string[];
  sequencingRules: string[];
  requireSameOrder: boolean;
}

export interface FlowReplayOutputContract {
  type: FlowReplayOutputContractType;
  requiredSections: string[];
  forbiddenSections: string[];
  jsonSchema?: Record<string, unknown> | null;
  citationPolicy: 'required' | 'optional' | 'forbidden';
}

export interface FlowReplayHitlMemorySnapshot {
  interruptId: string;
  nodeId: string;
  iteration: number;
  type: 'clarification' | 'approval_request' | 'review_request';
  blockerKind?: string | null;
  reasonCode: string;
  prompt: string;
  responseAction: string;
  responseMessage?: string | null;
  responseScope: string;
  downstreamNodeIds: string[];
  reusableInReplay: boolean;
  contextFingerprint: string;
}

/** The replay document: the promoted columns and the template body kept in `doc`. */
export interface FlowValidatedReplay {
  flowId: string;
  taskId: string;
  iteration: number;
  taskTitle: string;
  referenceTaskDescription?: string;
  referenceAssignedAgentId?: string;
  referenceWorkspaceIds: string[];
  agentName?: string;
  createdBy: string;
  referenceExecutionId: string;
  referenceExecutionNumber: number;
  validationVersion: number;
  status: FlowReplayValidationStatus;
  /** As stored: legacy rows keep `strict_replay`; readers go through normalizeReplayMode. */
  mode: FlowReplayValidationMode;
  toolCalls: FlowReplayToolCall[];
  reasoningChain: FlowTaskPublicReasoningTraceItem[];
  referenceOutput?: string;
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string | null;
  formatGuideStatus: FlowReplayFormatGuideStatus;
  formatGuideError?: string;
  llmPromptTrace: FlowReplayLLMPromptTraceItem[];
  fingerprints?: FlowReplayFingerprints | null;
  behaviorBaseline?: FlowReplayBehaviorBaseline | null;
  toolPolicy?: FlowReplayToolPolicy | null;
  outputContract?: FlowReplayOutputContract | null;
  intentKey?: string | null;
  intentLabel?: string;
  reasoningOutline: ReplayReasoningStage[];
  stableReasoningRules: string[];
  contextVariableSchema: ReplayContextVariable[];
  toolTraceTemplate: ReplayToolTraceTemplateItem[];
  driftPolicy?: ReplayDriftPolicy | null;
  acceptedExamples: ReplayAcceptedExample[];
  semanticChecklist: ReplaySemanticChecklistItem[];
  hitlMemorySnapshots: FlowReplayHitlMemorySnapshot[];
  referenceUsage?: FlowTaskUsage | null;
  referenceSemanticMatch?: FlowTaskSemanticMatch | null;
  traceMetadata?: Record<string, unknown>;
  referenceFlowRevision?: number;
  referenceNodeSnapshot?: Record<string, unknown> | null;
  isStale: boolean;
  staleReasons: string[];
  label?: string | null;
  replayConfig: FlowReplayConfig;
}

export interface ReplayFingerprintInput {
  inputContext?: unknown;
  flowSnapshot?: unknown;
  nodeSnapshot?: Record<string, unknown> | null;
  agentConfig?: Record<string, unknown> | null;
  modelConfig?: Record<string, unknown> | null;
  toolConfig?: Record<string, unknown> | null;
  outputContract?: FlowReplayOutputContract | null;
}

export interface BuildValidatedReplayBaselineInput {
  taskId: string;
  iteration?: number;
  taskTitle?: string | null;
  taskDescription?: string | null;
  referenceExecutionId: string;
  referenceExecutionNumber: number;
  mode?: unknown;
  inputContext?: unknown;
  flowSnapshot?: unknown;
  nodeSnapshot?: Record<string, unknown> | null;
  taskResult: {
    output?: unknown;
    toolTrace?: FlowTaskToolTraceItem[];
    reasoningChain?: FlowTaskPublicReasoningTraceItem[];
    judgeResult?: FlowTaskJudgeResult | null;
  };
  hitlEvents?: Array<{
    interruptId?: string;
    nodeId?: string;
    iteration?: number;
    type?: string;
    blockerKind?: string | null;
    reasonCode?: string;
    prompt?: string;
    status?: string;
    response?: {
      action?: string;
      message?: string | null;
      feedback?: string | null;
      scope?: string;
      remember?: boolean;
    } | null;
    downstreamNodeIds?: string[];
  }>;
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string | null;
}

export interface ValidatedReplayBaselineFields {
  mode: ReplayMode;
  fingerprints: FlowReplayFingerprints;
  behaviorBaseline: FlowReplayBehaviorBaseline;
  toolPolicy: FlowReplayToolPolicy;
  outputContract: FlowReplayOutputContract | null;
  intentKey: string | null;
  intentLabel: string;
  reasoningOutline: ReplayReasoningStage[];
  stableReasoningRules: string[];
  contextVariableSchema: ReplayContextVariable[];
  toolTraceTemplate: ReplayToolTraceTemplateItem[];
  driftPolicy: ReplayDriftPolicy;
  acceptedExamples: ReplayAcceptedExample[];
  semanticChecklist: ReplaySemanticChecklistItem[];
  hitlMemorySnapshots: FlowReplayHitlMemorySnapshot[];
}
