import { apiClient } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { GovernanceProgram, GovernanceReadiness } from './types';
import type {
  CreateGovernanceDeploymentPayload,
  CreateGovernanceDryRunPayload,
  CreateGovernanceMembershipPayload,
  CreateGovernanceProgramPayload,
  CreateGovernanceRevisionPayload,
  CreateGovernanceScopePayload,
  CreateGovernanceSourcePayload,
  GovernanceDeployment,
  GovernanceDeploymentRevision,
  GovernanceDryRun,
  GovernanceMembership,
  GovernanceMetric,
  GovernanceScope,
  GovernanceScopeOverview,
  GovernanceSource,
  GovernanceUserSearchResult,
  UpdateGovernanceDeploymentPayload,
  UpdateGovernanceProgramPayload,
  UpdateGovernanceScopePayload,
  UpdateGovernanceSourcePayload,
} from './types';

export const governanceApi = {
  async listPrograms(): Promise<GovernanceProgram[]> {
    const res = await apiClient.get(API_ENDPOINTS.governance.programs);
    return res.data.data;
  },

  async getProgram(programId: string): Promise<GovernanceProgram> {
    const res = await apiClient.get(API_ENDPOINTS.governance.program(programId));
    return res.data.data;
  },

  async createProgram(payload: CreateGovernanceProgramPayload): Promise<GovernanceProgram> {
    const res = await apiClient.post(API_ENDPOINTS.governance.programs, payload);
    return res.data.data;
  },

  async updateProgram(programId: string, payload: UpdateGovernanceProgramPayload): Promise<GovernanceProgram> {
    const res = await apiClient.patch(API_ENDPOINTS.governance.program(programId), payload);
    return res.data.data;
  },

  async deleteProgram(programId: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.governance.program(programId));
  },

  async listScopes(programId: string): Promise<GovernanceScope[]> {
    const res = await apiClient.get(API_ENDPOINTS.governance.scopes(programId));
    return res.data.data;
  },

  async createScope(programId: string, payload: CreateGovernanceScopePayload): Promise<GovernanceScope> {
    const res = await apiClient.post(API_ENDPOINTS.governance.scopes(programId), payload);
    return res.data.data;
  },

  async updateScope(programId: string, scopeId: string, payload: UpdateGovernanceScopePayload): Promise<GovernanceScope> {
    const res = await apiClient.patch(API_ENDPOINTS.governance.scope(programId, scopeId), payload);
    return res.data.data;
  },

  async getScopeOverview(programId: string, scopeId: string): Promise<GovernanceScopeOverview> {
    const res = await apiClient.get(API_ENDPOINTS.governance.scopeOverview(programId, scopeId));
    return res.data.data;
  },

  async deleteScope(programId: string, scopeId: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.governance.scope(programId, scopeId));
  },

  async listSources(programId: string): Promise<GovernanceSource[]> {
    const res = await apiClient.get(API_ENDPOINTS.governance.sources(programId));
    return res.data.data;
  },

  async createSource(programId: string, payload: CreateGovernanceSourcePayload): Promise<GovernanceSource> {
    const res = await apiClient.post(API_ENDPOINTS.governance.sources(programId), payload);
    return res.data.data;
  },

  async updateSource(programId: string, sourceId: string, payload: UpdateGovernanceSourcePayload): Promise<GovernanceSource> {
    const res = await apiClient.patch(API_ENDPOINTS.governance.source(programId, sourceId), payload);
    return res.data.data;
  },

  async deleteSource(programId: string, sourceId: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.governance.source(programId, sourceId));
  },

  async listMemberships(programId: string): Promise<GovernanceMembership[]> {
    const res = await apiClient.get(API_ENDPOINTS.governance.memberships(programId));
    return res.data.data;
  },

  async createMembership(programId: string, payload: CreateGovernanceMembershipPayload): Promise<GovernanceMembership> {
    const res = await apiClient.post(API_ENDPOINTS.governance.memberships(programId), payload);
    return res.data.data;
  },

  async deleteMembership(programId: string, membershipId: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.governance.membership(programId, membershipId));
  },

  async listDeployments(programId: string): Promise<GovernanceDeployment[]> {
    const res = await apiClient.get(API_ENDPOINTS.governance.deployments(programId));
    return res.data.data;
  },

  async createDeployment(programId: string, payload: CreateGovernanceDeploymentPayload): Promise<GovernanceDeployment> {
    const res = await apiClient.post(API_ENDPOINTS.governance.deployments(programId), payload);
    return res.data.data;
  },

  async updateDeployment(deploymentId: string, payload: UpdateGovernanceDeploymentPayload): Promise<GovernanceDeployment> {
    const res = await apiClient.patch(API_ENDPOINTS.governance.deployment(deploymentId), payload);
    return res.data.data;
  },

  async createRevision(deploymentId: string, payload: CreateGovernanceRevisionPayload): Promise<GovernanceDeploymentRevision> {
    const res = await apiClient.post(API_ENDPOINTS.governance.revisions(deploymentId), payload);
    return res.data.data;
  },

  async listRevisions(deploymentId: string): Promise<GovernanceDeploymentRevision[]> {
    const res = await apiClient.get(API_ENDPOINTS.governance.revisions(deploymentId));
    return res.data.data;
  },

  async createDryRun(deploymentId: string, payload: CreateGovernanceDryRunPayload): Promise<GovernanceDryRun> {
    const res = await apiClient.post(API_ENDPOINTS.governance.dryRuns(deploymentId), payload);
    return res.data.data;
  },

  async listDryRuns(deploymentId: string): Promise<GovernanceDryRun[]> {
    const res = await apiClient.get(API_ENDPOINTS.governance.dryRuns(deploymentId));
    return res.data.data;
  },

  async markDryRun(dryRunId: string, status: GovernanceDryRun['status']): Promise<GovernanceDryRun> {
    const res = await apiClient.patch(API_ENDPOINTS.governance.dryRunResult(dryRunId), { status });
    return res.data.data;
  },

  async publishDeployment(deploymentId: string): Promise<GovernanceDeployment> {
    const res = await apiClient.post(API_ENDPOINTS.governance.publish(deploymentId), {});
    return res.data.data;
  },

  async rollbackDeployment(deploymentId: string): Promise<GovernanceDeployment> {
    const res = await apiClient.post(API_ENDPOINTS.governance.rollback(deploymentId), {});
    return res.data.data;
  },

  async suspendDeployment(deploymentId: string): Promise<GovernanceDeployment> {
    const res = await apiClient.post(API_ENDPOINTS.governance.suspend(deploymentId), {});
    return res.data.data;
  },

  async listMetrics(programId: string): Promise<GovernanceMetric[]> {
    const res = await apiClient.get(API_ENDPOINTS.governance.metrics(programId));
    return res.data.data;
  },

  async getReadiness(deploymentId: string): Promise<GovernanceReadiness> {
    const res = await apiClient.get(API_ENDPOINTS.governance.readiness(deploymentId));
    return res.data.data;
  },

  async searchUsers(query: string, limit = 10): Promise<GovernanceUserSearchResult[]> {
    const res = await apiClient.get(API_ENDPOINTS.users.search, { params: { q: query, limit } });
    return res.data.data;
  },
};
