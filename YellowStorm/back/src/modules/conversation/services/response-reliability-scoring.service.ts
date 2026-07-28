import { Injectable } from '@nestjs/common';
import type {
  ReliabilityClaimCounts,
  ReliabilityFinding,
  ReliabilityLabel,
} from '../interfaces/message.interface';

export interface EvaluatedReliabilityClaim extends ReliabilityFinding {}

const importanceWeight = { critical: 3, major: 2, minor: 1 } as const;
const verdictValue = { supported: 1, partially_supported: 0.5, unsupported: 0, contradicted: 0 } as const;
const statusOrder = { contradicted: 0, unsupported: 1, partially_supported: 2, supported: 3 } as const;
const importanceOrder = { critical: 0, major: 1, minor: 2 } as const;

@Injectable()
export class ResponseReliabilityScoringService {
  scoreClaims(claims: EvaluatedReliabilityClaim[], maxFindings: number): {
    score: number;
    label: ReliabilityLabel;
    summary: string;
    claimCounts: ReliabilityClaimCounts;
    findings: ReliabilityFinding[];
  } {
    const denominator = claims.reduce((sum, claim) => sum + importanceWeight[claim.importance], 0);
    const numerator = claims.reduce(
      (sum, claim) => sum + importanceWeight[claim.importance] * verdictValue[claim.status],
      0,
    );
    // The score is derived locally so model wording cannot change product thresholds.
    let score = denominator ? Math.round((numerator / denominator) * 100) : 0;
    if (claims.some((claim) => claim.importance === 'critical' && claim.status === 'contradicted')) {
      score = Math.min(score, 39);
    }

    const claimCounts = this.countClaims(claims);
    return {
      score,
      label: this.labelForScore(score),
      summary: this.summaryFor(claimCounts, claims),
      claimCounts,
      findings: claims
        .map((claim, index) => ({ claim, index }))
        .filter(({ claim }) => claim.status !== 'supported')
        .sort((a, b) => statusOrder[a.claim.status] - statusOrder[b.claim.status]
          || importanceOrder[a.claim.importance] - importanceOrder[b.claim.importance]
          || a.index - b.index)
        .slice(0, maxFindings)
        .map(({ claim }) => claim),
    };
  }

  labelForScore(score: number): ReliabilityLabel {
    if (score >= 90) return 'strongly_supported';
    if (score >= 70) return 'mostly_supported';
    if (score >= 40) return 'needs_verification';
    return 'high_hallucination_risk';
  }

  private countClaims(claims: EvaluatedReliabilityClaim[]): ReliabilityClaimCounts {
    return {
      total: claims.length,
      supported: claims.filter((claim) => claim.status === 'supported').length,
      partiallySupported: claims.filter((claim) => claim.status === 'partially_supported').length,
      unsupported: claims.filter((claim) => claim.status === 'unsupported').length,
      contradicted: claims.filter((claim) => claim.status === 'contradicted').length,
    };
  }

  private summaryFor(counts: ReliabilityClaimCounts, claims: EvaluatedReliabilityClaim[]): string {
    if (claims.some((claim) => claim.importance === 'critical' && claim.status === 'contradicted')) {
      return 'A critical claim conflicts with the available evidence.';
    }
    const unsupported = counts.unsupported + counts.contradicted;
    if (!unsupported && !counts.partiallySupported) {
      return 'All identified factual claims are supported by the available evidence.';
    }
    if (unsupported === 1 && counts.supported > unsupported) {
      return 'Most factual claims are supported, but one claim could not be verified.';
    }
    if (!unsupported && counts.partiallySupported) {
      return 'Some factual claims are only partially supported by the available evidence.';
    }
    return `${unsupported} important ${unsupported === 1 ? 'claim is' : 'claims are'} not supported by the available evidence.`;
  }
}
