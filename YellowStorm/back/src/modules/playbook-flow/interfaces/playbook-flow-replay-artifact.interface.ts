import type { FlowTaskPublicReasoningTraceItem } from '../schemas/playbook-flow-task-result.schema';
import type { FlowReplayToolCall } from '../schemas/playbook-flow-validated-replay.schema';

export interface ResolvedReplayArtifacts {
  taskId: string;
  replayId: string;
  validationVersion: number;
  referenceOutput: string | null;
  outputFormatGuide: string | null;
  toolCalls: FlowReplayToolCall[];
  reasoningChain: FlowTaskPublicReasoningTraceItem[];
  replayConfig: {
    replayOutputFormat: boolean;
    replayToolTrace: boolean;
    replayReasoningChain: boolean;
  };
}
