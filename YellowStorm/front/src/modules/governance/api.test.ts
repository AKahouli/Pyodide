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
});
