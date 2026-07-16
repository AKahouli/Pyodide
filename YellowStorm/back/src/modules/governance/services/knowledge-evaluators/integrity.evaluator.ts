import { Injectable } from '@nestjs/common';
import type { AssessmentFactor, KnowledgeAssessmentContext, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { dimension } from './knowledge-evaluator.utils';

@Injectable()
export class IntegrityEvaluator implements KnowledgeEvaluator {
  readonly key = 'integrity' as const;
  async evaluate(context: KnowledgeAssessmentContext) {
    const factors: AssessmentFactor[] = [];
    let score = 0;
    if (context.version.contentHash) { score += 50; factors.push({ code: 'integrity.content_hash_present', contribution: 50, message: 'A content hash is recorded.' }); }
    else factors.push({ code: 'integrity.content_hash_missing', contribution: 0, message: 'No content hash is recorded.' });
    if (context.version.documentId || context.version.canonicalUrl) { score += 50; factors.push({ code: 'integrity.artifact_identity_present', contribution: 50, message: 'The artifact has a stable document or canonical URL identity.' }); }
    else factors.push({ code: 'integrity.artifact_identity_missing', contribution: 0, message: 'The artifact has no stable identity.' });
    return dimension(score, factors);
  }
}
