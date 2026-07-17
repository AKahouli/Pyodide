import type { KnowledgeAssessmentContext } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { BusinessValidityEvaluator } from './business-validity.evaluator';
import { FreshnessEvaluator } from './freshness.evaluator';
import { AvailabilityEvaluator } from './availability.evaluator';
import { IntegrityEvaluator } from './integrity.evaluator';
import { SearchQualityEvaluator } from './search-quality.evaluator';
import { GovernanceQualityEvaluator } from './governance-quality.evaluator';

const context = (patch: Partial<KnowledgeAssessmentContext['version']> = {}): KnowledgeAssessmentContext => ({
  source: { id: 'source-1', title: 'parkour.pdf', sourceType: 'pdf', status: 'draft', visibility: 'scope_specific', scopeIds: ['scope-1'], metadata: {} },
  version: { id: 'version-1', lifecycleStatus: 'captured', technicalStatus: 'ready', contentHash: 'hash', documentId: 'document-1', capturedAt: new Date('2026-01-01T00:00:00Z'), extractedMetadata: { language: 'fr' }, validity: { mode: 'unknown', businessStatus: 'unknown' }, ...patch },
  now: new Date('2026-07-14T00:00:00Z'),
});

describe('knowledge evaluators', () => {
  it('evaluates observable dimensions deterministically', async () => {
    const input = context();
    const results = await Promise.all([new BusinessValidityEvaluator().evaluate(input), new FreshnessEvaluator().evaluate(input), new AvailabilityEvaluator().evaluate(input), new IntegrityEvaluator().evaluate(input), new SearchQualityEvaluator().evaluate(input), new GovernanceQualityEvaluator().evaluate(input)]);
    expect(results.map((item) => item.score)).toEqual([45, 45, 100, 100, 62, 43]);
    expect(results.every((item) => item.score >= 0 && item.score <= 100)).toBe(true);
  });

  it('marks unavailable and overdue sources as failing', async () => {
    const input = context({ extractedMetadata: { artifactAvailable: false }, validity: { mode: 'fixed_date', businessStatus: 'needs_review', nextReviewAt: new Date('2026-07-01T00:00:00Z') } });
    expect((await new AvailabilityEvaluator().evaluate(input)).status).toBe('fail');
    expect((await new FreshnessEvaluator().evaluate(input)).status).toBe('fail');
  });

  it('reports unavailable search signals as unknown factors', async () => {
    const result = await new SearchQualityEvaluator().evaluate(context());
    expect(result.factors.filter((factor) => factor.code.endsWith('_unknown'))).toHaveLength(7);
  });
});
