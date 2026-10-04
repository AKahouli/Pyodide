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
}

/** What a clone copies besides the structure; data needs the sources. */
export interface SemanticModelCloneInclude { sources: boolean; data: boolean; shares: boolean }

export type SemanticModelCloneResult = SemanticModel & {
  dataCopy?: { status: 'copied' | 'skipped' | 'failed'; reason?: string; records?: number; links?: number };
};

export interface AttributeDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'enum';
  required: boolean;
  description?: string;
  options?: string[];
  /** Business synonyms for this field. */
  aliases?: string[];
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

/** Rules alone, AI alone, or the rules first and the AI only for what they did not find. */
export type SourceExtractionStrategy = 'deterministic' | 'ai' | 'rules_then_ai';

export type ExtractionLocation = 'auto' | 'same_line' | 'next_line' | 'table' | 'heading' | 'anywhere' | 'after_label' | 'before_label' | 'pages';

export type ExtractionTakeUnit = 'characters' | 'words' | 'lines';

/** Keep only the first or last `count` characters, words or lines of the text found (1..20000). */
export interface ExtractionTake {
  from: 'start' | 'end';
  count: number;
  unit: ExtractionTakeUnit;
}

/** Where a document value is and what it looks like. Without rules: `Label: value`, or a table row. */
export interface ExtractionRules {
  /** Labels the value follows; empty means the field's name. */
  labels?: string[];
  location?: ExtractionLocation;
  /** after_label: where the passage stops; before_label: where it starts. Empty: the end/start of the section. */
  boundaryLabels?: string[];
  /** location 'pages' only: the pages read whole (at most 50). */
  pages?: { from: number; to?: number };
  /** Part of the text found to keep, before the pattern and clean-up; absent keeps everything. */
  take?: ExtractionTake;
  /** A regular expression the value must match; its first group is kept when it has one. */
  pattern?: string;
  transform?: 'none' | 'trim' | 'no_spaces' | 'upper' | 'lower' | 'date_iso';
  /** Keep a value only when every match agrees, or keep the first one. */
  occurrence?: 'unique' | 'first';
  firstPageOnly?: boolean;
}

export interface SourceFieldMapping {
  sourceField: string | null;
  targetAttribute: string;
  mode: 'direct' | 'extract' | 'metadata' | 'constant' | 'computed' | 'ignore';
  constantValue?: unknown;
  /**
   * mode='computed': a value taken from the file name (documents), a column (sheets) or another field.
   * mode='direct' (sheets, mappings saved before the field modes): the column's recipe; absent reads it as is.
   */
  computed?: ComputedFieldRule;
  // Only meaningful for mode='extract'; absent means deterministic.
  extractionStrategy?: SourceExtractionStrategy;
  /** AI reading only: what the value means and what to look for; empty uses the attribute's description. */
  semanticDefinition?: string;
  /** AI reading only: the agent asked to read the field; absent means the platform's extraction agent. */
  agentId?: string;
  rules?: ExtractionRules;
}

/** One input a recipe reads: the file name (documents), another field, or a column (sheets; a source field for records). */
export type ComputedInputRef = { kind: 'file'; name: 'document_name' } | { kind: 'field'; name: string } | { kind: 'column'; name: string };
/** One part of a joined input: an input, or a fixed text. */
export type ComputedJoinPart = ComputedInputRef | { kind: 'text'; value: string };
/** Several parts joined into one text; `separator` defaults to ' ', `skipEmpty` (default true) leaves an empty part out. */
export interface ComputedJoinInput { kind: 'join'; parts: ComputedJoinPart[]; separator?: string; skipEmpty?: boolean }
export type ComputedFieldInput = ComputedInputRef | ComputedJoinInput;
/** 'whole' keeps the input as it is (no cut). */
export type ComputedFieldMethod = 'whole' | 'split' | 'between' | 'regex';
export type ComputedFieldTransform = 'none' | 'trim' | 'no_spaces' | 'upper' | 'lower' | 'date_iso' | 'year' | 'number';

/** How a computed field is cut out of its input, e.g. `ACME_2023_8K.pdf` split by `_`, 2nd part → `2023`. */
export interface ComputedFieldRule {
  input: ComputedFieldInput;
  method: ComputedFieldMethod;
  /** split: separator (1..10 characters) and position, non-zero, negative counts from the end. */
  delimiter?: string;
  part?: number;
  /** between: the text the value follows and/or precedes. */
  after?: string;
  before?: string;
  /** regex: a pattern with a group, and an optional output template (`{name}` / `{1}`). */
  pattern?: string;
  template?: string;
  stripExtension?: boolean;
  /** After the cut: keep only the first or last characters, words or lines, as the reading rules do. */
  take?: ExtractionTake;
  /** After the take: what the value looks like (a regular expression, first group kept). Distinct from `pattern`, the advanced cut. */
  valuePattern?: string;
  transform?: ComputedFieldTransform;
}

export interface ComputedPreviewResult {
  input: string | null;
  value: string | null;
  reason: 'found' | 'no_input' | 'no_match' | 'not_transformable';
  /** The value after each step that ran; null where the recipe stopped. */
  steps?: Array<{ step: 'join' | 'cut' | 'keep' | 'pattern' | 'transform'; value: string | null }>;
}

/** How much of a document the AI reads. */
/** How much one population run may read and keep, set by an admin for every model. */
export interface RunLimits {
  maxRunSources: number;
  maxRecordsPerSource: number;
  maxRecordsPerRun: number;
  maxValuesPerRun: number;
}

export interface RunLimitsDefaults {
  runLimits: RunLimits;
  configured: Partial<RunLimits>;
}

export interface AiExtractionSettings {
  maxBlocks: number;
  maxCharacters: number;
  longDocumentCharacters: number;
  blocksPerField: number;
  /** One document gives several records, one per item the AI finds. Set on a mapping only. */
  manyRecords?: boolean;
}

/** The admin defaults with every limit filled in, and which ones the admin set. */
export interface AiExtractionDefaults {
  aiSettings: AiExtractionSettings;
  configured: Partial<AiExtractionSettings>;
}

/** How one extracted field was read in a preview, or why it was not. */
export interface DocumentFieldReading {
  /** `direct`: a sheet column read as it is. */
  method: 'rules' | 'ai' | 'computed' | 'direct';
  /** Sheets: the column whose cell the value was read from, and where in its text. */
  column?: string;
  span?: { start: number; end: number } | null;
  reason: 'found' | 'label_not_found' | 'no_value' | 'several_values' | 'pattern_mismatch' | 'no_heading' | 'no_match' | 'no_page' | 'ai_not_found' | 'ai_failed' | 'no_input' | 'not_transformable';
  /** Computed fields: the text the value was taken from. */
  input?: string | null;
  value?: unknown;
  values?: string[];
  page?: number | null;
  /** Last page of a passage that runs over several pages. */
  pageEnd?: number | null;
  /** The text the place found, before the part kept, the pattern and clean-up (up to 3000 characters). */
  raw?: string | null;
  quote?: string | null;
  detail?: string;
  /** For a field the rules missed before the AI was asked: why the rules missed it. */
  rules?: Omit<DocumentFieldReading, 'rules'>;
}

/** A change an assistant (an agent using the semantic model MCP) made to the model. */
export interface AssistantChange {
  id: string;
  message: string;
  agentId: string | null;
  createdAt: string;
  undoneAt: string | null;
}

export interface AssistantChangesPage {
  graphRevision: number;
  /** Server time of the answer, to ask only for what happens after it. */
  now: string;
  /** A data update running for this model (started here, from a conversation, or elsewhere). */
  activeRun?: { jobId: string; state: string } | null;
  changes: AssistantChange[];
}

/** A source an assistant suggested for a concept. Nothing is connected until someone picks it. */
export interface SourceSuggestionOption {
  workspaceId: string;
  workspaceName: string;
  /** workspace: every file; documents: picked folders and files; document / spreadsheet: one file. */
  kind: 'workspace' | 'documents' | 'document' | 'spreadsheet';
  folderIds: string[];
  documentIds: string[];
  folders: string[];
  documents: string[];
  sheetName?: string;
  mimeType?: string;
  fileCount: number;
  stillIndexing: number;
  reason: string;
}

/** A file found by name across the person's workspaces, to choose as a source. */
export interface SourceFileMatch {
  id: string;
  name: string;
  mimeType: string;
  kind: 'spreadsheet' | 'document' | 'other';
  workspaceId: string;
  workspaceName: string;
  folderName: string | null;
}

export interface SourceFileMatches {
  files: SourceFileMatch[];
  page: number;
  totalPages: number;
}

export interface SourceSuggestion {
  conceptId: string;
  conceptKey: string;
  conceptLabel: string;
  note: string;
  options: SourceSuggestionOption[];
  /** connected: the concept got a source since (from this suggestion or not). */
  status: 'pending' | 'skipped' | 'connected';
  updatedAt: string;
}

export interface SourceSuggestionsPage {
  model: { id: string; name: string };
  suggestions: SourceSuggestion[];
}

/** How a derived record picks one value when the records it comes from disagree. */
export type DerivedConflictRule = 'most_frequent' | 'latest' | 'longest' | 'leave_empty';

/** A concept filled from another concept's records: one record per distinct key value they carry. */
/** How a concept is read from documents: what a preset holds and a new mapping can start from. */
export interface MappingSettings {
  fieldMappings: SourceFieldMapping[];
  aiSettings: Partial<AiExtractionSettings>;
  identityFields: string[];
}

/** Named settings for reading a concept from documents, copied into a mapping when applied. */
export interface MappingPreset extends MappingSettings {
  id: string;
  conceptId: string;
  name: string;
  description: string | null;
  updatedAt: string;
}

/** The document mapping of a concept saved most recently, possibly in a workspace unlinked since. */
export interface LastDocumentMapping extends MappingSettings {
  mappingId: string;
  scope: 'document' | 'workspace';
  /** Null when its workspace is no longer linked. */
  sourceName: string | null;
  workspaceLinked: boolean;
  updatedAt: string;
}

/**
 * A field of a concept filled from another concept's records, filled as a sheet field is from a row: copied
 * from a source field as it is (no `mode`, the shape every derived field had before), read out of a source
 * field's text with rules and/or AI (`extract`), taken by a recipe (`computed`; a `column` input names a
 * field of the source record), or fixed (`constant`).
 */
export interface DerivedFieldMapping {
  sourceAttribute?: string;
  targetAttribute: string;
  mode?: 'extract' | 'computed' | 'constant';
  extractionStrategy?: SourceExtractionStrategy;
  rules?: ExtractionRules;
  semanticDefinition?: string;
  agentId?: string;
  computed?: ComputedFieldRule;
  constantValue?: string | number | boolean;
}

/** Sample records of the source concept read with a derived source's fields, as a run would. */
export interface DerivedFieldPreviewRequest {
  conceptId: string;
  sourceConceptId: string;
  fieldMappings: DerivedFieldMapping[];
  records: Array<{ entityId: string; values: Record<string, string | number | boolean | null> }>;
}

export interface DerivedFieldPreviewResponse {
  /** For each record, how each field was read (or why not); `column` is the source field read. */
  records: Array<{ entityId: string; fields: Record<string, DocumentFieldReading> }>;
  ai: { aiRows: number; aiCalls: number; aiSkippedRows: number; aiFailedRows: number };
}

export interface DerivedSource {
  id: string;
  conceptId: string;
  sourceConceptId: string;
  fieldMappings: DerivedFieldMapping[];
  conflictRule: DerivedConflictRule;
  /** The source field ordering records for the most recent rule. */
  orderBy: string | null;
  updatedAt: string;
}

export interface DerivedSourceDraft {
  conceptId: string;
  sourceConceptId: string;
  fieldMappings: DerivedSource['fieldMappings'];
  identityFields: string[];
  conflictRule: DerivedConflictRule;
  orderBy?: string;
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
  /** 'workspace': one mapping for every readable file of a workspace (or folder), files added later included. */
  scope?: 'document' | 'workspace';
  folderId?: string | null;
  /** Workspace mappings: the picked folders and files, or null for the whole workspace. */
  /** This mapping's own AI reading limits; each one left out uses the admin default. */
  aiSettings?: Partial<AiExtractionSettings> | null;
  selection?: { folderIds: string[]; documentIds: string[] } | null;
  /** Workspace mappings: files it covers today, and files still being indexed. */
  fileCount?: number;
  waitingCount?: number;
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
  /** Files the run reads, workspace sources expanded. */
  sourceCount?: number;
  /** Files of a workspace source still being indexed; they are read by a later run. */
  waitingFiles?: number;
}

/** A rebuild from scratch: what was cleared, then the build it started. */
export interface PopulationRebuildResponse extends PopulationRefreshResponse {
  cleared: { revisions: number; reviewItems: number; jobs: number; documentReadings: number };
}

export interface PopulationJob {
  jobId: string;
  jobType: string;
  modelId: string | null;
  state: string;
  /** What the run has done so far; reported about once a second while it reads sources. */
  progress?: Partial<PopulationProgress>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
}

export interface PopulationProgress {
  phase: 'starting' | 'reading' | 'linking' | 'saving';
  total: number;
  done: number;
  /** Files whose earlier result was reused because nothing about them changed. */
  reused: number;
  records: number;
  gaps: number;
  current: { name: string; conceptId?: string; kind?: string } | null;
  recent: Array<{ name: string; conceptId?: string; status: string; records: number; reused: boolean }>;
  startedAt: string;
  /** What the saved result changed in the data in use; absent until saved, or when there was no data before. */
  changes?: PopulationChanges;
}

export interface PopulationChanges {
  added: number;
  removed: number;
  changed: number;
  /** Files read last time and not this time, with how many records came from them. */
  removedSources: Array<{ assetId: string; name?: string; records: number }>;
}

/** A page of one concept's records in the data in use. */
export interface ConceptRecordsPage {
  dataRevisionId: string | null;
  total: number;
  offset: number;
  limit: number;
  /** `identity` holds the normalized matching key: key fields are not repeated among the values. */
  records: Array<SemanticDataPreview['concepts'][number]['entities'][number] & { identity?: Record<string, unknown> }>;
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
    /** The concept or relationship to open to complete this step, when there is one. */
    targetId?: string;
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
  /** Documents only: how each extracted field was read, or why it was not. */
  fields?: Record<string, DocumentFieldReading>;
  /** Documents only: whether the whole document was read. */
  complete?: boolean;
  /** Documents only: 'read', or why the document could not be read (e.g. 'index_unavailable'). */
  documentStatus?: string;
  /** Documents only: what the AI was sent. */
  aiSent?: { documentCharacters: number; longDocument: boolean; blocksSent: number; charactersSent: number } | null;
}

/** A few picked sheet rows, read as a run would read them. */
export interface SheetFieldPreviewRequest {
  conceptId: string;
  workspaceId: string;
  documentId: string;
  fieldMappings: SourceFieldMapping[];
  rows: Array<{ rowNumber: number; values: Record<string, string | number | boolean | null> }>;
  aiSettings?: Partial<AiExtractionSettings>;
}

export interface SheetFieldPreviewResponse {
  /** For each row, how each field was read (or why not): as is, out of its cell (rules, AI), or by its recipe. */
  rows: Array<{ rowNumber: number; fields: Record<string, DocumentFieldReading> }>;
  /** How many rows the AI was asked about. */
  ai: { aiRows: number; aiCalls: number; aiSkippedRows: number; aiFailedRows: number };
}

export interface SourceMappingDraft {
  conceptId: string;
  workspaceId: string;
  documentId: string;
  sheetName: string;
  assetKind: SourceAssetKind;
  fieldMappings: SourceFieldMapping[];
  identityFields: string[];
  aiSettings?: Partial<AiExtractionSettings>;
}

/** Labels and section headings that recur across a few documents of a source. */
export interface DocumentLabelSuggestion {
  label: string;
  kind: 'heading' | 'label';
  /** How many of the documents read hold it. */
  documents: number;
  page: number | null;
  example: string;
}

export interface DocumentLabelsResponse {
  documentsRead: number;
  unread: Array<{ assetId: string; status: string }>;
  labels: DocumentLabelSuggestion[];
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
  aiSettings?: Partial<AiExtractionSettings>;
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
    /** Records of this concept in the whole run; `entities` is only the first page. */
    total?: number;
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
        /** Present when a person fixed this value. */
        correction?: ValueCorrection;
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
  /** What the prepared records are missing; absent on records prepared before gaps were kept. */
  gaps?: SemanticDataGaps;
  summary: { entities: number; resolvedRelations: number; unresolvedRelations: number; ambiguousRelations: number; conflicts: number };
}

export interface SemanticDataGaps {
  missingValues: Array<{ conceptId: string; conceptLabel: string; attribute: string; attributeLabel: string; missing: number; total: number }>;
  unresolvedLinks: Array<{ relationId: string; relationLabel: string; kind: string; count: number }>;
  other: Array<{ conceptId: string | null; conceptLabel: string | null; kind: string; count: number; fields?: string[] }>;
  /** A few rows behind each gap, with the file they come from; absent on data prepared before they were kept. */
  rowSamples?: Array<{
    conceptId: string | null;
    kind: string;
    field?: string;
    fieldLabel?: string;
    rowNumber?: number | string;
    source?: { mappingId: string; workspaceId: string; documentId: string; documentName: string; documentPath?: string; mimeType?: string; sheetName?: string; kind: SourceAssetKind };
    values: Record<string, unknown>;
  }>;
  /** Records whose link found nothing, and the value it looked for. */
  linkSamples?: Array<{ relationId: string; relationLabel: string; kind: string; sourceEntityId: string; referenceField?: string; referenceValue?: unknown; targetField?: string }>;
}

export interface ValueCorrection {
  sequence: number;
  correctedBy: string;
  correctedByYou: boolean;
  originalValue: unknown;
}

export type RecordCorrectionAction = 'edit_entity' | 'remove_entity' | 'add_relationship' | 'remove_relationship';

export interface RecordCorrectionInput {
  action: RecordCorrectionAction;
  targetIdentity: Record<string, string>;
  payload?: { attribute: string; value: unknown };
  reason?: string;
}

export interface RecordCorrection {
  sequence: number;
  action: RecordCorrectionAction | string;
  targetIdentity: Record<string, unknown>;
  payload: Record<string, unknown>;
  reason: string;
  createdAt: string | null;
  correctedBy: string;
  correctedByYou: boolean;
}

export interface RecordCorrectionResult {
  sequence: number;
  rebuild: { jobId: string; status: string } | null;
}

export type VersionChange =
  | { kind: 'concept_added' | 'concept_removed'; concept: string }
  | { kind: 'concept_renamed'; from: string; to: string }
  | { kind: 'field_added' | 'field_removed'; concept: string; field: string }
  | { kind: 'field_renamed'; concept: string; from: string; to: string }
  | { kind: 'field_type_changed'; concept: string; field: string; from: string; to: string }
  | { kind: 'field_required_changed'; concept: string; field: string; required: boolean }
  | { kind: 'relation_added' | 'relation_removed'; relation: string; source: string; target: string }
  | { kind: 'relation_renamed'; from: string; to: string; source: string; target: string }
  | { kind: 'relation_cardinality_changed'; relation: string; source: string; target: string; from: string; to: string };

export interface VersionComparison {
  changes: VersionChange[];
  /** Prepared records on each side, when known. */
  records: { before: number | null; after: number | null; change: number | null };
}

export type ReviewQueueAction =
  | { kind: 'choose_match'; reviewItemId: string; options: Array<{ value: string; label: string }>; select: 'target' | 'source' }
  | { kind: 'repair_mapping'; mappingId: string; bulkEdit?: boolean }
  | { kind: 'repair_derived'; derivedSourceId: string; conceptId: string }
  | { kind: 'choose_unique_field'; conceptId: string }
  | { kind: 'set_up_link'; relationId: string }
  | { kind: 'fix_values'; conceptId: string; attribute?: string }
  | { kind: 'add_source'; conceptId: string }
  | { kind: 'check_links'; relationId: string }
  | { kind: 'open_sources'; conceptId: string }
  | { kind: 'review_rows'; conceptId: string }
  | { kind: 'view_data' };

export interface ReviewQueueItem {
  key: string;
  group: 'decisions' | 'sources' | 'identity' | 'links' | 'data';
  priority: 1 | 2 | 3;
  kind: string;
  params: Record<string, string | number>;
  action: ReviewQueueAction;
}

export interface ReviewQueue {
  count: number;
  items: ReviewQueueItem[];
}

export interface PopulationFreshness {
  /** current: built from the model as it is now; outdated: the design, a mapping or a source file changed since. */
  state: 'current' | 'outdated' | 'never_run' | 'not_runnable';
  reason?: string;
}

/** Where a source or typed-record box sits on the canvas. */
export interface DesignerBoxPosition { id: string; x: number; y: number }
