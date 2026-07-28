import { Injectable } from '@nestjs/common';
import type { ResponseReliabilitySettings } from '@modules/evaluation/services/evaluation-settings.service';
import type { CorrectionPolicyReason, ReliabilityEvaluation } from '../interfaces/message.interface';

@Injectable()
export class ResponseCorrectionPolicyService {
  shouldCorrect(settings: ResponseReliabilitySettings, evaluation: ReliabilityEvaluation): boolean {
    if (!settings.enabled || settings.mode !== 'corrective_transparent' || evaluation.status !== 'completed') return false;
    return (evaluation.score ?? 100) < settings.correction.threshold || this.hasCriticalIssue(evaluation);
  }

  isSuccessfulCorrection(
    evaluation: ReliabilityEvaluation,
    threshold: number,
    originalScore: number,
    hasText: boolean,
  ): boolean {
    return this.evaluateCorrection(evaluation, threshold, originalScore, hasText).accepted;
  }

  evaluateCorrection(
    evaluation: ReliabilityEvaluation,
    threshold: number,
    originalScore: number,
    hasText: boolean,
  ): { accepted: boolean; reasons: CorrectionPolicyReason[] } {
    const reasons: CorrectionPolicyReason[] = [];
    if (!hasText) reasons.push('answer_empty');
    if (evaluation.status === 'not_applicable') reasons.push('evaluation_not_applicable');
    else if (evaluation.status !== 'completed') reasons.push('evaluation_not_completed');
    if (evaluation.status === 'completed' && (evaluation.score ?? -1) < threshold) reasons.push('score_below_threshold');
    if (evaluation.status === 'completed' && (evaluation.score ?? -1) < originalScore) reasons.push('score_below_original');
    if (this.hasCriticalIssue(evaluation)) reasons.push('critical_claim_unresolved');
    return reasons.length
      ? { accepted: false, reasons }
      : { accepted: true, reasons: ['policy_requirements_met'] };
  }

  private hasCriticalIssue(evaluation: ReliabilityEvaluation): boolean {
    return (evaluation.claims || evaluation.findings || []).some((claim) => claim.importance === 'critical'
      && (claim.status === 'unsupported' || claim.status === 'contradicted'));
  }
}
