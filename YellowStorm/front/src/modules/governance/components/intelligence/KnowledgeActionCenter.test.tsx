import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeActionCenter } from './KnowledgeActionCenter';

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), acknowledge: vi.fn(), decideRecommendation: vi.fn(), applyRecommendation: vi.fn(), decideMetadata: vi.fn(), openSource: vi.fn() }));

vi.mock('../../query/hooks', () => ({
  useKnowledgeHealth: () => ({ data: { totalSources: 1, averageHealthScore: 56, byStatus: { healthy: 0, warning: 1, critical: 0 }, assessments: [{ id: 'assessment-1', programId: 'program-1', scopeIds: ['scope-1'], sourceId: 'source-1', sourceVersionId: 'version-1', assessedAt: '2026-07-14T00:00:00Z', assessmentVersion: 'v1', overallHealthScore: 56, status: 'warning', summary: 'Warning', dimensions: Object.fromEntries(['businessValidity', 'freshness', 'availability', 'integrity', 'searchQuality', 'governanceQuality'].map((key) => [key, { score: 56, status: 'warning', factors: [{ code: `${key}.factor`, contribution: 56, message: 'Observable factor' }] }])) }] }, isLoading: false, isError: false }),
  useKnowledgeAlerts: () => ({ data: [{ id: 'alert-1', programId: 'program-1', scopeIds: ['scope-1'], sourceId: 'source-1', sourceVersionId: 'version-1', category: 'validity', severity: 'high', status: 'open', title: 'Validity requires attention', description: 'Validity is unknown.', evidenceRefs: [], openedAt: '2026-07-14T00:00:00Z' }, { id: 'alert-2', programId: 'program-1', scopeIds: ['scope-1'], sourceId: 'source-1', sourceVersionId: 'version-2', category: 'validity', severity: 'high', status: 'open', title: 'Validity requires attention', description: 'A newer version also requires review.', evidenceRefs: [], openedAt: '2026-07-15T00:00:00Z' }], isLoading: false, isError: false }),
  useKnowledgeRecommendations: () => ({ data: [{ id: 'recommendation-1', programId: 'program-1', scopeIds: ['scope-1'], sourceId: 'source-1', type: 'confirm_validity', priority: 'high', reason: 'Validity is unknown.', impactSummary: 'Review required.', status: 'proposed' }, { id: 'recommendation-2', programId: 'program-1', scopeIds: ['scope-1'], sourceId: 'source-1', type: 'schedule_review', priority: 'medium', reason: 'No review scheduled.', impactSummary: 'Schedule a reminder.', status: 'accepted' }], isLoading: false, isError: false }),
  useMetadataCandidates: () => ({ data: [{ id: 'candidate-1', programId: 'program-1', scopeIds: ['scope-1'], sourceId: 'source-1', sourceVersionId: 'version-1', key: 'language', proposedValue: 'fr', candidateType: 'document', confidence: 0.95, riskLevel: 'low', evidenceRefs: [], status: 'proposed' }], isLoading: false, isError: false }),
  useRefreshKnowledge: () => ({ mutate: mocks.refresh, isPending: false, isError: false }),
  useAcknowledgeKnowledgeAlert: () => ({ mutate: mocks.acknowledge, isPending: false, isError: false }),
  useDecideKnowledgeRecommendation: () => ({ mutate: mocks.decideRecommendation, isPending: false, isError: false }),
  useApplyKnowledgeRecommendation: () => ({ mutate: mocks.applyRecommendation, isPending: false, isError: false }),
  useDecideMetadataCandidate: () => ({ mutate: mocks.decideMetadata, isPending: false, isError: false }),
}));

describe('KnowledgeActionCenter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders explainable health and executes governed decisions', () => {
    render(<KnowledgeActionCenter programId='program-1' scopeId='scope-1' sourceNames={{ 'source-1': 'parkour.pdf' }} onOpenSource={mocks.openSource} />);
    expect(screen.getByRole('heading', { name: 'knowledge.actionCenter.title' })).toBeInTheDocument();
    const sourceGroup = screen.getByRole('button', { name: /parkour\.pdf/ });
    expect(screen.queryByText('Validity requires attention')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'knowledge.recommendation.apply.schedule_review' })).not.toBeInTheDocument();
    fireEvent.click(sourceGroup);
    expect(screen.getAllByText('Validity requires attention')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'knowledge.recommendation.apply.schedule_review' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'knowledge.refresh' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'knowledge.alert.acknowledge' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'knowledge.recommendation.accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'knowledge.actionCenter.advanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'knowledge.metadata.accept' }));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.acknowledge).toHaveBeenCalledWith('alert-1');
    expect(mocks.decideRecommendation).toHaveBeenCalledWith({ id: 'recommendation-1', action: 'accept' });
    expect(mocks.decideMetadata).toHaveBeenCalledWith({ id: 'candidate-1', action: 'accept' });
  });
});
