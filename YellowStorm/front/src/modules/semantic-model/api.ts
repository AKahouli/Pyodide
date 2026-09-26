import { apiClient } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { ApiResponse } from '@/lib/api/client';
import type { AgeGraphEdge, AgeGraphNode, AgeGraphOperation, ConceptSourceMapping, KnowledgeBinding, MappingHealthResponse, MappingProposalJob, Paginated, PopulationJob, PopulationRefreshResponse, RelationMatchStrategy, RelationResolutionPreview, RelationResolutionRule, SemanticBuildApplyMode, SemanticBuildJob, SemanticBuildStatus, SemanticCorpusManifest, SemanticDataPreview, SemanticEvidenceSearchResponse, SemanticGraph, SemanticGraphOperation, SemanticModel, SemanticModelMappingProposalResponse, SemanticModelManualInstances, SemanticModelMember,
SemanticModelShareResult, SemanticModelShareRole, SemanticReadiness, SemanticReviewItem, SemanticVersion,
SheetProfile, SourceMappingDraft, SourceMappingPreviewDraft, SourceMappingPreviewResponse, SourceResolutionPolicy,
StructuredSourceAsset, ValidationIssue } from './types';
import type { SemanticDataTokenResponse } from './data-plane/semantic-api.types';

const unwrap = <T>(response: { data: ApiResponse<T> }): T => response.data.data;

interface DatasourceJob {
  state: string;
  result: Record<string, unknown> | null;
  errorCode: string | null;
}

const waitForDatasourceJob = async (modelId: string, jobId: string): Promise<DatasourceJob> => {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const job = unwrap(await apiClient.get<ApiResponse<DatasourceJob>>(
      API_ENDPOINTS.semanticModels.sourceAssetJob(modelId, jobId),
    ));
    if (job.state === 'completed' || job.state === 'completed_with_gaps') return job;
    if (['failed', 'cancelled', 'superseded'].includes(job.state)) {
      throw new Error(job.errorCode || 'Source analysis failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Source analysis timed out');
};


/** Publishing always publishes the structure; `data` says whether its records are now what chat reads. */
export interface PublishResult { publishedVersionId: string; draftVersionId: string; revision: number; data?: { published: boolean; reason?: string } }
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
  async getAgeGraph(id: string, dataRevisionId?: string): Promise<{ dataRevisionId?: string; nodes: AgeGraphNode[]; edges: AgeGraphEdge[] }> {
    return unwrap(await apiClient.get<ApiResponse<{ dataRevisionId?: string; nodes: AgeGraphNode[]; edges: AgeGraphEdge[] }>>(
      API_ENDPOINTS.semanticModels.ageGraph(id), { params: { dataRevisionId } },
    ));
  },
  async rebuildAgeGraph(id: string): Promise<{ vertexCount: number; edgeCount: number; failedVertexCount: number; failedEdgeCount: number; graphViewerWarning: string | null }> {
    return unwrap(await apiClient.post<ApiResponse<{ vertexCount: number; edgeCount: number; failedVertexCount: number; failedEdgeCount: number; graphViewerWarning: string | null }>>(
      API_ENDPOINTS.semanticModels.ageGraphRebuild(id),
      {},
    ));
  },
  async indexAgeGraph(id: string): Promise<{ queued: true }> {
    return unwrap(await apiClient.post<ApiResponse<{ queued: true }>>(
      API_ENDPOINTS.semanticModels.ageGraphIndex(id),
      {},
    ));
  },
  async applyAgeGraphOperations(id: string, operations: AgeGraphOperation[]): Promise<{ appliedNodeCount: number; appliedEdgeCount: number; deletedNodeCount: number; deletedEdgeCount: number; graphViewerWarning: string | null }> {
    return unwrap(await apiClient.post<ApiResponse<{ appliedNodeCount: number; appliedEdgeCount: number; deletedNodeCount: number; deletedEdgeCount: number; graphViewerWarning: string | null }>>(
      API_ENDPOINTS.semanticModels.ageGraphOperations(id),
      { operations },
    ));
  },
  async corpus(id: string): Promise<SemanticCorpusManifest> {
    return unwrap(await apiClient.get<ApiResponse<SemanticCorpusManifest>>(API_ENDPOINTS.semanticModels.corpus(id)));
  },
  async startBuild(
    id: string,
    businessRequirements: string[],
    applyMode: SemanticBuildApplyMode = 'replace',
    manualInstances: SemanticModelManualInstances[] = [],
  ): Promise<{ buildId: string; status: SemanticBuildStatus }> {
    return unwrap(await apiClient.post<ApiResponse<{ buildId: string; status: SemanticBuildStatus }>>(
      API_ENDPOINTS.semanticModels.builds(id),
      { businessRequirements, applyMode, manualInstances },
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
  async publish(id: string): Promise<PublishResult> {
    const model = await semanticModelApi.get(id);
    const graph = await semanticModelApi.graph(id);
    return unwrap(await apiClient.post<ApiResponse<PublishResult>>(API_ENDPOINTS.semanticModels.publish(id), { expectedRevision: model.revision, expectedGraphRevision: graph.revision }));
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

  // ── Structured source mappings ────────────────────────────────────────────
  async listSourceAssets(id: string): Promise<{ assets: StructuredSourceAsset[] }> {
    return unwrap(await apiClient.get<ApiResponse<{ assets: StructuredSourceAsset[] }>>(API_ENDPOINTS.semanticModels.sourceAssets(id)));
  },
  async profileSourceAsset(id: string, documentId: string, workspaceId: string, sheetName?: string): Promise<SheetProfile> {
    return unwrap(await apiClient.get<ApiResponse<SheetProfile>>(API_ENDPOINTS.semanticModels.sourceAssetProfile(id, documentId), { params: { workspaceId, sheetName } }));
  },
  async analyzeSourceAsset(id: string, documentId: string, workspaceId: string, sheetName?: string): Promise<SheetProfile> {
    const accepted = unwrap(await apiClient.post<ApiResponse<{ jobId: string }>>(API_ENDPOINTS.semanticModels.sourceAssetProfile(id, documentId), {}, { params: { workspaceId, sheetName } }));
    await waitForDatasourceJob(id, accepted.jobId);
    return semanticModelApi.profileSourceAsset(id, documentId, workspaceId, sheetName);
  },
  async listSourceMappings(id: string): Promise<ConceptSourceMapping[]> {
    return unwrap(await apiClient.get<ApiResponse<ConceptSourceMapping[]>>(API_ENDPOINTS.semanticModels.sourceMappings(id)));
  },
  async createSourceMapping(id: string, draft: SourceMappingDraft): Promise<{ revision: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.post<ApiResponse<{ revision: number }>>(API_ENDPOINTS.semanticModels.sourceMappings(id), { ...draft, expectedRevision: model.revision }));
  },
  async deleteSourceMapping(id: string, mappingId: string): Promise<{ revision: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.delete<ApiResponse<{ revision: number }>>(API_ENDPOINTS.semanticModels.sourceMapping(id, mappingId), { data: { expectedRevision: model.revision } }));
  },
  async createBulkDocumentSourceMappings(id: string, payload: { conceptId: string; documents: Array<{ workspaceId: string; documentId: string }>; fieldMappings: SourceMappingDraft['fieldMappings']; identityFields: string[] }): Promise<{ revision: number; mappingCount: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.post<ApiResponse<{ revision: number; mappingCount: number }>>(API_ENDPOINTS.semanticModels.bulkDocumentSourceMappings(id), { ...payload, expectedRevision: model.revision }));
  },
  async previewSourceMapping(id: string, draft: SourceMappingPreviewDraft): Promise<SourceMappingPreviewResponse> {
    const result = unwrap(await apiClient.post<ApiResponse<SourceMappingPreviewResponse | { jobId: string }>>(API_ENDPOINTS.semanticModels.sourceMappingPreview(id), draft));
    if (!('jobId' in result)) return result;
    const job = await waitForDatasourceJob(id, result.jobId);
    const preview = job.result?.mappingPreview;
    if (!preview || typeof preview !== 'object') throw new Error('Source preview did not produce a result');
    return preview as unknown as SourceMappingPreviewResponse;
  },
  async listRelationResolutionRules(id: string): Promise<RelationResolutionRule[]> {
    return unwrap(await apiClient.get<ApiResponse<RelationResolutionRule[]>>(API_ENDPOINTS.semanticModels.relationResolutionRules(id)));
  },
  async saveRelationResolutionRule(id: string, rule: { relationId: string; sourceAttribute: string; targetAttribute: string; strategy: RelationMatchStrategy; ambiguityPolicy: 'review' | 'unresolved' }): Promise<{ id: string; revision: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.post<ApiResponse<{ id: string; revision: number }>>(API_ENDPOINTS.semanticModels.relationResolutionRules(id), { ...rule, expectedRevision: model.revision }));
  },
  async previewRelationResolutionRule(id: string, ruleId: string, limit = 25): Promise<RelationResolutionPreview> {
    return unwrap(await apiClient.post<ApiResponse<RelationResolutionPreview>>(API_ENDPOINTS.semanticModels.relationResolutionPreview(id, ruleId), { limit }, { timeout: 0 }));
  },
  async listSourceResolutionPolicies(id: string): Promise<SourceResolutionPolicy[]> {
    return unwrap(await apiClient.get<ApiResponse<SourceResolutionPolicy[]>>(API_ENDPOINTS.semanticModels.sourceResolutionPolicies(id)));
  },
  async saveSourceResolutionPolicy(id: string, conceptId: string, priorities: Array<{ mappingId: string; rank: number }>): Promise<{ revision: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.put<ApiResponse<{ revision: number }>>(API_ENDPOINTS.semanticModels.sourceResolutionPolicy(id, conceptId), {
      expectedRevision: model.revision,
      priorities,
      defaultStrategy: 'primary_then_fallback',
    }));
  },
  async dataPreview(id: string, options: { conceptId?: string; limit?: number; dataRevisionId?: string } = {}): Promise<SemanticDataPreview> {
    return unwrap(await apiClient.post<ApiResponse<SemanticDataPreview>>(API_ENDPOINTS.semanticModels.dataPreview(id), options, { timeout: 0 }));
  },
  async mappingHealth(id: string): Promise<MappingHealthResponse> {
    return unwrap(await apiClient.post<ApiResponse<MappingHealthResponse>>(API_ENDPOINTS.semanticModels.mappingHealth(id), {}));
  },
  async requestPopulationRefresh(id: string, body: { purpose: 'build' | 'refresh'; scope: { kind: 'model' } | { kind: 'mapping'; mappingId: string } }): Promise<PopulationRefreshResponse> {
    return unwrap(await apiClient.post<ApiResponse<PopulationRefreshResponse>>(API_ENDPOINTS.semanticModels.populationRefresh(id), body, { timeout: 0 }));
  },
  async getPopulationJob(id: string, jobId: string): Promise<PopulationJob> {
    return unwrap(await apiClient.get<ApiResponse<PopulationJob>>(API_ENDPOINTS.semanticModels.populationJob(id, jobId)));
  },
  async readiness(id: string): Promise<SemanticReadiness> {
    return unwrap(await apiClient.get<ApiResponse<SemanticReadiness>>(API_ENDPOINTS.semanticModels.readiness(id)));
  },
  async reviewItems(id: string, status: 'open' | 'resolved' = 'open'): Promise<SemanticReviewItem[]> {
    return unwrap(await apiClient.get<ApiResponse<SemanticReviewItem[]>>(API_ENDPOINTS.semanticModels.reviewItems(id), { params: { status } }));
  },
  async resolveReviewItem(id: string, reviewItemId: string, resolution: { decision: 'accepted' | 'dismissed' | 'leave_unresolved'; selectedTargetId?: string; selectedMappingId?: string }): Promise<{ revision: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.post<ApiResponse<{ revision: number }>>(API_ENDPOINTS.semanticModels.resolveReviewItem(id, reviewItemId), { ...resolution, expectedRevision: model.revision }));
  },
  async dataToken(id: string): Promise<SemanticDataTokenResponse> {
    return unwrap(await apiClient.get<ApiResponse<SemanticDataTokenResponse>>(API_ENDPOINTS.semanticModels.dataToken(id)));
  },
};
