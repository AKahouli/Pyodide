import { Injectable } from '@nestjs/common';
import type {
  ReplayEligibilityInput,
  ReplayEligibilityResult,
  ReplayPromptSection,
} from '../interfaces/playbook-flow-replay-eligibility.interface';

type FingerprintKey =
  | 'inputContextHash'
  | 'flowSnapshotHash'
  | 'nodeSnapshotHash'
  | 'agentConfigHash'
  | 'modelConfigHash'
  | 'toolConfigHash'
  | 'outputContractHash';

const FINGERPRINT_WEIGHTS: Record<FingerprintKey, number> = {
  nodeSnapshotHash: 30,
  modelConfigHash: 20,
  toolConfigHash: 20,
  outputContractHash: 15,
  inputContextHash: 10,
  flowSnapshotHash: 5,
  agentConfigHash: 0,
};

const SECTION_ORDER: ReplayPromptSection[] = [
  'decision_invariants',
  'reasoning_chain',
  'tool_policy',
  'tool_trace',
  'output_contract',
  'output_format',
  'quality_checks',
  'known_failure_modes',
];

@Injectable()
export class PlaybookFlowReplayEligibilityService {
  evaluateReplayEligibility(params: ReplayEligibilityInput): ReplayEligibilityResult {
    const invalidationReasons: string[] = [];
    const confidenceFactors: Record<string, number> = {};
    const availableSections = this.resolveSections(params);

    if (!params.artifacts) {
      return this.buildResult(false, 0, confidenceFactors, ['missing_replay_baseline'], [], SECTION_ORDER);
    }

    if (!params.artifacts.fingerprints) {
      return this.buildResult(
        params.mode === 'replay_adaptive',
        params.mode === 'replay_adaptive' ? 40 : 0,
        confidenceFactors,
        ['baseline_fingerprints_missing'],
        params.mode === 'replay_adaptive' ? availableSections : [],
        params.mode === 'replay_adaptive' ? [] : availableSections,
      );
    }

    let totalScore = 0;
    for (const key of Object.keys(FINGERPRINT_WEIGHTS) as FingerprintKey[]) {
      const weight = FINGERPRINT_WEIGHTS[key];
      if (weight === 0) continue;
      const factor = this.computeFactor(key, params, invalidationReasons);
      confidenceFactors[key] = factor;
      totalScore += factor;
    }

    if (params.isStale || (params.staleReasons?.length ?? 0) > 0) {
      invalidationReasons.push('replay_marked_stale');
      if ((params.staleReasons ?? []).some((reason) => /contract|tool|model|node|flow/i.test(reason))) {
        invalidationReasons.push('replay_stale_high_risk');
      }
    }

    const threshold = params.mode === 'replay_strict' ? 90 : params.mode === 'replay_flex' ? 70 : 40;
    const hardFailReasons = this.resolveHardFailReasons(params.mode, invalidationReasons);
    const applied = hardFailReasons.length === 0 && totalScore >= threshold;

    if (totalScore < threshold) {
      invalidationReasons.push('confidence_below_threshold');
    }

    return this.buildResult(
      applied,
      Math.round(totalScore),
      confidenceFactors,
      this.unique(invalidationReasons),
      applied ? availableSections : [],
      applied ? [] : availableSections,
    );
  }

  private computeFactor(key: FingerprintKey, params: ReplayEligibilityInput, invalidationReasons: string[]): number {
    const baseline = params.artifacts.fingerprints?.[key] ?? null;
    const current = params.currentFingerprints[key] ?? null;
    const weight = FINGERPRINT_WEIGHTS[key];
    const reasonBase = key.replace(/Hash$/, '').replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

    if (!baseline && !current) {
      return weight;
    }

    if (baseline && !current) {
      invalidationReasons.push(`current_${reasonBase}_missing`.replace(/^current__/, 'current_'));
      return 0;
    }

    if (!baseline && current) {
      invalidationReasons.push(`baseline_${reasonBase}_missing`.replace(/^baseline__/, 'baseline_'));
      return weight * 0.5;
    }

    if (baseline === current) {
      return weight;
    }

    invalidationReasons.push(`${reasonBase}_mismatch`.replace(/^_/, ''));
    return 0;
  }

  private resolveHardFailReasons(mode: ReplayEligibilityInput['mode'], reasons: string[]): string[] {
    if (mode === 'replay_strict') {
      const strictReasons = new Set([
        'node_snapshot_mismatch',
        'model_config_mismatch',
        'tool_config_mismatch',
        'output_contract_mismatch',
      ]);
      return reasons.filter((reason) => strictReasons.has(reason));
    }

    if (mode === 'replay_flex') {
      const flexReasons = new Set(['output_contract_mismatch', 'replay_stale_high_risk']);
      return reasons.filter((reason) => flexReasons.has(reason));
    }

    return reasons.filter((reason) => reason === 'missing_replay_baseline');
  }

  private resolveSections(params: ReplayEligibilityInput): ReplayPromptSection[] {
    const sections: ReplayPromptSection[] = [];
    if ((params.artifacts.behaviorBaseline?.decisionInvariants?.length ?? 0) > 0) sections.push('decision_invariants');
    else if (params.artifacts.replayConfig.replayReasoningChain && params.artifacts.reasoningChain.length > 0) sections.push('reasoning_chain');
    if (params.artifacts.toolPolicy) sections.push('tool_policy');
    else if (params.artifacts.replayConfig.replayToolTrace && params.artifacts.toolCalls.length > 0) sections.push('tool_trace');
    if (params.artifacts.outputContract) sections.push('output_contract');
    else if (params.artifacts.replayConfig.replayOutputFormat && params.artifacts.outputFormatGuide) sections.push('output_format');
    if ((params.artifacts.behaviorBaseline?.qualityChecks?.length ?? 0) > 0) sections.push('quality_checks');
    if ((params.artifacts.behaviorBaseline?.knownFailureModes?.length ?? 0) > 0) sections.push('known_failure_modes');
    return sections;
  }

  private buildResult(
    applied: boolean,
    confidenceScore: number,
    confidenceFactors: Record<string, number>,
    invalidationReasons: string[],
    appliedSections: ReplayPromptSection[],
    skippedSections: ReplayPromptSection[],
  ): ReplayEligibilityResult {
    return {
      applied,
      confidenceScore,
      confidenceFactors,
      invalidationReasons,
      appliedSections,
      skippedSections,
    };
  }

  private unique(values: string[]): string[] {
    return values.filter((value, index, items) => value && items.indexOf(value) === index);
  }
}
