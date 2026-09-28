import {
  FlowTaskPublicReasoningTraceItem,
  FlowTaskSemanticMatch,
  FlowTaskUsage,
} from './playbook-flow-task-result.model';
import type { ReplaySemanticChecklistItem } from '../interfaces/playbook-flow-replay-template.interface';
import {
  FlowReplayFormatGuideStatus,
  FlowReplayOutputContractType,
  FlowReplayValidationMode,
  FlowReplayValidationStatus,
  serializeReplayMode,
} from '../interfaces/playbook-flow-validated-replay.interface';

// Moved to interfaces/playbook-flow-validated-replay.interface.ts (P5); re-exported until this file goes.
export {
  FlowReplayFormatGuideStatus,
  FlowReplayOutputContractType,
  FlowReplayValidationMode,
  FlowReplayValidationStatus,
  normalizeReplayMode,
  serializeReplayMode,
} from '../interfaces/playbook-flow-validated-replay.interface';
export type {
  BuildValidatedReplayBaselineInput,
  ReplayFingerprintInput,
  ReplayMode,
  ValidatedReplayBaselineFields,
} from '../interfaces/playbook-flow-validated-replay.interface';

export class FlowReplayToolCall {
  callIndex!: number;

  toolName!: string;

  args!: Record<string, unknown>;

  outputSummary?: string;

  status?: string | null;

  durationMs?: number | null;

  error?: string | null;
}

export class FlowReplayLLMPromptTraceItem {
  stage!: string;

  model!: string;

  prompt!: string;

  generatedOutput?: string | null;
}

export class FlowReplayStaleness {
  isStale!: boolean;

  reasons!: string[];
}

export class FlowReplaySemanticChecklistItem {
  key!: string;

  description!: string;

  variables!: string[];

  severity!: ReplaySemanticChecklistItem['severity'];

  source!: ReplaySemanticChecklistItem['source'];
}

export class FlowReplayConfig {
  replayOutputFormat!: boolean;

  replayToolTrace!: boolean;

  replayReasoningChain!: boolean;
}

export class FlowReplayFingerprints {
  inputContextHash?: string | null;

  flowSnapshotHash?: string | null;

  nodeSnapshotHash?: string | null;

  agentConfigHash?: string | null;

  modelConfigHash?: string | null;

  toolConfigHash?: string | null;

  outputContractHash?: string | null;
}

export class FlowReplayBehaviorBaseline {
  decisionInvariants!: string[];

  qualityChecks!: string[];

  knownFailureModes!: string[];

  behaviorSummary?: string;
}

export class FlowReplayToolPolicy {
  requiredTools!: string[];

  forbiddenTools!: string[];

  sequencingRules!: string[];

  requireSameOrder!: boolean;
}

export class FlowReplayOutputContract {
  type!: FlowReplayOutputContractType;

  requiredSections!: string[];

  forbiddenSections!: string[];

  jsonSchema?: Record<string, unknown> | null;

  citationPolicy!: 'required' | 'optional' | 'forbidden';
}

export class FlowReplayReasoningStage {
  stageKey!: string;

  stageType!: string;

  label!: string;

  description!: string;

  confidence?: number | null;
}

export class FlowReplayContextVariable {
  key!: string;

  label!: string;

  source!: 'task' | 'input_context' | 'tool_args' | 'unknown';

  valueType!: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

  required!: boolean;

  exampleValue?: string | null;
}

export class FlowReplayToolTraceTemplateItem {
  stepIndex!: number;

  toolName!: string;

  purpose!: string;

  argumentShape!: Record<string, unknown>;

  required!: boolean;
}

export class FlowReplayDriftPolicy {
  requireSameIntent!: boolean;

  requireSameReasoningStages!: boolean;

  requireSameToolOrder!: boolean;

  allowAdditionalTools!: boolean;

  allowArgumentValueChanges!: boolean;

  enforceOutputContract!: boolean;
}

export class FlowReplayAcceptedExample {
  referenceExecutionId!: string;

  referenceExecutionNumber!: number;

  summary!: string;

  outputPreview?: string | null;
}

export class FlowReplayHitlMemorySnapshot {
  interruptId!: string;

  nodeId!: string;

  iteration!: number;

  type!: 'clarification' | 'approval_request' | 'review_request';

  blockerKind?: string | null;

  reasonCode!: string;

  prompt!: string;

  responseAction!: string;

  responseMessage?: string | null;

  responseScope!: string;

  downstreamNodeIds!: string[];

  reusableInReplay!: boolean;

  contextFingerprint!: string;
}

export class FlowValidatedReplay {
  flowId!: string;

  taskId!: string;

  iteration!: number;

  taskTitle!: string;

  referenceTaskDescription?: string;

  referenceAssignedAgentId?: string;

  referenceWorkspaceIds!: string[];

  agentName?: string;

  createdBy!: string;

  referenceExecutionId!: string;

  referenceExecutionNumber!: number;

  validationVersion!: number;

  status!: FlowReplayValidationStatus;

  mode!: FlowReplayValidationMode;

  toolCalls!: FlowReplayToolCall[];

  reasoningChain!: FlowTaskPublicReasoningTraceItem[];

  referenceOutput?: string;

  preserveOutputFormat?: boolean;

  outputFormatGuide?: string;

  formatGuideStatus!: FlowReplayFormatGuideStatus;

  formatGuideError?: string;

  llmPromptTrace!: FlowReplayLLMPromptTraceItem[];

  fingerprints?: FlowReplayFingerprints | null;

  behaviorBaseline?: FlowReplayBehaviorBaseline | null;

  toolPolicy?: FlowReplayToolPolicy | null;

  outputContract?: FlowReplayOutputContract | null;

  intentKey?: string | null;

  intentLabel?: string;

  reasoningOutline!: FlowReplayReasoningStage[];

  stableReasoningRules!: string[];

  contextVariableSchema!: FlowReplayContextVariable[];

  toolTraceTemplate!: FlowReplayToolTraceTemplateItem[];

  driftPolicy?: FlowReplayDriftPolicy | null;

  acceptedExamples!: FlowReplayAcceptedExample[];

  semanticChecklist!: ReplaySemanticChecklistItem[];

  hitlMemorySnapshots!: FlowReplayHitlMemorySnapshot[];

  referenceUsage?: FlowTaskUsage | null;

  referenceSemanticMatch?: FlowTaskSemanticMatch | null;

  traceMetadata?: Record<string, unknown>;

  referenceFlowRevision?: number;

  referenceNodeSnapshot?: Record<string, unknown> | null;

  isStale!: boolean;

  staleReasons!: string[];

  label?: string;

  replayConfig!: FlowReplayConfig;
}

