import { Injectable } from '@nestjs/common';
import type { ReliabilityClaimImportance, ReliabilityEvaluation } from '../interfaces/message.interface';

export interface CorrectionInstruction {
  claim: string;
  action: 'remove' | 'qualify' | 'replace' | 'repair_citation';
  importance: ReliabilityClaimImportance;
  reason: string;
  allowedEvidenceIds: string[];
}

@Injectable()
export class ResponseCorrectionPlannerService {
  build(evaluation: ReliabilityEvaluation): CorrectionInstruction[] {
    return (evaluation.claims || evaluation.findings || []).flatMap((claim) => {
      if (claim.status === 'supported') return [];
      const action = claim.status === 'contradicted'
        ? 'replace'
        : claim.status === 'unsupported' ? 'qualify' : 'qualify';
      return [{
        claim: claim.claim,
        action,
        importance: claim.importance,
        reason: claim.explanation,
        allowedEvidenceIds: claim.evidenceIds || [],
      } satisfies CorrectionInstruction];
    });
  }
}
