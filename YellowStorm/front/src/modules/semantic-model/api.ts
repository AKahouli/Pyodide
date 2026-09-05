import { apiClient } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { ApiResponse } from '@/lib/api/client';
import type { AgeGraphEdge, AgeGraphNode, KnowledgeBinding, MappingProposalJob, Paginated, SemanticBuildApplyMode, SemanticBuildJob, SemanticBuildStatus, SemanticEvidenceSearchResponse, SemanticGraph, SemanticGraphOperation, SemanticModel, SemanticModelMappingProposalResponse, SemanticModelMember, SemanticModelShareResult, SemanticModelShareRole, SemanticVersion, ValidationIssue } from './types';

const unwrap = <T>(response: { data: ApiResponse<T> }): T => response.data.data;

export const semanticModelApi = {
  async list(params: Record<string, string | number | undefined> = {}): Promise<Paginated<SemanticModel>> {
    return unwrap(await apiClient.get<ApiResponse<Paginated<SemanticModel>>>(API_ENDPOINTS.semanticModels.base, { params }));
  },
  async create(payload: { name: string; description?: string; workspaceIds?: string[] }): Promise<SemanticModel> {
    return unwrap(await apiClient.post<ApiResponse<SemanticModel>>(API_ENDPOINTS.semanticModels.base, payload));
  },
  async get(id: string): Promise<SemanticModel> {
    return unwrap(await apiClient.get<ApiResponse<SemanticModel>>(API_ENDPOINTS.semanticModels.byId(id)));
  },
  async update(id: string, payload: { expectedRevision: number; name?: string; description?: string }): Promise<SemanticModel> {
    return unwrap(await apiClient.patch<ApiResponse<SemanticModel>>(API_ENDPOINTS.semanticModels.byId(id), payload));
  },
  async archive(id: string): Promise<void> { const model = await semanticModelApi.get(id); await apiClient.delete(API_ENDPOINTS.semanticModels.byId(id), { data: { expectedRevision: model.revision } }); },
  async clone(id: string, name: string): Promise<SemanticModel> {
    return unwrap(await apiClient.post<ApiResponse<SemanticModel>>(API_ENDPOINTS.semanticModels.clone(id), { name }));
  },
  async graph(id: string, layer = 'combined'): Promise<SemanticGraph> {
    return unwrap(await apiClient.get<ApiResponse<SemanticGraph>>(API_ENDPOINTS.semanticModels.graph(id), { params: { layer } }));
  },
  async applyOperations(id: string, expectedRevision: number, operations: SemanticGraphOperation[]): Promise<{ revision: number; operations: SemanticGraphOperation[] }> {
    return unwrap(await apiClient.post<ApiResponse<{ revision: number; operations: SemanticGraphOperation[] }>>(API_ENDPOINTS.semanticModels.operations(id), { expectedRevision, operations }));
  },
  async validate(id: string): Promise<{ issues: ValidationIssue[] }> {
    return unwrap(await apiClient.post<ApiResponse<{ issues: ValidationIssue[] }>>(API_ENDPOINTS.semanticModels.validate(id)));
  },
  async generateOntology(id: string, businessRequirements: string[]): Promise<{ modelId: string; generatedAt: string }> {
    return unwrap(await apiClient.post<ApiResponse<{ modelId: string; generatedAt: string }>>(API_ENDPOINTS.semanticModels.generateOntology(id), { businessRequirements }, { timeout: 0 }));
  },
  async searchEvidence(id: string): Promise<SemanticEvidenceSearchResponse> {
    return unwrap(await apiClient.post<ApiResponse<SemanticEvidenceSearchResponse>>(API_ENDPOINTS.semanticModels.evidenceSearch(id), {}, { timeout: 0 }));
  },
  async startMappingProposalJob(id: string): Promise<{ jobId: string; status: 'running' }> {
    return unwrap(await apiClient.post<ApiResponse<{ jobId: string; status: 'running' }>>(
      API_ENDPOINTS.semanticModels.mappingProposals(id),
      {},
      { timeout: 0 },
    ));
  },
  async listMappingProposalJobs(id: string): Promise<MappingProposalJob[]> {
    return unwrap(await apiClient.get<ApiResponse<MappingProposalJob[]>>(
      API_ENDPOINTS.semanticModels.mappingProposalJobs(id),
    ));
  },
  async getMappingProposalJob(id: string, jobId: string): Promise<MappingProposalJob> {
    return unwrap(await apiClient.get<ApiResponse<MappingProposalJob>>(
      API_ENDPOINTS.semanticModels.mappingProposalJob(id, jobId),
    ));
  },
  async applyMappingPlan(
    id: string,
    jobId: string,
    mode: 'replace' | 'incremental' = 'incremental',
  ): Promise<{ appliedNodeCount: number; updatedNodeCount: number; deletedNodeCount: number; appliedEdgeCount: number; graphViewerWarning: string | null }> {
    return unwrap(await apiClient.post<ApiResponse<{ appliedNodeCount: number; updatedNodeCount: number; deletedNodeCount: number; appliedEdgeCount: number; graphViewerWarning: string | null }>>(
      `${API_ENDPOINTS.semanticModels.mappingPlanApply(id, jobId)}?mode=${mode}`,
      {},
      { timeout: 0 },
    ));
  },
  async getAgeGraph(id: string): Promise<{ nodes: AgeGraphNode[]; edges: AgeGraphEdge[] }> {
    return unwrap(await apiClient.get<ApiResponse<{ nodes: AgeGraphNode[]; edges: AgeGraphEdge[] }>>(
      API_ENDPOINTS.semanticModels.ageGraph(id),
    ));
  },
  async startBuild(
    id: string,
    businessRequirements: string[],
    applyMode: SemanticBuildApplyMode = 'replace',
  ): Promise<{ buildId: string; status: SemanticBuildStatus }> {
    return unwrap(await apiClient.post<ApiResponse<{ buildId: string; status: SemanticBuildStatus }>>(
      API_ENDPOINTS.semanticModels.builds(id),
      { businessRequirements, applyMode },
    ));
  },
  async getBuild(id: string, buildId: string): Promise<SemanticBuildJob> {
    return unwrap(await apiClient.get<ApiResponse<SemanticBuildJob>>(
      API_ENDPOINTS.semanticModels.build(id, buildId),
    ));
  },
  async getLatestBuild(id: string): Promise<SemanticBuildJob | null> {
    return unwrap(await apiClient.get<ApiResponse<SemanticBuildJob | null>>(
      API_ENDPOINTS.semanticModels.latestBuild(id),
    ));
  },
  async bindings(id: string): Promise<KnowledgeBinding[]> {
    return unwrap(await apiClient.get<ApiResponse<KnowledgeBinding[]>>(API_ENDPOINTS.semanticModels.bindings(id)));
  },
  async createBinding(id: string, payload: Omit<KnowledgeBinding, 'id' | 'enabled' | 'protected' | 'availability'>): Promise<KnowledgeBinding & { revision: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.post<ApiResponse<KnowledgeBinding & { revision: number }>>(API_ENDPOINTS.semanticModels.bindings(id), { ...payload, expectedRevision: model.revision }));
  },
  async deleteBinding(id: string, bindingId: string): Promise<void> { const model = await semanticModelApi.get(id); await apiClient.delete(API_ENDPOINTS.semanticModels.binding(id, bindingId), { data: { expectedRevision: model.revision } }); },
  async workspaces(id: string): Promise<Array<{ workspaceId: string; role: 'origin' | 'connected'; enabled: boolean }>> {
    return unwrap(await apiClient.get<ApiResponse<Array<{ workspaceId: string; role: 'origin' | 'connected'; enabled: boolean }>>>(API_ENDPOINTS.semanticModels.workspaces(id)));
  },
  async connectWorkspace(id: string, workspaceId: string, addToDocumentsFallback: boolean): Promise<void> {
    const model = await semanticModelApi.get(id);
    await apiClient.post(API_ENDPOINTS.semanticModels.workspaces(id), { workspaceId, addToDocumentsFallback, expectedRevision: model.revision });
  },
  async disconnectWorkspace(id: string, workspaceId: string): Promise<void> { const model = await semanticModelApi.get(id); await apiClient.delete(API_ENDPOINTS.semanticModels.workspace(id, workspaceId), { data: { expectedRevision: model.revision } }); },
  async versions(id: string): Promise<SemanticVersion[]> {
    return unwrap(await apiClient.get<ApiResponse<SemanticVersion[]>>(API_ENDPOINTS.semanticModels.versions(id)));
  },
  async publish(id: string): Promise<{ publishedVersionId: string; draftVersionId: string; revision: number }> {
    const model = await semanticModelApi.get(id);
    const graph = await semanticModelApi.graph(id);
    return unwrap(await apiClient.post<ApiResponse<{ publishedVersionId: string; draftVersionId: string; revision: number }>>(API_ENDPOINTS.semanticModels.publish(id), { expectedRevision: model.revision, expectedGraphRevision: graph.revision }));
  },
  async restore(id: string, versionId: string): Promise<{ draftVersionId: string; revision: number }> {
    const model = await semanticModelApi.get(id);
    const graph = await semanticModelApi.graph(id);
    return unwrap(await apiClient.post<ApiResponse<{ draftVersionId: string; revision: number }>>(API_ENDPOINTS.semanticModels.restore(id, versionId), { expectedRevision: model.revision, expectedGraphRevision: graph.revision }));
  },
  async workspaceDefault(workspaceId: string): Promise<SemanticModel | null> {
    return unwrap(await apiClient.get<ApiResponse<SemanticModel | null>>(API_ENDPOINTS.semanticModels.workspaceDefault(workspaceId)));
  },
  async workspaceModels(workspaceId: string): Promise<SemanticModel[]> {
    return unwrap(await apiClient.get<ApiResponse<SemanticModel[]>>(API_ENDPOINTS.semanticModels.workspaceModels(workspaceId)));
  },
  async ensureWorkspaceDefault(workspaceId: string): Promise<SemanticModel> {
    return unwrap(await apiClient.post<ApiResponse<SemanticModel>>(API_ENDPOINTS.semanticModels.ensureWorkspaceDefault(workspaceId)));
  },

  // ── Sharing ────────────────────────────────────────────────────────────────
  async listShares(id: string): Promise<SemanticModelMember[]> {
    return unwrap(await apiClient.get<ApiResponse<SemanticModelMember[]>>(API_ENDPOINTS.semanticModels.shares(id)));
  },
  async share(id: string, shares: Array<{ email: string; role: SemanticModelShareRole }>): Promise<SemanticModelShareResult> {
    return unwrap(await apiClient.post<ApiResponse<SemanticModelShareResult>>(API_ENDPOINTS.semanticModels.shares(id), { shares }));
  },
  async updateShareRole(id: string, targetUserId: string, role: SemanticModelShareRole): Promise<void> {
    await apiClient.patch(API_ENDPOINTS.semanticModels.share(id, targetUserId), { role });
  },
  async revokeShare(id: string, targetUserId: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.semanticModels.share(id, targetUserId));
  },
};
