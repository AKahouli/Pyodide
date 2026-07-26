import { Injectable } from '@nestjs/common';
import type { ResponseReliabilitySettings } from '@modules/evaluation/services/evaluation-settings.service';
import type { ReliabilityEvaluation } from '../interfaces/message.interface';

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
    return hasText
      && evaluation.status === 'completed'
      && (evaluation.score ?? -1) >= threshold
      && (evaluation.score ?? -1) >= originalScore
      && !this.hasCriticalIssue(evaluation);
  }

  private hasCriticalIssue(evaluation: ReliabilityEvaluation): boolean {
    return (evaluation.claims || evaluation.findings || []).some((claim) => claim.importance === 'critical'
      && (claim.status === 'unsupported' || claim.status === 'contradicted'));
  }
}
