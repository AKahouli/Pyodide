import { Injectable } from '@nestjs/common';
import type { KnowledgeAssessmentContext, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { dimension } from './knowledge-evaluator.utils';

@Injectable()
export class AvailabilityEvaluator implements KnowledgeEvaluator {
  readonly key = 'availability' as const;
  async evaluate(context: KnowledgeAssessmentContext) {
    const status = context.document.indexingStatus;
    const scores: Record<string, number> = { ready: 100, processing: 60, pending: 45, none: 35, failed: 0 };
    const score = scores[status] ?? 0;
    return dimension(score, [{ code: `availability.${status}`, contribution: score, message: `Indexing status is ${status}.`, evidenceRefs: [`document:${context.document.id}:indexingStatus`] }]);
  }
}
