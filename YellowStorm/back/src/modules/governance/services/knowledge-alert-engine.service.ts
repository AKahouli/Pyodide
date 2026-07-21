import { Injectable } from '@nestjs/common';
import type { KnowledgeAssessmentContext, KnowledgeAssessmentDimensions, KnowledgePriority } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import type { KnowledgeAlertCategory } from '@modules/knowledge-intelligence/schemas/knowledge-alert.schema';
import type { KnowledgeAlertInput } from '@modules/knowledge-intelligence/services/knowledge-alert-repository.service';

@Injectable()
export class KnowledgeAlertEngineService {
  build(context: KnowledgeAssessmentContext, dimensions: KnowledgeAssessmentDimensions): KnowledgeAlertInput[] {
    const mappings: Array<{ key: keyof KnowledgeAssessmentDimensions; category: KnowledgeAlertCategory }> = [
      { key: 'businessValidity', category: 'validity' },
      { key: 'freshness', category: 'freshness' },
      { key: 'availability', category: 'availability' },
      { key: 'integrity', category: 'integrity' },
      { key: 'searchQuality', category: 'search_quality' },
      { key: 'governanceQuality', category: 'governance' },
    ];
    return mappings.flatMap(({ key, category }) => {
      const result = dimensions[key];
      if (result.status === 'pass' || result.status === 'unknown') return [];
      const blockingFactor = result.factors.find((factor) => factor.contribution === 0 && !factor.code.endsWith('_unknown')) ?? result.factors[0];
      const severity: KnowledgePriority = result.status === 'fail' ? (result.score === 0 ? 'critical' : 'high') : 'medium';
      return [{ programId: '', scopeIds: context.source.scopeIds, sourceId: context.source.id, sourceVersionId: context.version.id, category, severity, title: `${key} requires attention`, description: blockingFactor?.message ?? `${key} health is below policy.`, deduplicationKey: `${context.version.id}:assessment-v1:${key}`, evidenceRefs: blockingFactor?.evidenceRefs ?? [] }];
    });
  }
}
