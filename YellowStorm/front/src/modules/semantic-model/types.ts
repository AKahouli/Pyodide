export type SemanticModelShareRole = 'viewer' | 'editor';

export interface SemanticModelMember {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: SemanticModelShareRole;
  createdAt: string;
}

export interface SemanticModelShareResult {
  shared: { userId: string; email: string; role: SemanticModelShareRole }[];
  notFound: string[];
  alreadyOwner: string[];
  alreadyShared: string[];
}

export type SemanticModelKind = 'workspace_default' | 'designed';
export type SemanticModelStatus = 'draft' | 'published' | 'archived';
export type SemanticModelMaturity = 'automatic' | 'structured' | 'structured_with_records' | 'operational';
export type EditorMode = 'structure' | 'records' | 'mappings';
export type SaveStatus = 'saved' | 'saving' | 'offline' | 'error' | 'conflict';
export type SemanticModelIndexStatus = 'not_indexed' | 'pending' | 'in_progress' | 'indexed' | 'failed';

export interface SemanticModel {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  kind: SemanticModelKind;
  status: SemanticModelStatus;
  revision: number;
  originWorkspaceId: string | null;
  nameManagedBySystem: boolean;
  currentDraftVersionId: string | null;
  currentPublishedVersionId: string | null;
  role?: 'owner' | 'editor' | 'viewer';
  workspaceCount?: number;
  nodeCount?: number;
  relationCount?: number;
  recordCount?: number;
  bindingCount?: number;
  brokenBindingCount?: number;
  createdAt: string;
  updatedAt: string;
  indexStatus: SemanticModelIndexStatus;
  indexError: string | null;
  executionOwner?: 'legacy' | 'runtime';
}

export interface SemanticModelManualInstances {
  nodeTypeId: string;
  labels: string[];
}

export interface AttributeDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'enum';
  required: boolean;
  description?: string;
  options?: string[];
}

export interface CanvasPosition { x: number; y: number }

export interface SemanticNodeType {
  id: string;
  key: string;
  label: string;
  description: string;
  category: 'business_object' | 'classification' | 'system_collection';
  recordPolicy: 'none' | 'optional' | 'expected';
  systemKey: string | null;
  aliases: string[];
  attributes: AttributeDefinition[];
  position: CanvasPosition;
}

export interface SemanticRelationType {
  id: string;
  key: string;
  label: string;
  inverseLabel: string;
  description: string;
  sourceNodeTypeId: string;
  targetNodeTypeId: string;
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
  traversable: boolean;
  filterable: boolean;
  attributes: AttributeDefinition[];
}

export interface SemanticRecord {
  id: string;
  nodeTypeId: string;
  label: string;
  values: Record<string, unknown>;
  status: 'active' | 'inactive';
  position: CanvasPosition;
}

export interface SemanticRecordRelation {
  id: string;
  relationTypeId: string;
  sourceRecordId: string;
  targetRecordId: string;
  values: Record<string, unknown>;
}

export interface AgeGraphNode {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface AgeGraphEdge {
  id: string;
  label: string;
  sourceId: string;
  targetId: string;
  properties: Record<string, unknown>;
}

export type AgeGraphOperation =
  | { type: 'node.create'; nodeTypeId: string; label: string; values: Record<string, unknown> }
  | { type: 'node.delete'; nodeId: string }
  | { type: 'edge.create'; relationTypeId: string; sourceId: string; targetId: string }
  | { type: 'edge.delete'; edgeId: string };

export interface SemanticCorpusDocument {
  sourceDocumentId: string;
  workspaceId: string;
  originalName: string;
  indexingStatus?: 'none' | 'pending' | 'processing' | 'ready' | 'failed';
}

export interface SemanticCorpusBinding {
  target: { kind: string; id: string | null; label: string };
  documents: SemanticCorpusDocument[];
}

export interface SemanticCorpusManifest {
  bindings: SemanticCorpusBinding[];
}

export interface SemanticGraph {
  modelId: string;
  versionId: string;
  revision: number;
  nodes: SemanticNodeType[];
  relations: SemanticRelationType[];
  records: SemanticRecord[];
  recordRelations: SemanticRecordRelation[];
}

export type SemanticGraphOperation =
  | { type: 'node_type.create'; entity: SemanticNodeType }
  | { type: 'node_type.update'; id: string; changes: Partial<Omit<SemanticNodeType, 'id' | 'systemKey'>> }
  | { type: 'node_type.delete'; id: string }
  | { type: 'relation_type.create'; entity: SemanticRelationType }
  | { type: 'relation_type.update'; id: string; changes: Partial<Omit<SemanticRelationType, 'id'>> }
  | { type: 'relation_type.delete'; id: string }
  | { type: 'record.create'; entity: SemanticRecord }
  | { type: 'record.update'; id: string; changes: Partial<Omit<SemanticRecord, 'id' | 'nodeTypeId'>> }
  | { type: 'record.delete'; id: string }
  | { type: 'record_relation.create'; entity: SemanticRecordRelation }
  | { type: 'record_relation.update'; id: string; changes: Pick<SemanticRecordRelation, 'values'> }
  | { type: 'record_relation.delete'; id: string }
  | { type: 'layout.update'; positions: Array<{ id: string; position: CanvasPosition }> };

export interface ValidationIssue {
  code: 'missing_description' | 'isolated_node' | 'expected_records_missing' | 'duplicate_key' | 'invalid_relation_endpoint' | 'attribute_key_invalid' | 'attribute_key_duplicate' | 'record_policy_invalid' | 'record_value_required' | 'record_relation_incompatible';
  severity: 'error' | 'warning';
  targetKind: 'model' | 'node_type' | 'relation_type' | 'record' | 'binding' | 'workspace';
  targetId?: string;
  message: string;
}

export interface KnowledgeBinding {
  id: string;
  targetKind: 'model' | 'node_type' | 'relation_type' | 'record';
  targetId: string | null;
  resourceKind: 'workspace' | 'document';
  workspaceId: string;
  documentId: string | null;
  inclusionMode: 'dynamic' | 'explicit';
  retrievalMode: 'broad' | 'targeted' | 'evidence_only';
  priority: number;
  enabled: boolean;
  protected: boolean;
  availability: 'available' | 'indexing' | 'unavailable';
}

export interface SemanticVersion {
  id: string;
  versionNumber: number;
  status: SemanticModelStatus;
  revision: number;
  baseVersionId: string | null;
  createdBy: string;
  publishedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface SemanticEvidenceSearchTask {
  bindingId: string;
  target: {
    kind: KnowledgeBinding['targetKind'];
    id?: string;
    label: string;
  };
  workspaceId: string;
  text: string;
  evidence: Array<{
    source: string;
    fileName: string;
    page?: string;
    quote?: string;
    workspaceId?: string;
    reference?: string;
  }>;
  toolResults: Array<{ name: string; status: 'completed' | 'failed'; result: unknown }>;
}

export interface SemanticEvidenceSearchResponse {
  modelId: string;
  searchedAt: string;
  tasks: SemanticEvidenceSearchTask[];
  summary: {
    searchedBindingCount: number;
    candidateDocumentCount: number;
  };
}

export interface MappingProposalJob {
  jobId: string;
  modelId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  result?: SemanticModelMappingProposalResponse;
  error?: string;
}

export type SemanticBuildStatus = 'running' | 'completed' | 'failed';
export type SemanticBuildStep = 'ontology' | 'mapping' | 'apply';
export type SemanticBuildStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type SemanticBuildApplyMode = 'replace' | 'incremental';

export interface SemanticBuildJob {
  buildId: string;
  modelId: string;
  startedBy: string;
  status: SemanticBuildStatus;
  currentStep: SemanticBuildStep | null;
  ontologyStatus: SemanticBuildStepStatus;
  mappingStatus: SemanticBuildStepStatus;
  applyStatus: SemanticBuildStepStatus;
  applyMode: SemanticBuildApplyMode;
  mappingJobId: string | null;
  graphWarning: string | null;
  error: string | null;
  startedAt: string;
  ontologyCompletedAt: string | null;
  mappingCompletedAt: string | null;
  applyCompletedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string;
}

export interface SemanticModelMappingProposalResponse {
  modelId: string;
  generatedAt: string;
  search: {
    searchedBindingCount: number;
    candidateDocumentCount: number;
  };
  plan: {
    nodes: Array<{
      id: string;
      nodeTypeId: string;
      label: string;
      attributes: Array<{ key: string; value: string | number | boolean; evidenceReferences: string[] }>;
      evidenceReferences: string[];
      confidence: number;
    }>;
    edges: Array<{
      id: string;
      relationTypeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      evidenceReferences: string[];
      confidence: number;
    }>;
    mergeGroups: Array<{ canonicalNodeId: string; mergedNodeIds: string[]; reason: string }>;
  };
  proposals: SemanticModelMappingProposal[];
}

export interface SemanticModelMappingProposal {
  id: string;
  target: { nodeTypeLabel: string; attributeLabel: string };
  value: string | number | boolean;
  normalizedValue?: string | number | boolean;
  normalization: { status: 'valid' | 'invalid'; reason: 'normalized' | 'empty_value' | 'invalid_number' | 'invalid_boolean' | 'invalid_date' | 'invalid_enum' };
  evidence: { fileName: string; page?: string; quote: string };
}

export interface Paginated<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ── Structured source mappings ───────────────────────────────────────────────

export type SourceAssetKind = 'excel_sheet' | 'csv' | 'document';

export interface StructuredSourceAsset {
  workspaceId: string;
  documentId: string;
  name: string;
  kind: SourceAssetKind;
  mimeType: string;
  path: string;
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  fieldCount: number;
}

export interface SheetFieldProfile {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date';
  sample: string;
  populatedRatio: number;
  uniqueRatio: number;
}

export interface SheetProfile {
  sheets: SheetSummary[];
  sheet?: SheetSummary;
  fields?: SheetFieldProfile[];
  sampleRows?: Record<string, unknown>[];
  totalRows?: number;
  complete?: boolean;
}

export interface SourceFieldMapping {
  sourceField: string | null;
  targetAttribute: string;
  mode: 'direct' | 'extract' | 'metadata' | 'constant' | 'ignore';
  constantValue?: unknown;
}

export interface ConceptSourceMapping {
  id: string;
  conceptId: string;
  workspaceId: string;
  documentId: string;
  documentName?: string;
  documentPath?: string;
  mimeType?: string;
  sheetName: string;
  assetKind: SourceAssetKind;
  fieldMappings: SourceFieldMapping[];
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  identityFields: string[];
  validatedSourceVersion?: string | null;
  validatedAt?: string | null;
}

export type MappingHealthState = 'healthy' | 'changed' | 'unavailable' | 'broken' | 'checking';

export interface MappingHealthItem extends ConceptSourceMapping {
  conceptLabel: string;
  sourceEnabled: boolean;
  documentName: string;
  state: MappingHealthState;
  currentSourceVersion: string | null;
  missingFields: string[];
  availableFields: string[];
  message: string | null;
}

export interface MappingHealthResponse {
  items: MappingHealthItem[];
  truncated: boolean;
  summary: Record<MappingHealthState, number>;
}

export interface PopulationRefreshResponse {
  jobId: string;
  status: string;
  progressUrl: string;
  reused: boolean;
  skipped: Array<{ mappingId: string; reason: string }>;
}

export interface PopulationJob {
  jobId: string;
  jobType: string;
  modelId: string | null;
  state: string;
  result: Record<string, unknown> | null;
  errorCode: string | null;
}

export interface SemanticReadiness {
  status: 'not_configured' | 'needs_review' | 'ready';
  score: number;
  completeAreas: number;
  totalAreas: number;
  areas: Array<{
    key: 'structure' | 'sources' | 'identity' | 'relationships' | 'quality';
    complete: boolean;
    issues: Array<{ severity: 'blocking' | 'review'; message: string }>;
  }>;
}

export interface SemanticReviewItem {
  id: string;
  kind: 'ambiguous_relation' | 'source_conflict' | 'broken_mapping';
  targetId: string;
  status: 'open' | 'resolved';
  details: Record<string, unknown>;
  resolution: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface SourceMappingPreviewResponse {
  entities: Array<{
    entityKey: string;
    label: string;
    values: Record<string, unknown>;
    provenance: {
      rowNumber?: number;
      fields?: Record<string, { method: 'direct_mapping' | 'semantic_extraction' | 'document_metadata' | 'fixed_value'; page?: string; quote?: string; reference?: string; confidence?: number }>;
    };
  }>;
  stats: { scannedRows: number; resolvedEntities: number; duplicateKeysSkipped: number; nullIdentitySkipped: number };
  identityEvidence: SheetFieldProfile[];
  warnings: string[];
}

export interface SourceMappingDraft {
  conceptId: string;
  workspaceId: string;
  documentId: string;
  sheetName: string;
  assetKind: SourceAssetKind;
  fieldMappings: SourceFieldMapping[];
  identityFields: string[];
}

export interface SourceMappingPreviewDraft {
  conceptId: string;
  workspaceId: string;
  documentId: string;
  sheetName?: string;
  assetKind: SourceAssetKind;
  fieldMappings: SourceFieldMapping[];
  identityFields: string[];
  limit?: number;
}

export type RelationMatchStrategy = 'exact' | 'case_insensitive' | 'normalized';
export type RelationCardinality = 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';

export interface RelationResolutionRule {
  id: string;
  relationId: string;
  relationLabel: string;
  sourceConceptId: string;
  sourceConceptLabel: string;
  targetConceptId: string;
  targetConceptLabel: string;
  sourceAttribute: string;
  targetAttribute: string;
  cardinality: RelationCardinality;
  strategy: RelationMatchStrategy;
  ambiguityPolicy: 'review' | 'unresolved';
}

export interface RelationResolutionPreview {
  rule: RelationResolutionRule;
  matches: Array<{
    sourceEntityId: string;
    targetEntityIds: string[];
    sourceLabel: string;
    targetLabels: string[];
    status: 'resolved' | 'ambiguous' | 'unresolved';
    sourceValue: unknown;
    strategy: RelationMatchStrategy;
    partial: boolean;
  }>;
  summary: { resolved: number; ambiguous: number; unresolved: number };
  sourceIssues: SourcePreviewIssue[];
}

export interface SourceResolutionPolicy {
  conceptId: string;
  priorities: Array<{ mappingId: string; rank: number }>;
  defaultStrategy: 'primary_then_fallback';
}

export interface SourcePreviewIssue {
  mappingId: string;
  code: 'source_unavailable';
  message: string;
  documentName?: string;
  reason?: string;
  detail?: string;
}

export interface SemanticDataPreview {
  dataRevisionId?: string;
  concepts: Array<{
    id: string;
    label: string;
    entities: Array<{
      id: string;
      conceptId: string;
      entityKey: string;
      label: string;
      values: Record<string, unknown>;
      provenance: Record<string, {
        mappingId: string;
        source: {
          kind: SourceAssetKind | 'manual';
          workspaceId?: string;
          documentId?: string;
          documentName: string;
          documentPath?: string;
          mimeType?: string;
          sheetName?: string;
        };
        rowNumber?: number;
        field?: NonNullable<SourceMappingPreviewResponse['entities'][number]['provenance']['fields']>[string];
      }>;
      sources?: Array<{ mappingId: string; source: { documentName: string; sheetName?: string } }>;
      conflicts: Array<{ attribute: string; preferred: unknown; conflicting: unknown; preferredMappingId: string; conflictingMappingId: string }>;
    }>;
  }>;
  relations: Array<{
    relationId: string;
    relationLabel: string;
    sourceEntityId: string;
    targetEntityIds: string[];
    status: 'resolved' | 'ambiguous' | 'unresolved';
    sourceValue: unknown;
    sourceAttribute: string;
    targetAttribute: string;
    targetValues: unknown[];
    strategy: RelationMatchStrategy;
    partial: boolean;
  }>;
  sourceIssues: SourcePreviewIssue[];
  summary: { entities: number; resolvedRelations: number; unresolvedRelations: number; ambiguousRelations: number; conflicts: number };
}
