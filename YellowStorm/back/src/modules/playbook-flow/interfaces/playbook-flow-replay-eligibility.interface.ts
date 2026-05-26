import type { ResolvedReplayArtifacts } from './playbook-flow-replay-artifact.interface';
import type {
  FlowReplayFingerprints,
  ReplayMode,
} from '../schemas/playbook-flow-validated-replay.schema';

export type ReplayPromptSection =
  | 'decision_invariants'
  | 'reasoning_chain'
  | 'tool_policy'
  | 'tool_trace'
  | 'output_contract'
  | 'output_format'
  | 'quality_checks'
  | 'known_failure_modes';

export interface ReplayEligibilityInput {
  mode: ReplayMode;
  artifacts: ResolvedReplayArtifacts;
  currentFingerprints: FlowReplayFingerprints;
  staleReasons?: string[];
  isStale?: boolean;
  eligibilityThreshold?: number;
}

export interface ReplayEligibilityResult {
  applied: boolean;
  confidenceScore: number;
  confidenceFactors: Record<string, number>;
  invalidationReasons: string[];
  appliedSections: ReplayPromptSection[];
  skippedSections: ReplayPromptSection[];
}
