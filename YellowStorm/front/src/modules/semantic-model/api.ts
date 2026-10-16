import { apiClient } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { ApiResponse } from '@/lib/api/client';
import type { ArchiveReadLimits, DataConnection, DataConnectionDraft, SearchIndexStatus, ComputedFieldRule, DocumentLabelsResponse, ComputedPreviewResult, SheetFieldPreviewRequest, SheetFieldPreviewResponse,AiExtractionDefaults, RunLimits, RunLimitsDefaults, DerivedSource, DerivedSourceDraft, DerivedFieldPreviewRequest, DerivedFieldPreviewResponse, LastDocumentMapping, MappingPreset, MappingSettings, AiExtractionSettings, AgeGraphEdge, GraphOutline, GraphRecordValues, CitedRecordView, GraphExportChoice, GraphExportContent, AssistantChangesPage, SourceSuggestionsPage, SourceFileMatches, AgeGraphNode, ConceptSourceMapping, KnowledgeBinding, MappingHealthResponse, Paginated, PopulationJob, PopulationRebuildResponse, PopulationRefreshResponse, PopulationReprojectResponse, GraphStatus, RelationMatchStrategy, RelationResolutionPreview, RelationResolutionRule, SemanticDataPreview, SemanticGraph, SemanticGraphOperation, SemanticModel, SemanticModelMember,
SemanticModelShareResult, SemanticModelShareRole, SemanticReadiness, PopulationFreshness, ModelCheck, DesignerBoxPosition, SemanticReviewItem, SemanticVersion,
SheetProfile, SourceMappingDraft, SourceMappingPreviewDraft, SourceMappingPreviewResponse, SourceResolutionPolicy,
StructuredSourceAsset, ValidationIssue, RecordCorrection, RecordCorrectionInput, RecordCorrectionResult, VersionComparison, ReviewQueue, ConceptRecordsPage, SemanticModelCloneInclude, SemanticModelCloneResult, ModelHealth } from './types';
import type { SemanticDataTokenResponse } from './data-plane/semantic-api.types';
import type { MyJobsPage, MyJobsQuery } from './types';
import type { DocumentFieldSuggestions } from './types';

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
  async archive(id: string): Promise<void> { const model = await semanticModelApi.get(id); await apiClient.post(`${API_ENDPOINTS.semanticModels.byId(id)}/archive`, { expectedRevision: model.revision }); },
  /** Delete the model and all its data for good (owner only); workspace documents stay. */
  async deletePermanently(id: string): Promise<void> { await apiClient.delete(API_ENDPOINTS.semanticModels.byId(id)); },
  /** Copy a model; the structure always comes along, the rest as ticked (data needs the sources). */
  async clone(id: string, name: string, include?: SemanticModelCloneInclude): Promise<SemanticModelCloneResult> {
    return unwrap(await apiClient.post<ApiResponse<SemanticModelCloneResult>>(API_ENDPOINTS.semanticModels.clone(id), include ? { name, include } : { name }));
  },
  /** Counts shown next to the clone options; records is null when the data cannot be counted right now. */
  async clonePreview(id: string): Promise<{ sources: number; records: number | null; people: number }> {
    return unwrap(await apiClient.get<ApiResponse<{ sources: number; records: number | null; people: number }>>(`${API_ENDPOINTS.semanticModels.clone(id)}-preview`));
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
  async getAgeGraph(id: string, dataRevisionId?: string): Promise<{ dataRevisionId?: string; nodes: AgeGraphNode[]; edges: AgeGraphEdge[] }> {
    return unwrap(await apiClient.get<ApiResponse<{ dataRevisionId?: string; nodes: AgeGraphNode[]; edges: AgeGraphEdge[] }>>(
      API_ENDPOINTS.semanticModels.ageGraph(id), { params: { dataRevisionId } },
    ));
  },
  /** A bounded part of the data graph: the first records shared among the concepts, the records of one concept, or one record with its neighbours. */
  async getGraphOutline(id: string, dataRevisionId?: string, query?: { limit?: number; conceptId?: string; focus?: string; depth?: number }): Promise<GraphOutline> {
    return unwrap(await apiClient.get<ApiResponse<GraphOutline>>(API_ENDPOINTS.semanticModels.graphOutline(id), { params: { dataRevisionId, ...query } }));
  },
  async getGraphRecord(id: string, recordId: string, dataRevisionId?: string): Promise<GraphRecordValues> {
    return unwrap(await apiClient.get<ApiResponse<GraphRecordValues>>(API_ENDPOINTS.semanticModels.graphRecord(id, recordId), { params: { dataRevisionId } }));
  },
  /** A record a chat answer cited, read again: values, where each came from, and the documents one may open. */
  async getCitedRecord(id: string, entityId: string, params: { data?: 'published' | 'draft'; dataRevisionId?: string }): Promise<CitedRecordView> {
    return unwrap(await apiClient.get<ApiResponse<CitedRecordView>>(API_ENDPOINTS.semanticModels.citedRecord(id, entityId), { params }));
  },
  async searchGraph(id: string, q: string, dataRevisionId?: string, limit = 8): Promise<{ hits: Array<{ id: string; field: string; value: string }> }> {
    return unwrap(await apiClient.get<ApiResponse<{ hits: Array<{ id: string; field: string; value: string }> }>>(API_ENDPOINTS.semanticModels.graphSearch(id), { params: { q, dataRevisionId, limit } }));
  },
  async exportGraph(id: string, body: { dataRevisionId?: string; fields: Record<string, Record<string, GraphExportChoice>>; shortenTo: number }): Promise<GraphExportContent> {
    return unwrap(await apiClient.post<ApiResponse<GraphExportContent>>(API_ENDPOINTS.semanticModels.graphExport(id), body));
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
    // The model can change between reading its revision and linking: read it again and retry once.
    for (let attempt = 0; ; attempt += 1) {
      const model = await semanticModelApi.get(id);
      try {
        await apiClient.post(API_ENDPOINTS.semanticModels.workspaces(id), { workspaceId, addToDocumentsFallback, expectedRevision: model.revision });
        return;
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
        if (code !== 'ERR_3703' || attempt > 0) throw error;
      }
    }
  },
  async disconnectWorkspace(id: string, workspaceId: string): Promise<void> { const model = await semanticModelApi.get(id); await apiClient.delete(API_ENDPOINTS.semanticModels.workspace(id, workspaceId), { data: { expectedRevision: model.revision } }); },
  async versions(id: string): Promise<SemanticVersion[]> {
    return unwrap(await apiClient.get<ApiResponse<SemanticVersion[]>>(API_ENDPOINTS.semanticModels.versions(id)));
  },
  async compareVersions(id: string, left: string, right: string): Promise<VersionComparison> {
    return unwrap(await apiClient.get<ApiResponse<VersionComparison>>(API_ENDPOINTS.semanticModels.compareVersions(id), { params: { left, right } }));
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
  // ── Data sources (connections) ────────────────────────────────────────────
  async listDataConnections(id: string): Promise<DataConnection[]> {
    return unwrap(await apiClient.get<ApiResponse<DataConnection[]>>(API_ENDPOINTS.semanticModels.dataConnections(id)));
  },
  async createDataConnection(id: string, draft: DataConnectionDraft): Promise<DataConnection> {
    return unwrap(await apiClient.post<ApiResponse<DataConnection>>(API_ENDPOINTS.semanticModels.dataConnections(id), draft));
  },
  async updateDataConnection(id: string, connectionId: string, change: { indexInWorkspace?: boolean; limits?: ArchiveReadLimits }): Promise<DataConnection> {
    return unwrap(await apiClient.patch<ApiResponse<DataConnection>>(API_ENDPOINTS.semanticModels.dataConnection(id, connectionId), change));
  },
  async deleteDataConnection(id: string, connectionId: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.semanticModels.dataConnection(id, connectionId));
  },
  async listMappingPresets(id: string, conceptId: string): Promise<MappingPreset[]> {
    return unwrap(await apiClient.get<ApiResponse<MappingPreset[]>>(API_ENDPOINTS.semanticModels.mappingPresets(id), { params: { conceptId } }));
  },
  /** Saves the settings under a name; `presetId` replaces an existing preset. Presets do not change the model revision. */
  async saveMappingPreset(id: string, draft: MappingSettings & { conceptId: string; name: string; description?: string }, presetId?: string): Promise<MappingPreset> {
    return unwrap(presetId
      ? await apiClient.put<ApiResponse<MappingPreset>>(API_ENDPOINTS.semanticModels.mappingPreset(id, presetId), draft)
      : await apiClient.post<ApiResponse<MappingPreset>>(API_ENDPOINTS.semanticModels.mappingPresets(id), draft));
  },
  async deleteMappingPreset(id: string, presetId: string): Promise<{ deleted: boolean }> {
    return unwrap(await apiClient.delete<ApiResponse<{ deleted: boolean }>>(API_ENDPOINTS.semanticModels.mappingPreset(id, presetId)));
  },
  /** The settings of the concept's document mapping saved most recently, or null. */
  async lastUsedMapping(id: string, conceptId: string): Promise<LastDocumentMapping | null> {
    return unwrap(await apiClient.get<ApiResponse<{ lastUsed: LastDocumentMapping | null }>>(API_ENDPOINTS.semanticModels.lastUsedMapping(id), { params: { conceptId } })).lastUsed;
  },
  async listDerivedSources(id: string): Promise<DerivedSource[]> {
    return unwrap(await apiClient.get<ApiResponse<DerivedSource[]>>(API_ENDPOINTS.semanticModels.derivedSources(id)));
  },
  /** Fill a concept from another concept's records; updates the one given, or adds a new one. */
  async saveDerivedSource(id: string, draft: DerivedSourceDraft, derivedSourceId?: string): Promise<{ revision: number; derivedSource: DerivedSource }> {
    const model = await semanticModelApi.get(id);
    const body = { ...draft, expectedRevision: model.revision };
    return unwrap(derivedSourceId
      ? await apiClient.put<ApiResponse<{ revision: number; derivedSource: DerivedSource }>>(API_ENDPOINTS.semanticModels.derivedSource(id, derivedSourceId), body)
      : await apiClient.post<ApiResponse<{ revision: number; derivedSource: DerivedSource }>>(API_ENDPOINTS.semanticModels.derivedSources(id), body));
  },
  /** Read a derived source's fields on a few source records as a run would; nothing is saved. */
  async previewDerivedFields(id: string, payload: DerivedFieldPreviewRequest): Promise<DerivedFieldPreviewResponse> {
    return unwrap(await apiClient.post<ApiResponse<DerivedFieldPreviewResponse>>(API_ENDPOINTS.semanticModels.derivedSourcePreview(id), payload, { timeout: 130_000 }));
  },
  async deleteDerivedSource(id: string, derivedSourceId: string): Promise<{ revision: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.delete<ApiResponse<{ revision: number }>>(API_ENDPOINTS.semanticModels.derivedSource(id, derivedSourceId), { data: { expectedRevision: model.revision } }));
  },
  async createBulkDocumentSourceMappings(id: string, payload: { conceptId: string; documents: Array<{ workspaceId: string; documentId: string }>; fieldMappings: SourceMappingDraft['fieldMappings']; identityFields: string[]; aiSettings?: SourceMappingDraft['aiSettings'] }): Promise<{ revision: number; mappingCount: number }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.post<ApiResponse<{ revision: number; mappingCount: number }>>(API_ENDPOINTS.semanticModels.bulkDocumentSourceMappings(id), { ...payload, expectedRevision: model.revision }));
  },
  /** One mapping for every readable file of a workspace, or of one of its folders. */
  /** One mapping for many files of a workspace: all of them, or the picked folders and files. `mappingId` changes an existing one. */
  async createWorkspaceSourceMapping(id: string, payload: { conceptId: string; workspaceId: string; folderIds?: string[]; documentIds?: string[]; mappingId?: string; fieldMappings: SourceMappingDraft['fieldMappings']; identityFields: string[]; aiSettings?: SourceMappingDraft['aiSettings'] }): Promise<{ revision: number; fileCount: number; waitingCount: number }> {
    const model = await semanticModelApi.get(id);
    const { folderIds, documentIds, mappingId, ...rest } = payload;
    return unwrap(await apiClient.post<ApiResponse<{ revision: number; fileCount: number; waitingCount: number }>>(API_ENDPOINTS.semanticModels.workspaceSourceMapping(id), {
      ...rest,
      ...(folderIds?.length ? { folderIds } : {}),
      ...(documentIds?.length ? { documentIds } : {}),
      ...(mappingId ? { mappingId } : {}),
      expectedRevision: model.revision,
    }));
  },
  /** Changes assistants made to the model since a moment, with the draft's graph revision. */
  async assistantChanges(id: string, since?: string): Promise<AssistantChangesPage> {
    return unwrap(await apiClient.get<ApiResponse<AssistantChangesPage>>(API_ENDPOINTS.semanticModels.assistantChanges(id), { params: since ? { since } : {} }));
  },
  async undoAssistantChange(id: string, changeId: string): Promise<{ undone: boolean }> {
    return unwrap(await apiClient.post<ApiResponse<{ undone: boolean }>>(API_ENDPOINTS.semanticModels.assistantChange(id, changeId, 'undo'), {}, { timeout: 0 }));
  },
  async redoAssistantChange(id: string, changeId: string): Promise<{ redone: boolean }> {
    return unwrap(await apiClient.post<ApiResponse<{ redone: boolean }>>(API_ENDPOINTS.semanticModels.assistantChange(id, changeId, 'redo'), {}, { timeout: 0 }));
  },
  /** A page of one concept's records in the data in use, optionally searched. */
  /** `filters` narrows per field (field key to text; `__label__` is the record name). */
  /** How far the search index of the model's data is built (the draft data unless asked otherwise). */
  async searchIndexStatus(id: string, environment: 'draft' | 'production' = 'draft'): Promise<SearchIndexStatus> {
    return unwrap(await apiClient.get<ApiResponse<SearchIndexStatus>>(API_ENDPOINTS.semanticModels.searchIndex(id), { params: { environment } }));
  },
  /** Build (or build again, after a stop) the search index of the model's data, in the background. */
  async ensureSearchIndex(id: string, environment: 'draft' | 'production' = 'draft'): Promise<SearchIndexStatus> {
    return unwrap(await apiClient.post<ApiResponse<SearchIndexStatus>>(API_ENDPOINTS.semanticModels.searchIndex(id), { environment }));
  },
  /** Stop the build of the search index. A running build ends at its next batch; what it embedded is kept. */
  async stopSearchIndex(id: string, environment: 'draft' | 'production' = 'draft'): Promise<SearchIndexStatus & { stopped: boolean }> {
    return unwrap(await apiClient.post<ApiResponse<SearchIndexStatus & { stopped: boolean }>>(API_ENDPOINTS.semanticModels.searchIndexStop(id), { environment }));
  },
  /** Stop a stalled build (it ends at once) and start a new one: what was embedded is reused. `restarted` is false while a live worker is still stopping. */
  async restartSearchIndex(id: string, environment: 'draft' | 'production' = 'draft'): Promise<SearchIndexStatus & { restarted: boolean }> {
    return unwrap(await apiClient.post<ApiResponse<SearchIndexStatus & { restarted: boolean }>>(API_ENDPOINTS.semanticModels.searchIndexRestart(id), { environment }));
  },
  async conceptRecords(id: string, conceptId: string, query: { q?: string; limit?: number; offset?: number; filters?: Record<string, string> } = {}): Promise<ConceptRecordsPage> {
    return unwrap(await apiClient.get<ApiResponse<ConceptRecordsPage>>(API_ENDPOINTS.semanticModels.conceptRecords(id, conceptId), {
      params: {
        ...(query.q ? { q: query.q } : {}), limit: query.limit ?? 50, offset: query.offset ?? 0,
        ...(query.filters && Object.keys(query.filters).length ? { filters: JSON.stringify(query.filters) } : {}),
      },
    }));
  },
  /** The AI reading limits a document mapping starts from, as an admin set them. */
  async getExtractionDefaults(): Promise<AiExtractionDefaults> {
    return unwrap(await apiClient.get<ApiResponse<AiExtractionDefaults>>(API_ENDPOINTS.semanticModelSettings.extraction));
  },
  async getAdminExtractionSettings(): Promise<AiExtractionDefaults> {
    return unwrap(await apiClient.get<ApiResponse<AiExtractionDefaults>>(API_ENDPOINTS.adminSemanticModelSettings.base));
  },
  async updateAdminExtractionSettings(settings: Partial<AiExtractionSettings>): Promise<AiExtractionDefaults> {
    return unwrap(await apiClient.put<ApiResponse<AiExtractionDefaults>>(API_ENDPOINTS.adminSemanticModelSettings.base, settings));
  },
  async getAdminRunLimits(): Promise<RunLimitsDefaults> {
    return unwrap(await apiClient.get<ApiResponse<RunLimitsDefaults>>(API_ENDPOINTS.adminSemanticModelSettings.runLimits));
  },
  async updateAdminRunLimits(limits: Partial<RunLimits>): Promise<RunLimitsDefaults> {
    return unwrap(await apiClient.put<ApiResponse<RunLimitsDefaults>>(API_ENDPOINTS.adminSemanticModelSettings.runLimits, limits));
  },
  async previewComputedField(id: string, payload: {
    computed: ComputedFieldRule; samples?: string[]; inputRecipe?: ComputedFieldRule;
    /** A joined input: per sample, each part's value by "<kind>:<name>", and recipes shaping a part first. */
    partSamples?: Array<Record<string, string>>; partRecipes?: Record<string, ComputedFieldRule>;
  }): Promise<{ results: ComputedPreviewResult[] }> {
    return unwrap(await apiClient.post<ApiResponse<{ results: ComputedPreviewResult[] }>>(API_ENDPOINTS.semanticModels.computedFieldPreview(id), payload));
  },
  /** Read a few picked sheet rows as a run would (columns, cells read by rules or AI, recipes). AI can take a while. */
  async previewSheetFields(id: string, payload: SheetFieldPreviewRequest): Promise<SheetFieldPreviewResponse> {
    return unwrap(await apiClient.post<ApiResponse<SheetFieldPreviewResponse>>(API_ENDPOINTS.semanticModels.sheetFieldPreview(id), payload, { timeout: 130_000 }));
  },
  /** Labels and headings that recur across up to 10 documents of a source, to suggest as rule labels. */
  async getDocumentLabels(id: string, body: { workspaceId: string; documentIds: string[] }): Promise<DocumentLabelsResponse> {
    return unwrap(await apiClient.post<ApiResponse<DocumentLabelsResponse>>(API_ENDPOINTS.semanticModels.sourceMappingDocumentLabels(id), body, { timeout: 60_000 }));
  },
  async suggestDocumentFields(id: string, body: { conceptId: string; workspaceId: string; documentIds: string[]; description: string }): Promise<DocumentFieldSuggestions> {
    return unwrap(await apiClient.post<ApiResponse<DocumentFieldSuggestions>>(API_ENDPOINTS.semanticModels.documentFieldSuggestions(id), body, { timeout: 130_000 }));
  },
  async previewSourceMapping(id: string, draft: SourceMappingPreviewDraft): Promise<SourceMappingPreviewResponse> {
    // A document read with AI can take a couple of minutes.
    const result = unwrap(await apiClient.post<ApiResponse<SourceMappingPreviewResponse | { jobId: string }>>(API_ENDPOINTS.semanticModels.sourceMappingPreview(id), draft, { timeout: 130_000 }));
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
  async listLabelFields(id: string): Promise<Array<{ conceptId: string; field: string }>> {
    return unwrap(await apiClient.get<ApiResponse<Array<{ conceptId: string; field: string }>>>(API_ENDPOINTS.semanticModels.labelFields(id)));
  },
  async saveLabelField(id: string, conceptId: string, field: string): Promise<{ revision: number; conceptId: string; field: string }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.put<ApiResponse<{ revision: number; conceptId: string; field: string }>>(API_ENDPOINTS.semanticModels.labelField(id, conceptId), {
      expectedRevision: model.revision,
      field,
    }));
  },
  async listIdentityRules(id: string): Promise<Array<{ conceptId: string; fields: string[] }>> {
    return unwrap(await apiClient.get<ApiResponse<Array<{ conceptId: string; fields: string[] }>>>(API_ENDPOINTS.semanticModels.identityRules(id)));
  },
  async saveIdentityRule(id: string, conceptId: string, fields: string[]): Promise<{ revision: number; conceptId: string; fields: string[] }> {
    const model = await semanticModelApi.get(id);
    return unwrap(await apiClient.put<ApiResponse<{ revision: number; conceptId: string; fields: string[] }>>(API_ENDPOINTS.semanticModels.identityRule(id, conceptId), {
      expectedRevision: model.revision,
      fields,
    }));
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
  async listCorrections(id: string): Promise<{ corrections: RecordCorrection[] }> {
    return unwrap(await apiClient.get<ApiResponse<{ corrections: RecordCorrection[] }>>(API_ENDPOINTS.semanticModels.corrections(id)));
  },
  async recordCorrection(id: string, correction: RecordCorrectionInput): Promise<RecordCorrectionResult> {
    return unwrap(await apiClient.post<ApiResponse<RecordCorrectionResult>>(API_ENDPOINTS.semanticModels.corrections(id), correction, { timeout: 0 }));
  },
  async undoCorrection(id: string, sequence: number): Promise<RecordCorrectionResult> {
    return unwrap(await apiClient.post<ApiResponse<RecordCorrectionResult>>(API_ENDPOINTS.semanticModels.undoCorrection(id, sequence), {}, { timeout: 0 }));
  },
  async mappingHealth(id: string): Promise<MappingHealthResponse> {
    return unwrap(await apiClient.post<ApiResponse<MappingHealthResponse>>(API_ENDPOINTS.semanticModels.mappingHealth(id), {}));
  },
  /** A concept scope reads that concept's sources again and keeps every other concept's data in use. */
  async requestPopulationRefresh(id: string, body: { purpose: 'build' | 'refresh'; scope: { kind: 'model' } | { kind: 'mapping'; mappingId: string } | { kind: 'concept'; conceptId: string }; rereadDocuments?: boolean }): Promise<PopulationRefreshResponse> {
    return unwrap(await apiClient.post<ApiResponse<PopulationRefreshResponse>>(API_ENDPOINTS.semanticModels.populationRefresh(id), body, { timeout: 0 }));
  },
  /** Clear every record, link and review item generated for the model, then read every source again. */
  async rebuildPopulation(id: string, body: { forgetDocumentReading: boolean }): Promise<PopulationRebuildResponse> {
    return unwrap(await apiClient.post<ApiResponse<PopulationRebuildResponse>>(API_ENDPOINTS.semanticModels.populationRebuild(id), body, { timeout: 0 }));
  },
  /** Which graph the draft and the published data use, and whether it holds all the stored data. */
  async graphStatus(id: string): Promise<GraphStatus> {
    return unwrap(await apiClient.get<ApiResponse<GraphStatus>>(API_ENDPOINTS.semanticModels.populationGraphStatus(id)));
  },
  /** Rebuild the graph of the data in use from its stored records and links: no source is read, no AI call. */
  async reprojectPopulationGraph(id: string): Promise<PopulationReprojectResponse> {
    return unwrap(await apiClient.post<ApiResponse<PopulationReprojectResponse>>(API_ENDPOINTS.semanticModels.populationReproject(id), {}, { timeout: 0 }));
  },
  /** This person's latest data updates of the model, newest first. */
  async listPopulationJobs(id: string, limit = 20): Promise<PopulationJob[]> {
    return unwrap(await apiClient.get<ApiResponse<{ items: PopulationJob[] }>>(API_ENDPOINTS.semanticModels.populationJobs(id), { params: { limit } })).items;
  },
  async myJobs(params: MyJobsQuery = {}): Promise<MyJobsPage> {
    return unwrap(await apiClient.get<ApiResponse<MyJobsPage>>(API_ENDPOINTS.semanticModels.myJobs, { params }));
  },
  async stopMyJob(jobId: string, onlyQueued = false): Promise<PopulationJob> {
    return unwrap(await apiClient.post<ApiResponse<PopulationJob>>(API_ENDPOINTS.semanticModels.myJobStop(jobId), { onlyQueued }));
  },
  async removeMyQueuedJobs(modelId?: string): Promise<{ cancelled: number; skipped: number }> {
    return unwrap(await apiClient.post<ApiResponse<{ cancelled: number; skipped: number }>>(API_ENDPOINTS.semanticModels.myQueuedJobsRemove, { modelId }));
  },
  async getPopulationJob(id: string, jobId: string): Promise<PopulationJob> {
    return unwrap(await apiClient.get<ApiResponse<PopulationJob>>(API_ENDPOINTS.semanticModels.populationJob(id, jobId)));
  },
  /** Stop a data update; nothing it read is kept, the data in use stays as it was. */
  async stopPopulationJob(id: string, jobId: string): Promise<PopulationJob> {
    return unwrap(await apiClient.post<ApiResponse<PopulationJob>>(API_ENDPOINTS.semanticModels.populationJobStop(id, jobId), {}));
  },
  /** Sources an assistant suggested for the concepts, with whether each was used or skipped. */
  async sourceSuggestions(id: string): Promise<SourceSuggestionsPage> {
    return unwrap(await apiClient.get<ApiResponse<SourceSuggestionsPage>>(API_ENDPOINTS.semanticModels.sourceSuggestions(id)));
  },
  async setSourceSuggestionStatus(id: string, conceptKey: string, status: 'pending' | 'skipped'): Promise<SourceSuggestionsPage> {
    return unwrap(await apiClient.put<ApiResponse<SourceSuggestionsPage>>(API_ENDPOINTS.semanticModels.sourceSuggestionStatus(id, conceptKey), { status }));
  },
  /** Files matching a name across every workspace the person can open. */
  async searchSourceFiles(id: string, search: string, page = 1): Promise<SourceFileMatches> {
    return unwrap(await apiClient.get<ApiResponse<SourceFileMatches>>(API_ENDPOINTS.semanticModels.sourceFiles(id), { params: { search, page } }));
  },
  /** Whether the records in use were built from the model as it is now. */
  async populationFreshness(id: string): Promise<PopulationFreshness> {
    return unwrap(await apiClient.get<ApiResponse<PopulationFreshness>>(API_ENDPOINTS.semanticModels.populationFreshness(id)));
  },
  /** Every inconsistency in the model as it is now, found without running anything. */
  async check(id: string): Promise<ModelCheck> {
    return unwrap(await apiClient.get<ApiResponse<ModelCheck>>(API_ENDPOINTS.semanticModels.check(id)));
  },
  async canvasPositions(id: string): Promise<DesignerBoxPosition[]> {
    return unwrap(await apiClient.get<ApiResponse<{ positions: DesignerBoxPosition[] }>>(API_ENDPOINTS.semanticModels.canvasPositions(id))).positions;
  },
  async saveCanvasPositions(id: string, positions: DesignerBoxPosition[]): Promise<void> {
    await apiClient.put(API_ENDPOINTS.semanticModels.canvasPositions(id), { positions });
  },
  async readiness(id: string): Promise<SemanticReadiness> {
    return unwrap(await apiClient.get<ApiResponse<SemanticReadiness>>(API_ENDPOINTS.semanticModels.readiness(id)));
  },
  async modelHealth(id: string): Promise<ModelHealth> {
    return unwrap(await apiClient.get<ApiResponse<ModelHealth>>(API_ENDPOINTS.semanticModels.health(id)));
  },
  async reviewQueue(id: string): Promise<ReviewQueue> {
    return unwrap(await apiClient.get<ApiResponse<ReviewQueue>>(API_ENDPOINTS.semanticModels.reviewQueue(id)));
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
