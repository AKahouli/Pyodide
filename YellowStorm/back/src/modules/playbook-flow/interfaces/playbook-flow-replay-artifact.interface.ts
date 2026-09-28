import type { FlowTaskPublicReasoningTraceItem } from '../models/playbook-flow-task-result.model';
import type {
  ReplayContextVariable,
  ReplayDriftPolicy,
  ReplayReasoningStage,
  ReplaySemanticChecklistItem,
  ReplayToolTraceTemplateItem,
} from './playbook-flow-replay-template.interface';
import type {
  FlowReplayBehaviorBaseline,
  FlowReplayFingerprints,
  FlowReplayHitlMemorySnapshot,
  FlowReplayOutputContract,
  FlowReplayToolCall,
  FlowReplayToolPolicy,
  ReplayMode,
} from './playbook-flow-validated-replay.interface';

export interface ResolvedReplayArtifacts {
  taskId: string;
  replayId: string;
  referenceExecutionId: string;
  validationVersion: number;
  mode: ReplayMode;
  flowId?: string;
  isStale: boolean;
  staleReasons: string[];
  referenceOutput: string | null;
  outputFormatGuide: string | null;
  intentKey: string | null;
  intentLabel: string | null;
  reasoningOutline: ReplayReasoningStage[];
  stableReasoningRules: string[];
  contextVariableSchema: ReplayContextVariable[];
  toolTraceTemplate: ReplayToolTraceTemplateItem[];
  semanticChecklist: ReplaySemanticChecklistItem[];
  hitlMemorySnapshots?: FlowReplayHitlMemorySnapshot[];
  driftPolicy: ReplayDriftPolicy | null;
  toolCalls: FlowReplayToolCall[];
  reasoningChain: FlowTaskPublicReasoningTraceItem[];
  fingerprints: FlowReplayFingerprints | null;
  behaviorBaseline: FlowReplayBehaviorBaseline | null;
  toolPolicy: FlowReplayToolPolicy | null;
  outputContract: FlowReplayOutputContract | null;
  replayConfig: {
    replayOutputFormat: boolean;
    replayToolTrace: boolean;
    replayReasoningChain: boolean;
  };
}
