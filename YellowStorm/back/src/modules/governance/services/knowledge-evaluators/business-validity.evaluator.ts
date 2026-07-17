import { Injectable } from '@nestjs/common';
import type { KnowledgeAssessmentContext, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { dimension } from './knowledge-evaluator.utils';

@Injectable()
export class BusinessValidityEvaluator implements KnowledgeEvaluator {
  readonly key = 'businessValidity' as const;
  async evaluate(context: KnowledgeAssessmentContext) {
    const status = context.version.validity.businessStatus;
    const scores: Record<string, number> = { valid: 100, scheduled: 80, unknown: 45, needs_review: 30, expired: 0, conflicting: 0, suspended: 0 };
    const score = scores[status] ?? 45;
    return dimension(score, [{ code: `validity.${status}`, contribution: score, message: `Business validity is ${status}.`, evidenceRefs: [`source-version:${context.version.id}:validity`] }]);
  }
}
