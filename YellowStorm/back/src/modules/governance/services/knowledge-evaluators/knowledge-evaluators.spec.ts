import type { KnowledgeAssessmentContext } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { BusinessValidityEvaluator } from './business-validity.evaluator';
import { FreshnessEvaluator } from './freshness.evaluator';
import { AvailabilityEvaluator } from './availability.evaluator';
import { IntegrityEvaluator } from './integrity.evaluator';
import { SearchQualityEvaluator } from './search-quality.evaluator';
import { GovernanceQualityEvaluator } from './governance-quality.evaluator';

const context = (documentPatch: Partial<KnowledgeAssessmentContext['document']> = {}, governancePatch: Partial<KnowledgeAssessmentContext['governance']> = {}): KnowledgeAssessmentContext => ({
  document: { id: 'document-1', workspaceId: 'workspace-1', originalName: 'parkour.pdf', mimeType: 'application/pdf', type: 'doc', status: 'completed', indexingStatus: 'ready', contentHash: 'hash', updatedAt: new Date('2026-01-01T00:00:00Z'), metadata: { language: 'fr' }, ...documentPatch },
  governance: { status: 'captured', validity: { mode: 'unknown', businessStatus: 'unknown' }, tags: [], metadata: {}, ...governancePatch },
  binding: { visibility: 'scope_specific', scopeIds: ['scope-1'], ingestionMode: 'assisted' },
  now: new Date('2026-07-14T00:00:00Z'),
});

describe('knowledge evaluators', () => {
  it('evaluates observable dimensions deterministically', async () => {
    const input = context();
    const results = await Promise.all([new BusinessValidityEvaluator().evaluate(input), new FreshnessEvaluator().evaluate(input), new AvailabilityEvaluator().evaluate(input), new IntegrityEvaluator().evaluate(input), new SearchQualityEvaluator().evaluate(input), new GovernanceQualityEvaluator().evaluate(input)]);
    expect(results.map((item) => item.score)).toEqual([45, 45, 100, 100, 62, 43]);
  });
  it('marks failed indexing and overdue documents as failing', async () => {
    const input = context({ indexingStatus: 'failed' }, { validity: { mode: 'fixed_date', businessStatus: 'needs_review', nextReviewAt: new Date('2026-07-01T00:00:00Z') } });
    expect((await new AvailabilityEvaluator().evaluate(input)).status).toBe('fail');
    expect((await new FreshnessEvaluator().evaluate(input)).status).toBe('fail');
  });
});
