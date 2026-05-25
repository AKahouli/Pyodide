import type { FlowTaskPublicReasoningTraceItem } from '../schemas/playbook-flow-task-result.schema';
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
  FlowReplayOutputContract,
  FlowReplayToolCall,
  FlowReplayToolPolicy,
  ReplayMode,
} from '../schemas/playbook-flow-validated-replay.schema';

export interface ResolvedReplayArtifacts {
  taskId: string;
  replayId: string;
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
