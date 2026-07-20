import { Injectable } from '@nestjs/common';
import type { KnowledgeAssessmentContext, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { dimension } from './knowledge-evaluator.utils';

@Injectable()
export class AvailabilityEvaluator implements KnowledgeEvaluator {
  readonly key = 'availability' as const;
  async evaluate(context: KnowledgeAssessmentContext) {
    const unavailable = context.version.extractedMetadata.artifactAvailable === false;
    if (unavailable) return dimension(0, [{ code: 'availability.artifact_unavailable', contribution: 0, message: 'The source artifact is unavailable.' }]);
    const status = context.version.technicalStatus;
    const scores: Record<string, number> = { ready: 100, processing: 60, pending: 45, failed: 0 };
    const score = scores[status] ?? 0;
    return dimension(score, [{ code: `availability.${status}`, contribution: score, message: `Technical status is ${status}.`, evidenceRefs: [`source-version:${context.version.id}:technicalStatus`] }]);
  }
}
