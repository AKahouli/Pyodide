import { describe, expect, it, vi, beforeEach } from 'vitest';
import { governanceApi } from './api';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({ apiClient: mocks }));

describe('governanceApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses endpoint registry paths for memberships and deployments', async () => {
    mocks.get.mockResolvedValueOnce({ data: { data: [] } });
    mocks.post.mockResolvedValueOnce({ data: { data: { id: 'deployment-1' } } });

    await governanceApi.listMemberships('program-1');
    await governanceApi.createDeployment('program-1', { scopeId: 'scope-1', name: 'Main deployment' });

    expect(mocks.get).toHaveBeenCalledWith('/governance/programs/program-1/memberships');
    expect(mocks.post).toHaveBeenCalledWith('/governance/programs/program-1/deployments', { scopeId: 'scope-1', name: 'Main deployment' });
  });

  it('calls revision, dry-run, and publish lifecycle endpoints', async () => {
    mocks.post.mockResolvedValue({ data: { data: {} } });

    await governanceApi.createRevision('deployment-1', { agentId: 'agent-1' });
    await governanceApi.createDryRun('deployment-1', { input: 'test', simulatedChannel: 'api' });
    await governanceApi.publishDeployment('deployment-1');

    expect(mocks.post).toHaveBeenCalledWith('/governance/deployments/deployment-1/revisions', { agentId: 'agent-1' });
    expect(mocks.post).toHaveBeenCalledWith('/governance/deployments/deployment-1/dry-runs', { input: 'test', simulatedChannel: 'api' });
    expect(mocks.post).toHaveBeenCalledWith('/governance/deployments/deployment-1/publish', {});
  });

  it('calls the scope overview endpoint', async () => {
    mocks.get.mockResolvedValueOnce({ data: { data: { scope: { id: 'scope-1' } } } });

    await governanceApi.getScopeOverview('program-1', 'scope-1');

    expect(mocks.get).toHaveBeenCalledWith('/governance/programs/program-1/scopes/scope-1/overview');
  });

  it('searches users through the endpoint registry', async () => {
    mocks.get.mockResolvedValueOnce({ data: { data: [] } });

    await governanceApi.searchUsers('alice', 5);

    expect(mocks.get).toHaveBeenCalledWith('/users/search', { params: { q: 'alice', limit: 5 } });
  });

  it('starts, reads, and resumes durable reconciliation runs', async () => {
    mocks.post.mockResolvedValue({ data: { data: { id: 'run-1' } } });
    mocks.get.mockResolvedValue({ data: { data: { id: 'run-1' } } });

    await governanceApi.createReconciliationRun('program-1', 'binding-1', true);
    await governanceApi.getReconciliationRun('program-1', 'binding-1', 'run-1');
    await governanceApi.resumeReconciliationRun('program-1', 'binding-1', 'run-1');

    expect(mocks.post).toHaveBeenCalledWith('/governance/programs/program-1/workspace-bindings/binding-1/reconciliation-runs', { dryRun: true });
    expect(mocks.get).toHaveBeenCalledWith('/governance/programs/program-1/workspace-bindings/binding-1/reconciliation-runs/run-1');
    expect(mocks.post).toHaveBeenCalledWith('/governance/programs/program-1/workspace-bindings/binding-1/reconciliation-runs/run-1/resume', {});
  });

  it('runs and decides evidence-backed temporal candidates', async () => {
    mocks.get.mockResolvedValue({ data: { data: [] } }); mocks.post.mockResolvedValue({ data: { data: {} } });
    await governanceApi.listTemporalCandidates('program-1', 'source-1', 'version-1');
    await governanceApi.runTemporalAnalysis('program-1', 'source-1', 'version-1');
    await governanceApi.getTemporalAnalysisStatus('program-1', 'source-1', 'version-1');
    await governanceApi.decideTemporalCandidate('program-1', 'source-1', 'version-1', 'candidate-1', { action: 'confirm' });
    expect(mocks.get).toHaveBeenCalledWith('/governance/programs/program-1/sources/source-1/versions/version-1/temporal-candidates');
    expect(mocks.post).toHaveBeenCalledWith('/governance/programs/program-1/sources/source-1/versions/version-1/temporal-analysis', {});
    expect(mocks.get).toHaveBeenCalledWith('/governance/programs/program-1/sources/source-1/versions/version-1/temporal-analysis');
    expect(mocks.post).toHaveBeenCalledWith('/governance/programs/program-1/sources/source-1/versions/version-1/temporal-candidates/candidate-1/decision', { action: 'confirm' });
  });

  it('uses the knowledge intelligence endpoints for health and governed decisions', async () => {
    mocks.get.mockResolvedValue({ data: { data: [] } }); mocks.post.mockResolvedValue({ data: { data: {} } });
    await governanceApi.refreshKnowledge('program-1', 'scope-1');
    await governanceApi.getKnowledgeHealth('program-1', 'scope-1');
    await governanceApi.listKnowledgeAlerts('program-1', { scopeId: 'scope-1' });
    await governanceApi.acknowledgeKnowledgeAlert('program-1', 'alert-1');
    await governanceApi.decideKnowledgeRecommendation('program-1', 'recommendation-1', 'accept');
    await governanceApi.applyKnowledgeRecommendation('program-1', 'recommendation-1');
    await governanceApi.listMetadataCandidates('program-1', { scopeId: 'scope-1' });
    await governanceApi.decideMetadataCandidate('program-1', 'candidate-1', 'reject');
    expect(mocks.post).toHaveBeenCalledWith('/governance/programs/program-1/knowledge/refresh', {}, { params: { scopeId: 'scope-1' } });
    expect(mocks.get).toHaveBeenCalledWith('/governance/programs/program-1/knowledge/health-summary', { params: { scopeId: 'scope-1' } });
    expect(mocks.post).toHaveBeenCalledWith('/governance/programs/program-1/knowledge/recommendations/recommendation-1/accept', { reason: undefined });
    expect(mocks.post).toHaveBeenCalledWith('/governance/programs/program-1/knowledge/metadata-candidates/candidate-1/reject', {});
  });
});
