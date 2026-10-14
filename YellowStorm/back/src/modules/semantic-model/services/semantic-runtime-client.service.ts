import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { GraphExposure } from '../domain/semantic-graph-exposure';
import type { ResolvedEntity } from '../domain/semantic-source-mapping.types';
import { runtimeErrorMessage, runtimeUnreachableMessage } from '../domain/runtime-error-messages';
import type { ModelCheckIssue } from '../domain/semantic-model-check';

// Thin NestJS client for the merged semantic-model-runtime (P2.11). Single
// shot per call with the configured deadline; no retries without the caller's
// original idempotency key. Runtime command validation stays server-side.
export interface RuntimePopulationRunCommand {
  actorUserId: string;
  modelId: string;
  workspaceId: string;
  payload: Record<string, unknown>;
}

export interface RuntimeAcceptedJob {
  jobId: string;
  status: string;
  progressUrl: string;
  reused: boolean;
}

export interface RuntimeDiscoveryCommand {
  actorUserId: string;
  modelId: string;
  workspaceId: string;
  payload: Record<string, unknown>;
}

/** Where a queued job stands on its task queue; counts only, never other jobs' models or workspaces. */
export interface RuntimeJobQueue {
  queueName: string;
  /** 1-based: jobs ahead of this one on the queue (queued or running, all models and workspaces) plus one. */
  position: number;
  ahead: { running: number; queued: number };
  /** Workers consuming the queue; null when the runtime cannot tell. */
  workersOnline: number | null;
}

export interface RuntimeJob {
  jobId: string;
  jobType: string;
  modelId: string | null;
  state: string;
  /** What a running job has done so far (population runs report it source by source, then step by step: `step` = { unit, done, total } while saving and building the graph). */
  progress?: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Present only while the job is `queued`. */
  queue?: RuntimeJobQueue;
  scope?: { kind: 'model' | 'concept'; conceptId?: string };
  purpose?: string | null;
}

export interface RuntimeMyJobsPage {
  items: RuntimeJob[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  activeCount: number;
  queuedCount: number;
}

export interface RuntimeValueOrigin {
  kind: 'source' | 'human' | 'metadata' | 'ai';
  assetId?: string | null;
  rowNumber?: number | string;
  column?: string;
  pageNumber?: number;
  sheet?: string;
  /** Set when a person corrected this value: who, and the value the source gave. */
  correctedBy?: string | null;
  originalValue?: unknown;
  correctionSequence?: number | null;
  /** A value taken from another concept's record: which record, which field, and how it was read. */
  derivedFrom?: {
    conceptId?: string | null; entityId?: string | null; label?: string | null; attribute?: string | null;
    attributes?: string[]; method?: string; rule?: string | null; records?: number | null;
  };
  /** A recipe joining several columns or fields: every one it read. */
  recipeSources?: string[];
}

export interface RuntimeDataSummary {
  modelId: string;
  draft: { modelVersionId: string; records: number; links: number } | null;
  production: { modelVersionId: string; records: number; links: number } | null;
}

export interface RuntimeCloneDataCommand {
  targetModelId: string;
  targetModelVersionId: string;
  idMap: { concepts: Record<string, string>; relations: Record<string, string>; mappings: Record<string, string> };
  /** The clone's own build plan, when the source data is current: the copy then reads as current. */
  homeWorkspaceId?: string;
  specHash?: string;
  specification?: Record<string, unknown>;
  executionFingerprint?: string;
}

export interface RuntimeClonedData {
  copied: boolean;
  reason?: string;
  revisionId?: string;
  counts?: { entities: number; relationships: number; assertions?: number; reviewItems?: number; corrections?: number };
}

export interface RuntimeCorrection {
  sequence: number;
  modelVersionId: string | null;
  actorUserId: string | null;
  reason: string;
  targetIdentity: Record<string, unknown>;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string | null;
}

export interface RuntimeRevisionGaps {
  missingValues: { conceptId: string; attribute: string; missing: number; total: number }[];
  unresolvedLinks: { relationId: string; kind: string; count: number }[];
  other: { conceptId: string | null; kind: string; count: number; fields?: string[]; details?: Record<string, unknown> }[];
  /** A few rows behind each gap, with the file they come from; absent on data prepared before they were kept. */
  rowSamples?: {
    conceptId: string | null; kind: string; field?: string; rowNumber?: number | string;
    asset?: { workspaceId?: string; assetId?: string }; values?: Record<string, unknown>
  }[];
  linkSamples?: {
    relationId: string; kind: string; sourceEntityId: string; referenceField?: string;
    referenceValue?: unknown; targetField?: string
  }[];
}

/** A row behind a finding, with where it comes from. */
export interface RuntimeHealthExample {
  source?: string;
  sheet?: string;
  row?: number | string;
  record?: string;
  workspaceId?: string;
  key?: Record<string, string>;
  values: Record<string, unknown>;
}

export type RuntimeHealthFinding =
  | { kind: 'identity_too_coarse'; rows: number; entities: number; keyFields: string[]; discardedValues: number;
      topKeyValues: { values: Record<string, string>; rows: number }[]; keyCardinality?: Record<string, number>;
      suggestedKey?: { fields: string[]; estimatedRecords: number; sampleRows: number }; examples: RuntimeHealthExample[] }
  | { kind: 'missing_identity'; field: string; rows: number; aiRead?: boolean; examples: RuntimeHealthExample[] }
  | { kind: 'conflicting_values'; field: string; rows: number; distinctValues: number; values: string[]; examples: RuntimeHealthExample[] }
  | { kind: 'ai_row_limit' | 'ai_read'; limit: number; rowsRead: number; rowsLimited: number; rowsFailed: number;
      fields?: string[]; examples: RuntimeHealthExample[] }
  /** A mail table read with something left out or cut: counts by outcome, and the limits it was read with. */
  | { kind: 'archive_reading'; sheet: string; total: number; counts: Record<string, number>; limits: Record<string, number>;
      examples: RuntimeHealthExample[] };

/** How one concept's rows became records. */
export interface RuntimeConceptHealth {
  conceptId: string;
  keyFields: string[];
  workspaceIds: string[];
  sources: { name?: string | null; sheet?: string | null; workspaceId?: string | null; rowsAvailable: number | null;
    rowsRead: number; derivedFrom?: string }[];
  rowsAvailable: number | null;
  rowsRead: number;
  rowsKeyed: number;
  recordsMade: number;
  dropped: { reason: string; rows: number; field?: string }[];
  ai?: { limit: number; rowsRead: number; rowsLimited: number; rowsFailed: number; fields?: string[] };
  findings: RuntimeHealthFinding[];
}

/** The run's account of every concept it read; absent from data prepared before it was kept. */
export interface RuntimeModelHealth {
  version: number;
  concepts: Record<string, RuntimeConceptHealth>;
}

export interface RuntimeConceptRecordsPage {
  modelId: string;
  conceptId: string;
  dataRevisionId: string;
  total: number;
  offset: number;
  limit: number;
  entities: RuntimeBoundRecords['entities'];
}

export interface RuntimeBoundRecords {
  modelId: string;
  modelVersionId: string;
  dataRevisionId: string;
  entities: {
    entityId: string;
    conceptId: string;
    label: string;
    attributes: Record<string, unknown>;
    provenance: Record<string, unknown>;
    origins?: Record<string, RuntimeValueOrigin>;
    /** Normalized matching key; key fields are not repeated among the attributes. */
    identity?: Record<string, unknown>;
  }[];
  gaps?: RuntimeRevisionGaps;
  health?: RuntimeModelHealth | null;
  relationships: {
    relationId: string;
    sourceEntityId: string;
    targetEntityId: string;
    matchingStrategy: string | null;
  }[];
  counts: { entities: number; assertions: number; relationships: number };
  /** Records per concept over the whole revision; absent from runtimes that predate it. */
  conceptCounts?: Record<string, number>;
  /** Fingerprint of the run that built this data; absent from runtimes that predate it. */
  executionFingerprint?: string | null;
  specification: {
    concepts: { conceptId: string; label: string; allowedFields: string[] }[];
    relations: { relationId: string; label: string }[];
  };
}

export interface RuntimeManualRow { conceptId: string; rowKey: string; label: string; values: Record<string, unknown> }
export interface RuntimeManualLink { relationId: string; sourceRowKey: string; targetRowKey: string }

export interface RuntimePublishedBinding {
  modelId: string;
  modelVersionId: string;
  dataRevisionId: string;
  projectionRef: string;
}

export interface RuntimeBoundGraph {
  modelId: string;
  modelVersionId: string;
  dataRevisionId: string;
  /** `degree`: the record's visible links in the whole revision, set by a window read that draws neighbours; absent otherwise. */
  nodes: { id: string; label: string; properties: Record<string, unknown>; degree?: number }[];
  edges: {
    id: string;
    label: string;
    sourceId: string;
    targetId: string;
    properties: Record<string, unknown>;
  }[];
  specification: RuntimeBoundRecords['specification'];
}

/** A bounded part of the bound graph; `totals` (visible records, links, per concept and relationship) is null for a focused read. */
export interface RuntimeGraphWindow extends RuntimeBoundGraph {
  truncated: boolean;
  nodeLimit: number;
  totals: { records: number; links: number; concepts: Record<string, number>; relations: Record<string, number> } | null;
}

export interface RuntimeGraphWindowOptions {
  dataRevisionId?: string;
  nodeLimit?: number;
  conceptId?: string;
  /** Records to read with their neighbours (or alone with `neighbours: false`) instead of the first records of the data. */
  focusIds?: string[];
  neighbours?: boolean;
  /** With `focusIds` and neighbours: links away to read (the runtime reads 1 and caps at 8 when absent). */
  depth?: number;
}

export interface RuntimeCorrectionCommand {
  actorUserId: string;
  modelId: string;
  modelVersionId: string;
  action: string;
  targetIdentity: Record<string, unknown>;
  reason?: string;
  payload?: Record<string, unknown>;
  expectedCorrectionSequence: number;
  dataRevisionId?: string | null;
}

export interface RuntimeReviewResolveCommand {
  actorUserId: string;
  modelId: string;
  resolution: Record<string, unknown>;
}

export interface RuntimeActivateRevisionCommand {
  actorUserId: string;
  modelId: string;
  modelVersionId: string;
  expectedCorrectionSequence: number;
  expectedActiveDataRevisionId?: string | null;
  environment?: string;
}

const DOCUMENT_PREVIEW_TIMEOUT_MS = 120_000;

/** Non-secret runtime-owned identity bound into previews and execution fingerprints. */
export interface AiExtractionIdentity {
  profileId: 'semantic-runtime';
  model: string;
  contractVersion: 'ai-attribute-v2';
  promptVersion: 'semantic-attributes-v1';
  maxTokens: number;
}

export interface RuntimeDocumentPreviewRequest {
  actorUserId: string;
  modelId: string;
  /** `unit`: what a row is (a sheet's row, or another concept's record for a derived source). */
  entry: { conceptId: string; conceptLabel?: string; source: Record<string, unknown>; fieldMappings: unknown[]; options?: Record<string, unknown>; unit?: 'row' | 'record' };
  aiExtraction?: AiExtractionIdentity | null;
}

/** How each extracted field was read, or why it was not. */
export interface RuntimeDocumentPreviewField {
  method: 'rules' | 'ai';
  reason: 'found' | 'label_not_found' | 'no_value' | 'several_values' | 'pattern_mismatch' | 'no_heading' | 'no_match' | 'no_page' | 'ai_not_found' | 'ai_failed';
  value?: unknown;
  values?: string[];
  page?: number | null;
  /** Last page of a passage read over several pages. */
  pageEnd?: number | null;
  quote?: string | null;
  /** The text the rule's location found, before it was cut, matched and cleaned up. */
  raw?: string;
  detail?: string;
  rules?: Omit<RuntimeDocumentPreviewField, 'rules'>;
}

export interface RuntimeDocumentPreview {
  /** `read`, or why the document could not be read at all (e.g. `index_unavailable`). */
  status: string;
  detail?: string;
  fields: Record<string, RuntimeDocumentPreviewField>;
  aiSent?: { documentCharacters: number; longDocument: boolean; blocksSent: number; charactersSent: number } | null;
  /** Several records per document: each record's values (what is shared, then its own), at most 50. */
  records?: Array<{ values: Record<string, unknown>; pages?: Record<string, number | null> }>;
  recordCount?: number;
  /** Fields found fewer times than there are records. */
  unevenFields?: string[];
}

export interface RuntimeShapedSheetRows {
  rows: Array<{
    rowNumber?: number;
    values: Record<string, unknown>;
    fields: NonNullable<ResolvedEntity['provenance']['fields']>;
    item?: number;
    itemText?: string;
  }>;
  warnings: string[];
  itemsTruncated?: boolean;
}

export interface RuntimeSheetPreviewRequest {
  modelId: string;
  entry: {
    conceptId: string;
    conceptLabel?: string;
    source: Record<string, unknown>;
    fieldMappings: unknown[];
    options?: Record<string, unknown>;
    unit?: 'row' | 'record';
  };
  rows: Array<{ rowNumber: number; values: Record<string, unknown> }>;
  aiExtraction?: AiExtractionIdentity | null;
  expand?: Record<string, unknown>;
}

export interface RuntimeSheetPreview {
  rows: Array<{
    rowNumber: number;
    fields: Record<
      string,
      Record<string, unknown> & {
        method: string;
        reason: string;
        column?: string;
        span?: { start: number; end: number };
      }
    >;
    item?: number;
    itemText?: string;
  }>;
  ai: { aiRows: number; aiCalls: number; aiSkippedRows: number; aiFailedRows: number };
  itemFields?: string[];
  itemsTruncated?: boolean;
}

export interface RuntimeDocumentLabelsRequest {
  actorUserId: string;
  sources: Record<string, unknown>[];
}

export interface RuntimeDocumentLabels {
  documentsRead: number;
  unread: { assetId: string; status: string }[];
  labels: { label: string; kind: 'heading' | 'label'; documents: number; page: number | null; example: string }[];
}

/** What a build would send, for the runtime to check without running it (`POST .../population/check`). */
export interface RuntimeModelCheckRequest {
  specification: unknown;
  sources: unknown[];
  relationBindings: unknown[];
  derivations: unknown[];
  limits?: Record<string, number>;
}

export interface RuntimeModelCheck {
  issues: ModelCheckIssue[];
  errorCount: number;
  warningCount: number;
}

export interface RuntimeComputedPreviewRequest {
  computed: unknown;
  samples: string[];
  /** Shapes each sample first (the recipe of the field this one is taken from). */
  inputRecipe?: unknown;
  /** A joined input: per sample, the value of each part by "<kind>:<name>". */
  partSamples?: Array<Record<string, string>>;
  /** Shapes a part first (a field with its own recipe), by "<kind>:<name>". */
  partRecipes?: Record<string, unknown>;
}

export interface RuntimeComputedPreview {
  results: Array<{ input: string; value: string | null; reason: 'found' | 'no_input' | 'no_match' | 'not_transformable' }>;
}

// ── Graph search (records of a bound data revision, found by meaning, then followed along real links) ──

/** Query embedding can take a few seconds; seeds and expansion get a fixed, longer deadline. */
const GRAPH_SEARCH_TIMEOUT_MS = 15_000;
/** Clearing a large model cascades through every record; the runtime is given the admin's purge time, and this much more to answer. */
const PURGE_ANSWER_MARGIN_MS = 10_000;

export type RuntimeSearchEnvironment = 'draft' | 'production';
export type RuntimeSearchIndexState = 'ready' | 'queued' | 'indexing' | 'failed' | 'missing' | 'unavailable';

export interface RuntimeRecordProvenance {
  assetId: string;
  workspaceId?: string;
  documentId?: string;
  filename?: string;
  assetVersionId?: string;
  mappingVersion?: string;
  rowNumbers?: number[];
}

export interface RuntimeGraphSearchRequest {
  actorUserId: string;
  modelId: string;
  environment: RuntimeSearchEnvironment;
  query: string;
  concepts?: string[];
  limit?: number;
  /** Workspaces whose sources the actor may read; null or absent means no filter. */
  allowedWorkspaceIds?: string[] | null;
  expectedDataRevisionId?: string;
}

export interface RuntimeGraphSearchSeed {
  entityId: string;
  conceptId: string;
  conceptLabel: string;
  label: string;
  keyFields: Record<string, unknown>;
  snippet: string;
  /** linked: found only through its link to a record the request names (see via). */
  matchClass: 'exact' | 'lexical' | 'vector' | 'hybrid' | 'linked';
  /** Where the best matches were: the record's own search text, a passage of a long field, or only its link. */
  matchedIn?: 'record' | 'passage' | 'link';
  /** The record of another concept the request names, that this record is linked to, and the links in between. */
  via?: RuntimeGraphSearchVia;
  /** Best matching passages of long fields (up to 2), quoted around the words of the query. */
  passages?: RuntimeGraphSearchPassage[];
  rank: number;
  diagnostics: Record<string, unknown>;
  provenance: RuntimeRecordProvenance[];
}

export interface RuntimeGraphSearchVia {
  entityId: string;
  /** The name the request gives it. */
  label: string;
  conceptLabel: string;
  links: number;
  /** From that record to this one: each relationship key and the way it was read. */
  path: Array<{ relation: string; direction: 'outgoing' | 'incoming' }>;
}

/** A record of another concept that the request names; the records asked for linked to it were found through it. */
export interface RuntimeGraphSearchAnchor {
  entityId: string;
  label: string;
  conceptLabel: string;
  /** Records asked for linked to it, through the fewest links (all of them, even beyond the limit). */
  linkedCount: number;
}

export interface RuntimeGraphSearchPassage {
  fieldKey: string;
  /** Readable field name. */
  field: string;
  /** Offsets of the whole passage in the field value. */
  start: number;
  end: number;
  /** About 400 characters of the passage around the match. */
  text: string;
}

export interface RuntimeGraphSearchResult {
  modelId: string;
  environment: RuntimeSearchEnvironment;
  modelVersionId: string;
  dataRevisionId: string;
  projectionRef: string;
  index: {
    indexId: string | null; state: RuntimeSearchIndexState; embeddingFingerprint: string | null;
    /** While this index is built, the last ready one was searched: of the same data, or of earlier data. */
    fallback?: { indexId: string; sameData: boolean };
  };
  modeUsed: 'hybrid' | 'lexical_only' | 'exact_only';
  status: 'found' | 'no_match' | 'not_represented' | 'index_not_ready';
  concepts: { conceptId: string; key: string; label: string }[];
  unknownConcepts: string[];
  seeds: RuntimeGraphSearchSeed[];
  anchors?: RuntimeGraphSearchAnchor[];
  /** The walk from the anchors was cut short: linked records may be missing. */
  linksTruncated?: boolean;
  hasMore?: boolean;
  hiddenRecords?: number;
  notes?: string[];
  coverage: {
    expectedCount: number; indexedCount: number; exactOnlyCount: number;
    passageCount?: number; passageIndexedCount?: number; passageTruncatedCount?: number;
  };
  timings: { embedMs: number; seedMs: number };
}

export interface RuntimeGraphExpandStep {
  /** Relation ids or keys; the second step must name them. */
  relations?: string[];
  direction?: 'outgoing' | 'incoming' | 'both';
  concepts?: string[];
}

export interface RuntimeGraphExpandRequest {
  actorUserId: string;
  modelId: string;
  environment: RuntimeSearchEnvironment;
  seedEntityIds: string[];
  steps: RuntimeGraphExpandStep[];
  maxNodes?: number;
  /** Field values to return with the records (key, label or alias; "*" for all). */
  fields?: string[];
  /** The model's labels, so relationships and fields can be named as the model names them. */
  catalog?: RuntimeRecordsCatalog;
  allowedWorkspaceIds?: string[] | null;
  expectedDataRevisionId?: string;
}

/** How many records are linked to the seeds through one relationship, one step away (exact). */
export interface RuntimeGraphLinkCount {
  relationId: string;
  relationKey: string;
  direction: 'outgoing' | 'incoming';
  conceptId: string;
  conceptLabel: string;
  count: number;
  hidden: number;
}

export interface RuntimeGraphPathStep {
  fromEntityId: string;
  relationId: string;
  relationKey: string;
  direction: 'outgoing' | 'incoming';
  toEntityId: string;
}

export interface RuntimeGraphExpandResult {
  modelId: string;
  environment: RuntimeSearchEnvironment;
  modelVersionId: string;
  dataRevisionId: string;
  projectionRef: string;
  status: 'found' | 'no_match' | 'partial';
  nodes: {
    entityId: string;
    conceptId: string;
    conceptLabel: string;
    label: string;
    keyFields: Record<string, unknown>;
    inclusionReason: 'seed' | 'relationship';
    path: RuntimeGraphPathStep[];
    provenance: RuntimeRecordProvenance[];
    values?: Record<string, unknown>;
    truncatedFields?: string[];
  }[];
  edges: Array<{
    relationId: string;
    relationKey: string;
    sourceEntityId: string;
    targetEntityId: string;
  }>;
  linkCounts?: RuntimeGraphLinkCount[];
  unknownFields?: string[];
  graphLayout?: 'typed' | 'entity';
  hiddenSeeds: number;
  truncated: boolean;
  timings: { expandMs: number };
}

export interface RuntimeGraphSearchIndex {
  indexId: string | null;
  state: RuntimeSearchIndexState;
  expectedCount: number;
  indexedCount: number;
  exactOnlyCount: number;
  failedCount: number;
  reusedCount: number;
  embeddingCalls: number;
  passageCount?: number;
  passageIndexedCount?: number;
  passageTruncatedCount?: number;
  /** While the state is 'indexing': 'comparing' (finding the records changed since the previous index) and 'carrying' (copying the unchanged ones) of an incremental build, then 'documents' (records being read into cards), 'reusing' (vectors taken from the cache) or 'embedding'; null otherwise. */
  stage?: 'comparing' | 'carrying' | 'documents' | 'reusing' | 'embedding' | null;
  /** Records handled so far by the first three steps (compared, carried over, or with their card written; counts of the other fields are live too). */
  loadedCount?: number;
  /** 'incremental': the records unchanged since the previous index were carried over from it; 'full': every card was built (see buildReason). Absent before the build starts. */
  buildMode?: 'full' | 'incremental' | null;
  /** Why a build is full: no_previous_generation, previous_not_comparable, specification_changed, too_many_changes or empty_revision. */
  buildReason?: string | null;
  carriedCount?: number;
  rebuiltCount?: number;
  /** Records whose vector the embedding model computed (not carried over, not taken from the cache). */
  embeddedCount?: number;
  /** The build's worker stopped answering (its lease ran out, or no progress for a long while): what was embedded is kept and the build can be restarted. */
  stalled?: boolean;
  /** When the build last made progress (ISO); null before its first step. */
  lastProgressAt?: string | null;
  lastErrorCode: string | null;
  completedAt: string | null;
  embeddingFingerprint: string | null;
}

export interface RuntimeGraphSearchIndexStatus {
  modelId: string;
  environment: RuntimeSearchEnvironment;
  dataRevisionId: string;
  index: RuntimeGraphSearchIndex;
}

export interface RuntimeRecordsFilter { field: string; op: string; value?: unknown; as?: string }
/** step (traverse only): group on the records of that point of the walk, 0 being its start. */
export interface RuntimeRecordsGroupBy { field: string; bucket?: string; as?: string; step?: number }
export interface RuntimeRecordsAggregate { op: string; field?: string; as?: string }
export interface RuntimeRecordsOrderBy { field: string; direction?: 'asc' | 'desc'; as?: string }

/** The model's names and types for the fields a query may name (the runtime's specification has keys only). */
export interface RuntimeRecordsCatalog {
  concepts: { key: string; label: string; aliases: string[]; fields: { key: string; label: string; type: string; aliases: string[] }[] }[];
  relations: { key: string; label: string; inverseLabel: string }[];
}

export interface RuntimeRecordsQueryRequest {
  actorUserId: string;
  modelId: string;
  environment: RuntimeSearchEnvironment;
  allowedWorkspaceIds?: string[] | null;
  concept: string;
  filters?: RuntimeRecordsFilter[];
  match?: 'all' | 'any';
  groupBy?: RuntimeRecordsGroupBy[];
  aggregates?: RuntimeRecordsAggregate[];
  orderBy?: RuntimeRecordsOrderBy[];
  fields?: string[];
  linkedTo?: Array<{ relation: string; recordIds: string[] }>;
  limit?: number;
  offset?: number;
  catalog: RuntimeRecordsCatalog;
}

/** One wrong part of a records query, named so the assistant can correct it. */
export interface RuntimeRecordsQueryError {
  code: 'invalid_query';
  part: string;
  reason: string;
  message: string;
  value?: unknown;
  available?: string[];
}

export interface RuntimeQueriedRecord {
  entityId: string;
  name: string;
  keyFields: Record<string, unknown>;
  values: Record<string, unknown>;
  provenance?: RuntimeRecordProvenance[];
  truncated?: boolean;
  truncatedFields?: string[];
}

export interface RuntimeRecordsAppliedQuery {
  concept?: unknown;
  timezone?: string;
  now?: string;
  match?: string;
  filters?: (Record<string, unknown> & { field?: string | null; fieldLabel?: string; type?: string })[];
  groupBy?: { name: string; field: string; label: string; type: string; bucket?: string }[];
  aggregates?: { name: string; op: string; field?: string; label?: string }[];
  orderBy?: { by: string; direction: string }[];
  fields?: { key: string; label: string }[];
  limit?: number;
  offset?: number;
}

export interface RuntimeRecordsDiagnostics {
  readableRecords: number;
  checks: Array<{ part: string; field: string; op: string; matches: number; didYouMean?: string[] }>;
  /** traverse only: how many start records match on their own, and why none did. */
  startRecords?: number;
  start?: RuntimeRecordsDiagnostics;
}

export interface RuntimeRecordsQueryResult {
  modelId: string;
  environment: RuntimeSearchEnvironment;
  modelVersionId: string;
  dataRevisionId: string;
  status: 'ok' | 'invalid_query' | 'not_represented';
  errors?: RuntimeRecordsQueryError[];
  appliedQuery: RuntimeRecordsAppliedQuery;
  concept?: { conceptId: string; key: string; label: string };
  total?: number;
  hiddenRecords?: number;
  unparsable?: Record<string, number>;
  records?: RuntimeQueriedRecord[];
  returned?: number;
  offset?: number;
  nextOffset?: number | null;
  pageCutShort?: boolean;
  /** Only when nothing matched: the readable records, and how many each filter or link keeps alone. */
  diagnostics?: RuntimeRecordsDiagnostics;
  buckets?: Record<string, unknown>[];
  bucketsTruncated?: boolean;
  /** Grouped on linked records: a record counts in the group of each record it is linked to. */
  groupsOverlap?: boolean;
  aggregates?: Record<string, unknown>;
}

/** A walk: start records, then relationships step by step, each with conditions on the records it reaches. */
export interface RuntimeTraverseStep {
  relation: string;
  direction?: 'outgoing' | 'incoming';
  minHops?: number;
  maxHops?: number;
  filters?: RuntimeRecordsFilter[];
  match?: 'all' | 'any';
}

export interface RuntimeTraverseRequest {
  actorUserId: string;
  modelId: string;
  environment: RuntimeSearchEnvironment;
  allowedWorkspaceIds?: string[] | null;
  start: { concept: string; recordIds?: string[]; filters?: RuntimeRecordsFilter[]; match?: 'all' | 'any' };
  steps: RuntimeTraverseStep[];
  groupBy?: RuntimeRecordsGroupBy[];
  aggregates?: RuntimeRecordsAggregate[];
  orderBy?: RuntimeRecordsOrderBy[];
  fields?: string[];
  limit?: number;
  offset?: number;
  catalog: RuntimeRecordsCatalog;
}

export interface RuntimeConnectRequest {
  actorUserId: string;
  modelId: string;
  environment: RuntimeSearchEnvironment;
  allowedWorkspaceIds?: string[] | null;
  fromEntityId: string;
  toEntityId: string;
  maxLinks?: number;
  maxPaths?: number;
  relations?: string[];
  catalog: RuntimeRecordsCatalog;
}

export interface RuntimeConnectResult {
  modelId: string;
  environment: RuntimeSearchEnvironment;
  modelVersionId: string;
  dataRevisionId: string;
  status: 'connected' | 'not_connected' | 'not_found' | 'same_record';
  links?: number;
  maxLinks: number;
  searchedLinks: number;
  paths: Array<{
    records: string[];
    steps: Array<{ fromEntityId: string; relationId: string; relationKey: string; direction: 'outgoing' | 'incoming'; toEntityId: string }>;
  }>;
  records: Array<{
    entityId: string; conceptId: string; conceptLabel: string; label: string; keyFields: Record<string, unknown>;
    provenance?: RuntimeRecordProvenance[];
  }>;
  unknownRecords?: string[];
  morePaths?: boolean;
  /** The search stopped at a limit: a chain may exist that it did not reach. */
  truncated: boolean;
  graphLayout?: 'typed' | 'entity';
}

/** One record an answer cited, read again from the data in use (changed: the data was rebuilt since). */
export interface RuntimeCitedRecord {
  modelId: string;
  environment: RuntimeSearchEnvironment;
  modelVersionId: string;
  dataRevisionId: string;
  changed: boolean;
  status: 'ok' | 'hidden' | 'missing';
  record?: {
    entityId: string;
    conceptId: string;
    conceptKey: string;
    conceptLabel: string;
    label: string;
    keyFields: Record<string, unknown>;
    provenance: RuntimeRecordProvenance[];
    values: Record<string, unknown>;
    truncatedFields: string[];
    origins: Record<string, RuntimeValueOrigin>;
    /** What other sources stated for a field than the value in ``values``. */
    alternatives?: Record<string, Array<{ value: unknown; origin: RuntimeValueOrigin }>>;
  };
}

export interface RuntimeRecordsOverview {
  modelId: string;
  environment: RuntimeSearchEnvironment;
  modelVersionId: string;
  dataRevisionId: string;
  concepts: { conceptId: string; key: string; label: string; keyFields: string[]; fields: string[]; recordCount: number; hiddenRecords: number }[];
  relations: { relationId: string; key: string; from: string; to: string; cardinality: string | null }[];
}

/** Why the runtime refused a search request (422), said in words a person or an agent can act on. */
const GRAPH_SEARCH_REJECTIONS: Record<string, string> = {
  unknown_relation: 'One of the relationships named is not in this model',
  unknown_concept: 'One of the concepts named is not in this model',
  relations_required_for_second_step: 'The second step must name the relationships to follow',
  invalid_query: 'This search request is not valid',
  query_too_slow: 'This query took too long: add filters, or group by fewer or coarser values',
};

/** The graph one environment serves, what it holds compared with the stored data, and its search index. */
export interface RuntimeServedGraph {
  environment: 'draft' | 'production';
  dataRevisionId: string;
  modelVersionId: string;
  projectionRef: string;
  /** The graph's schema in the graph database; null when the data has no graph. */
  graphSchema: string | null;
  layout: 'typed' | 'entity';
  builtAt: string | null;
  stored: { records: number; links: number };
  graph: { vertices: number; edges: number; conceptLabels: number; relationLabels: number } | null;
  /** ok: the graph holds every stored record and link; mismatch: it does not; missing: no graph could be read. */
  state: 'ok' | 'mismatch' | 'missing';
  index: { state: string; expectedCount?: number; indexedCount?: number; completedAt?: string | null };
}

export interface RuntimeGraphStatus {
  modelId: string;
  environments: RuntimeServedGraph[];
}

/** The graphs rebuilt from a model's stored records and links, one per data revision it serves. */
export interface RuntimeReprojectedGraphs {
  modelId: string;
  revisions: Array<{ revisionId: string; projectionRef: string; reprojected: boolean; vertices?: number; edges?: number }>;
}

export interface RuntimePurgedData {
  modelId: string;
  resetGeneration: number;
  revisions: number;
  keptRevisions: number;
  reviewItems: number;
  jobs: number;
  documentReadings: number;
  projectionsDropped: number;
}

@Injectable()
export class SemanticRuntimeClientService {
  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
  ) { }

  async getAiExtractionIdentity(): Promise<AiExtractionIdentity> {
    const base = this.requireRuntime();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/ai-extraction/profile`, {
        method: 'GET',
        headers: { 'X-Semantic-Service-Key': this.config.runtimeServiceKey },
        signal: AbortSignal.timeout(this.config.runtimeRequestTimeoutMs),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (!res.ok) throw new ServiceUnavailableException(
      ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'The semantic runtime AI extraction profile is unavailable',
    );
    let identity: Partial<AiExtractionIdentity> | null;
    try {
      identity = await res.json() as Partial<AiExtractionIdentity> | null;
    } catch {
      identity = null;
    }
    if (!identity || identity.profileId !== 'semantic-runtime' || typeof identity.model !== 'string' || !identity.model.trim()
      || identity.contractVersion !== 'ai-attribute-v2' || identity.promptVersion !== 'semantic-attributes-v1'
      || !Number.isSafeInteger(identity.maxTokens) || (identity.maxTokens ?? 0) <= 0) {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'The semantic runtime AI extraction profile is invalid');
    }
    // Only project the agreed identity, never credentials or unrelated configuration.
    return { profileId: identity.profileId, model: identity.model, contractVersion: identity.contractVersion,
      promptVersion: identity.promptVersion, maxTokens: identity.maxTokens! };
  }

  private requireRuntime(): string {
    if (!this.config.runtimeEnabled || !this.config.runtimeUrl || !this.config.runtimeServiceKey) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic runtime is not configured',
      );
    }
    return this.config.runtimeUrl.replace(/\/+$/, '');
  }

  private requireWrites(): string {
    if (!this.config.runtimeWritesEnabled) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic runtime writes are disabled',
      );
    }
    return this.requireRuntime();
  }

  private async post<T>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    timeoutMs = this.config.runtimeRequestTimeoutMs,
  ): Promise<T> {
    const base = this.requireWrites();
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Semantic-Service-Key': this.config.runtimeServiceKey,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), {
          status: res.status,
          data: await this.readErrorPayload(res),
        });
      }
      return await res.json() as T;
    } catch (error) {
      throw this.translate(error);
    }
  }

  /**
   * Read one document's extracted fields as a run would, without storing anything. AI reading can
   * take a while, so this waits longer than other calls; a rule the runtime rejects comes back as
   * a validation error that names the problem.
   */
  async suggestDocumentLabels(body: RuntimeDocumentLabelsRequest): Promise<RuntimeDocumentLabels> {
    const base = this.requireRuntime();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/document-labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Semantic-Service-Key': this.config.runtimeServiceKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DOCUMENT_PREVIEW_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, `Semantic runtime could not read the document labels (${res.status})`);
    }
    return await res.json() as RuntimeDocumentLabels;
  }

  async previewDocumentFields(body: RuntimeDocumentPreviewRequest): Promise<RuntimeDocumentPreview> {
    const base = this.requireRuntime();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/document-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Semantic-Service-Key': this.config.runtimeServiceKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DOCUMENT_PREVIEW_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (res.status === 422) {
      const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail || 'These reading rules cannot be used');
    }
    if (!res.ok) throw await this.failure(res);
    return await res.json() as RuntimeDocumentPreview;
  }

  /** Read a few sheet rows' fields as a run would; AI can take a while, so this waits as long as a document preview. */
  async previewSheetFields(body: RuntimeSheetPreviewRequest): Promise<RuntimeSheetPreview> {
    const base = this.requireRuntime();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/cell-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Semantic-Service-Key': this.config.runtimeServiceKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DOCUMENT_PREVIEW_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (res.status === 422) {
      const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail || 'These reading rules cannot be used');
    }
    if (!res.ok) throw await this.failure(res);
    return await res.json() as RuntimeSheetPreview;
  }

  /** A sheet's sample rows with its fields read as a run reads them (no AI), for the data preview. */
  async shapeSheetRows(body: { rows: Record<string, unknown>[]; fieldMappings: unknown[]; expand?: Record<string, unknown> }): Promise<RuntimeShapedSheetRows> {
    const base = this.requireRuntime();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/sheet-rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Semantic-Service-Key': this.config.runtimeServiceKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.runtimeRequestTimeoutMs),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (res.status === 422) {
      const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail || 'This mapping cannot be previewed');
    }
    if (!res.ok) throw await this.failure(res);
    return await res.json() as RuntimeShapedSheetRows;
  }

  /** Every problem the runtime would stop a build of this plan on, listed at once. Reads and stores nothing. */
  async checkModelPlan(body: RuntimeModelCheckRequest): Promise<RuntimeModelCheck> {
    const base = this.requireRuntime();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Semantic-Service-Key': this.config.runtimeServiceKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.runtimeRequestTimeoutMs),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (!res.ok) throw await this.failure(res);
    return await res.json() as RuntimeModelCheck;
  }

  async previewComputedField(body: RuntimeComputedPreviewRequest): Promise<RuntimeComputedPreview> {
    const base = this.requireRuntime();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/computed-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Semantic-Service-Key': this.config.runtimeServiceKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.runtimeRequestTimeoutMs),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (res.status === 422) {
      const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail || 'This computation cannot be used');
    }
    if (!res.ok) throw await this.failure(res);
    return await res.json() as RuntimeComputedPreview;
  }

  private async get<T>(path: string, actorUserId: string): Promise<T> {
    const base = this.requireRuntime();
    try {
      const res = await fetch(`${base}${path}`, {
        headers: {
          'X-Semantic-Service-Key': this.config.runtimeServiceKey,
          'X-Actor-User-Id': actorUserId,
        },
        signal: AbortSignal.timeout(this.config.runtimeRequestTimeoutMs),
      });
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), {
          status: res.status,
          data: await this.readErrorPayload(res),
        });
      }
      return await res.json() as T;
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** A read that is too wide for a query string: POST on the read base, same auth and error mapping as `get`. */
  private async readPost<T>(path: string, actorUserId: string, body: unknown): Promise<T> {
    const base = this.requireRuntime();
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Semantic-Service-Key': this.config.runtimeServiceKey,
          'X-Actor-User-Id': actorUserId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.runtimeRequestTimeoutMs),
      });
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), {
          status: res.status,
          data: await this.readErrorPayload(res),
        });
      }
      return await res.json() as T;
    } catch (error) {
      throw this.translate(error);
    }
  }

  private async readErrorPayload(res: Response): Promise<unknown> {
    const text = await res.text().catch(() => '');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private errorDetail(error: unknown): string {
    return runtimeErrorMessage((error as { data?: unknown }).data, 'The semantic runtime could not do this');
  }

  /**
   * A runtime failure as the error a person sees: a refusal (400/422) says why, a missing thing is
   * not found, a conflict is a conflict, and a runtime that never answered says so.
   */
  private translate(error: unknown): Error {
    const status = (error as { status?: unknown }).status;
    if (typeof status !== 'number') {
      return new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, runtimeUnreachableMessage(error));
    }
    const detail = this.errorDetail(error);
    if (status === 409) return new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, detail);
    if (status === 404) return new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, detail);
    if (status === 400 || status === 422) return new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail);
    return new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
      runtimeErrorMessage((error as { data?: unknown }).data, `The semantic runtime failed (HTTP ${status}). Try again in a moment.`));
  }

  /** An answer that is not ok, read and translated. */
  private async failure(res: Response): Promise<Error> {
    return this.translate({ status: res.status, data: await this.readErrorPayload(res) });
  }

  async requestPopulationRun(
    command: RuntimePopulationRunCommand,
    idempotencyKey: string,
  ): Promise<RuntimeAcceptedJob> {
    return this.post<RuntimeAcceptedJob>('/v1/semantic-model-population/runs', command, {
      'Idempotency-Key': idempotencyKey,
    });
  }

  /** Clear a model's built data (records, links, review items, finished builds); its settings stay. */
  async purgeModelData(modelId: string, actorUserId: string, options: { forgetDocumentReading: boolean; timeoutSeconds: number }): Promise<RuntimePurgedData> {
    return this.post<RuntimePurgedData>(`/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/purge`, options, {
      'X-Actor-User-Id': actorUserId,
    }, options.timeoutSeconds * 1000 + PURGE_ANSWER_MARGIN_MS);
  }

  /**
   * Delete everything the runtime holds for a model (data, review items, search index, jobs,
   * specifications, graphs). Idempotent. A job still running for the model comes back as a 409.
   * Returns false when no runtime is configured at all: then it holds nothing for the model.
   */
  async deleteModel(modelId: string, actorUserId: string): Promise<boolean> {
    if (!this.config.runtimeEnabled) return false;
    const base = this.requireWrites();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/models/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
        headers: { 'X-Semantic-Service-Key': this.config.runtimeServiceKey, 'X-Actor-User-Id': actorUserId },
        signal: AbortSignal.timeout(this.config.runtimeRequestTimeoutMs),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (res.ok) return true;
    if (res.status === 409) {
      throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT,
        'A build or index job is still running for this model. Wait for it to finish or cancel it, then delete again.');
    }
    throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
      'The model data could not be deleted from the semantic runtime; nothing was deleted, try again.');
  }

  /**
   * Copy the source model's draft data into a fresh clone (ids remapped by the caller). The
   * runtime projects the graph and requests the search index. A job running on the source comes
   * back as a 409. Returns null when no runtime is configured. Copies can be large, so the
   * deadline is longer than for ordinary calls.
   */
  async cloneModelData(sourceModelId: string, command: RuntimeCloneDataCommand, actorUserId: string): Promise<RuntimeClonedData | null> {
    if (!this.config.runtimeEnabled) return null;
    const base = this.requireWrites();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/models/${encodeURIComponent(sourceModelId)}/clone-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Semantic-Service-Key': this.config.runtimeServiceKey,
          'X-Actor-User-Id': actorUserId,
        },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(Math.max(this.config.runtimeRequestTimeoutMs, 300_000)),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (res.ok) return await res.json() as RuntimeClonedData;
    if (res.status === 409) {
      throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT,
        'A build or index job is running on this model. Wait for it to finish, then copy it again with its data.');
    }
    throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'The model data could not be copied.');
  }

  /** Forget the model's earlier AI readings of documents (one concept's when given), so the next run reads them again. Refused (409) while a run goes on. */
  async forgetDocumentReadings(modelId: string, actorUserId: string, conceptId?: string): Promise<{ modelId: string; documentReadings: number }> {
    try {
      return await this.post<{ modelId: string; documentReadings: number }>(
        `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/forget-readings`,
        conceptId ? { conceptId } : {}, { 'X-Actor-User-Id': actorUserId });
    } catch (error) {
      if (error instanceof ConflictException || (error as { status?: number }).status === 409) {
        throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT,
          'A data update is running on this model. Wait for it to finish, then start again.');
      }
      throw error;
    }
  }

  async getGraphStatus(modelId: string, actorUserId: string): Promise<RuntimeGraphStatus> {
    return this.get<RuntimeGraphStatus>(`/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/graph-status`, actorUserId);
  }

  /**
   * Rebuild the graphs of the data a model serves from its stored records and links: no source is
   * read again and no record changes. Large graphs take a while, so the deadline is longer.
   */
  async reprojectModelGraphs(modelId: string, actorUserId: string, graphExposure?: GraphExposure): Promise<RuntimeReprojectedGraphs> {
    const base = this.requireWrites();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/reproject`, {
        method: 'POST',
        headers: {
          'X-Semantic-Service-Key': this.config.runtimeServiceKey,
          'X-Actor-User-Id': actorUserId,
          ...(graphExposure ? { 'Content-Type': 'application/json' } : {}),
        },
        // The fields each concept shows in the rebuilt graphs; without it they keep the ones they have.
        ...(graphExposure ? { body: JSON.stringify({ graphExposure }) } : {}),
        signal: AbortSignal.timeout(Math.max(this.config.runtimeRequestTimeoutMs, 300_000)),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (res.ok) return await res.json() as RuntimeReprojectedGraphs;
    if (res.status === 409) {
      throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT,
        'A data update is running on this model. Wait for it to finish, then rebuild the graph again.');
    }
    throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'The graph could not be rebuilt; the data in use is unchanged.');
  }

  async requestDatasourceDiscovery(
    command: RuntimeDiscoveryCommand,
    idempotencyKey: string,
  ): Promise<RuntimeAcceptedJob> {
    return this.post<RuntimeAcceptedJob>('/v1/semantic-model-datasource/discoveries', command, {
      'Idempotency-Key': idempotencyKey,
    });
  }

  async getJob(jobId: string, actorUserId: string): Promise<RuntimeJob> {
    return this.get<RuntimeJob>(
      `/v1/semantic-model-jobs/${encodeURIComponent(jobId)}`,
      actorUserId,
    );
  }

  /** The actor's latest runs for the model, newest first. */
  async listJobs(modelId: string, actorUserId: string, limit = 20, jobType = 'population.run'): Promise<RuntimeJob[]> {
    const params = new URLSearchParams({ modelId, jobType, limit: String(limit) });
    const { items } = await this.get<{ items: RuntimeJob[] }>(`/v1/semantic-model-jobs?${params}`, actorUserId);
    return items;
  }

  async listMyJobs(actorUserId: string, modelIds: string[], query: { view: 'active' | 'history'; page: number; limit: number }): Promise<RuntimeMyJobsPage> {
    return this.readPost<RuntimeMyJobsPage>('/v1/semantic-model-jobs/read', actorUserId, { modelIds, ...query });
  }

  async cancelMyQueuedJobs(actorUserId: string, modelIds: string[]): Promise<{ cancelled: number; skipped: number }> {
    return this.post('/v1/semantic-model-jobs/cancel-queued', { modelIds }, { 'X-Actor-User-Id': actorUserId });
  }

  /** The actor's run for the model that has not ended yet, if any. */
  async getActiveJob(modelId: string, actorUserId: string, jobType = 'population.run'): Promise<RuntimeJob | null> {
    const params = new URLSearchParams({ modelId, jobType });
    const { job } = await this.get<{ job: RuntimeJob | null }>(`/v1/semantic-model-jobs/active?${params}`, actorUserId);
    return job;
  }

  /** Stop a job: one not started yet ends at once, a running one stops at its next step. */
  async cancelJob(jobId: string, actorUserId: string, onlyQueued = false): Promise<RuntimeJob> {
    return this.post<RuntimeJob>(`/v1/semantic-model-jobs/${encodeURIComponent(jobId)}/cancel${onlyQueued ? '?onlyQueued=true' : ''}`, {}, {
      'X-Actor-User-Id': actorUserId,
    });
  }

  /** Empty means "only source-free records" and is fine; nothing at all is a caller bug, never all workspaces. */
  private requireScope(allowedWorkspaceIds: string[] | null | undefined): string[] {
    if (!Array.isArray(allowedWorkspaceIds)) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'A workspace scope is required to read semantic data');
    }
    return allowedWorkspaceIds;
  }

  async searchConceptRecords(modelId: string, conceptId: string, actorUserId: string,
    allowedWorkspaceIds: string[],
    query: { q?: string; limit: number; offset: number; dataRevisionId?: string; filters?: string }): Promise<RuntimeConceptRecordsPage> {
    return this.readPost<RuntimeConceptRecordsPage>(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/concepts/${encodeURIComponent(conceptId)}/records/read`,
      actorUserId,
      {
        actorUserId,
        environment: 'draft',
        allowedWorkspaceIds: this.requireScope(allowedWorkspaceIds),
        ...(query.q ? { q: query.q } : {}),
        limit: query.limit,
        offset: query.offset,
        ...(query.dataRevisionId ? { dataRevisionId: query.dataRevisionId } : {}),
        ...(query.filters ? { filters: this.parseRecordFilters(query.filters) } : {}),
      },
    );
  }

  async getBoundRecords(modelId: string, actorUserId: string, limit: number, allowedWorkspaceIds: string[],
    conceptId?: string, dataRevisionId?: string): Promise<RuntimeBoundRecords> {
    return this.readPost<RuntimeBoundRecords>(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/records/read`,
      actorUserId,
      {
        actorUserId,
        environment: 'draft',
        allowedWorkspaceIds: this.requireScope(allowedWorkspaceIds),
        limit,
        ...(conceptId ? { conceptId } : {}),
        ...(dataRevisionId ? { dataRevisionId } : {}),
      },
    );
  }

  async getBoundGraph(modelId: string, actorUserId: string, dataRevisionId: string | undefined,
    allowedWorkspaceIds: string[]): Promise<RuntimeBoundGraph> {
    return this.readPost<RuntimeBoundGraph>(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/graph/read`,
      actorUserId,
      {
        actorUserId,
        environment: 'draft',
        allowedWorkspaceIds: this.requireScope(allowedWorkspaceIds),
        ...(dataRevisionId ? { dataRevisionId } : {}),
      },
    );
  }

  /** A bounded, workspace-scoped part of the graph: what the graph view draws, never the whole of a large graph. */
  async getBoundGraphWindow(modelId: string, actorUserId: string, allowedWorkspaceIds: string[],
    options: RuntimeGraphWindowOptions = {}): Promise<RuntimeGraphWindow> {
    return this.readPost<RuntimeGraphWindow>(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/graph/window`,
      actorUserId,
      {
        actorUserId,
        environment: 'draft',
        allowedWorkspaceIds: this.requireScope(allowedWorkspaceIds),
        ...(options.dataRevisionId ? { dataRevisionId: options.dataRevisionId } : {}),
        ...(options.nodeLimit ? { nodeLimit: options.nodeLimit } : {}),
        ...(options.conceptId ? { conceptId: options.conceptId } : {}),
        ...(options.focusIds?.length ? { focusIds: options.focusIds } : {}),
        ...(options.neighbours === false ? { neighbours: false } : {}),
        ...(options.depth && options.depth > 1 ? { depth: options.depth } : {}),
      },
    );
  }

  /** Per-field record filters travel as a JSON object; invalid ones are refused here. */
  private parseRecordFilters(raw: string): Record<string, string> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.length <= 8000 ? raw : '');
    } catch {
      parsed = undefined;
    }
    const entries = Object.entries(parsed ?? {});
    if (!(parsed instanceof Object) || Array.isArray(parsed) || entries.length > 30
      || entries.some(([key, value]) => !key || key.length > 200 || typeof value !== 'string' || value.length > 200)) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'These record filters cannot be used');
    }
    return Object.fromEntries(entries.filter(([, value]) => value.trim().length > 0));
  }

  async mirrorSpecification(command: {
    homeWorkspaceId: string;
    modelId: string;
    modelVersionId: string;
    specHash: string;
    specification: Record<string, unknown>;
  }): Promise<{ modelId: string; modelVersionId: string; specHash: string; reused: boolean }> {
    return this.post('/v1/semantic-model-population/specifications', command);
  }

  async recordCorrection(
    command: RuntimeCorrectionCommand,
  ): Promise<{ sequence: number; modelId: string; state: string }> {
    return this.post('/v1/semantic-model-population/corrections', command);
  }

  async getDataSummary(modelId: string, actorUserId: string): Promise<RuntimeDataSummary> {
    return this.get(`/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/data-summary`, actorUserId);
  }

  async listCorrections(
    modelId: string,
    actorUserId: string,
  ): Promise<{ modelId: string; correctionSequence: number; corrections: RuntimeCorrection[] }> {
    return this.get(`/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/corrections`, actorUserId);
  }

  async resolveReview(
    reviewId: string,
    command: RuntimeReviewResolveCommand,
  ): Promise<{ reviewId: string; state: string; reused: boolean }> {
    return this.post(
      `/v1/semantic-model-population/reviews/${encodeURIComponent(reviewId)}/resolve`,
      command,
    );
  }

  async projectRevision(
    revisionId: string,
  ): Promise<{ revisionId: string; projectionRef: string; reused: boolean }> {
    return this.post(
      `/v1/semantic-model-population/revisions/${encodeURIComponent(revisionId)}/project`,
      {},
    );
  }

  async activateRevision(
    revisionId: string,
    command: RuntimeActivateRevisionCommand,
  ): Promise<{ modelId: string; environment: string; active: unknown }> {
    return this.post(
      `/v1/semantic-model-population/revisions/${encodeURIComponent(revisionId)}/activate`,
      command,
    );
  }

  /** Serves the draft data revision in production for a newly published model version. */
  async publishModelData(
    modelId: string,
    command: { actorUserId: string; modelVersionId: string },
  ): Promise<{ modelId: string; environment: string; reused: boolean }> {
    return this.post(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/publish`,
      command,
    );
  }

  async getPublishedBinding(modelId: string, actorUserId: string): Promise<RuntimePublishedBinding> {
    return this.get<RuntimePublishedBinding>(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/published`,
      actorUserId,
    );
  }

  async appendManualRows(modelId: string, snapshotId: string, batch: { rows: RuntimeManualRow[]; links: RuntimeManualLink[] }): Promise<void> {
    await this.post(
      `/v1/semantic-model-population/manual-sources/${encodeURIComponent(modelId)}/snapshots/${encodeURIComponent(snapshotId)}/rows`,
      batch,
    );
  }

  /** Records whose fields match a query, by exact key, words and meaning, in the data bound to one environment. */
  async graphSearch(body: RuntimeGraphSearchRequest): Promise<RuntimeGraphSearchResult> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/query', body.actorUserId, body, GRAPH_SEARCH_TIMEOUT_MS);
  }

  /** The records linked to some records along real relationships, one or two steps away. */
  async graphExpand(body: RuntimeGraphExpandRequest): Promise<RuntimeGraphExpandResult> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/expand', body.actorUserId, body, GRAPH_SEARCH_TIMEOUT_MS);
  }

  /** Filters, counts, groups and lists the records of one concept in the data bound to one environment. */
  async recordsQuery(body: RuntimeRecordsQueryRequest): Promise<RuntimeRecordsQueryResult> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/records-query', body.actorUserId, body, GRAPH_SEARCH_TIMEOUT_MS);
  }

  /** A walk from start records along the stored links, with conditions at each step: the records it reaches, counted, grouped or listed. */
  async traverseRecords(body: RuntimeTraverseRequest): Promise<RuntimeRecordsQueryResult> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/traverse', body.actorUserId, body, GRAPH_SEARCH_TIMEOUT_MS);
  }

  /** The shortest chains of links between two records. */
  async connectRecords(body: RuntimeConnectRequest): Promise<RuntimeConnectResult> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/connect', body.actorUserId, body, GRAPH_SEARCH_TIMEOUT_MS);
  }

  /** One record an answer cited: its values, where each came from, and the files it was read from. */
  async citedRecord(body: { actorUserId: string; modelId: string; environment: RuntimeSearchEnvironment; allowedWorkspaceIds?: string[] | null;
    entityId: string; expectedDataRevisionId?: string }): Promise<RuntimeCitedRecord> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/record', body.actorUserId, body, GRAPH_SEARCH_TIMEOUT_MS);
  }

  /** The concepts and relations of the bound data, with the number of records the actor may see. */
  async recordsOverview(body: { actorUserId: string; modelId: string; environment: RuntimeSearchEnvironment; allowedWorkspaceIds?: string[] | null }):
    Promise<RuntimeRecordsOverview> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/records-overview', body.actorUserId, body, GRAPH_SEARCH_TIMEOUT_MS);
  }

  /** Builds (or reuses) the search index of the data bound to one environment, in the background. */
  async ensureGraphSearchIndex(body: { actorUserId: string; modelId: string; environment: RuntimeSearchEnvironment }):
    Promise<RuntimeGraphSearchIndexStatus & { jobId: string | null }> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/indexes', body.actorUserId, body, undefined, true);
  }

  /**
   * Stops the build of the search index of one environment (queued or indexing). A build that is not
   * running ends at once; a running one ends at its next batch. `stopped` is false when nothing was building.
   */
  async stopGraphSearchIndex(body: { actorUserId: string; modelId: string; environment: RuntimeSearchEnvironment }):
    Promise<RuntimeGraphSearchIndexStatus & { stopped: boolean; jobId?: string | null }> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/indexes/stop', body.actorUserId, body, undefined, true);
  }

  /**
   * Stops the build (a stalled one ends at once) and starts a new one that reuses what is already embedded.
   * `restarted` is false when a live worker was only asked to stop: the person asks again once it has.
   */
  async restartGraphSearchIndex(body: { actorUserId: string; modelId: string; environment: RuntimeSearchEnvironment }):
    Promise<RuntimeGraphSearchIndexStatus & { restarted: boolean; jobId: string | null }> {
    return this.graphSearchCall('POST', '/v1/semantic-model-search/indexes/restart', body.actorUserId, body, undefined, true);
  }

  async getGraphSearchIndex(modelId: string, environment: RuntimeSearchEnvironment, actorUserId: string): Promise<RuntimeGraphSearchIndexStatus> {
    const params = new URLSearchParams({ environment });
    return this.graphSearchCall('GET', `/v1/semantic-model-search/models/${encodeURIComponent(modelId)}/index?${params}`, actorUserId);
  }

  /**
   * Search calls are reads (except building the index), so they work while runtime writes are off. A
   * refused request (422) comes back as a validation error naming the problem; 404 and 409 map as for the
   * other calls; anything else means the runtime cannot answer now.
   */
  private async graphSearchCall<T>(method: 'GET' | 'POST', path: string, actorUserId: string, body?: unknown,
    timeoutMs = this.config.runtimeRequestTimeoutMs, writes = false): Promise<T> {
    const base = writes ? this.requireWrites() : this.requireRuntime();
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          'X-Semantic-Service-Key': this.config.runtimeServiceKey,
          'X-Actor-User-Id': actorUserId,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw this.translate(error);
    }
    if (res.ok) {
      try {
        return await res.json() as T;
      } catch {
        throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'The semantic runtime sent an answer that could not be read.');
      }
    }
    const data = await this.readErrorPayload(res);
    if (res.status === 422 || res.status === 400) {
      const raw = (data as { detail?: unknown } | null)?.detail;
      const code = typeof raw === 'string' ? raw.split(/[:\s]/)[0] : '';
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        GRAPH_SEARCH_REJECTIONS[code] ?? GRAPH_SEARCH_REJECTIONS.invalid_query);
    }
    throw this.translate({ status: res.status, data });
  }

  async commitManualSnapshot(modelId: string, snapshotId: string, counts: { rowCount: number; linkCount: number }): Promise<{ reused: boolean }> {
    return this.post(
      `/v1/semantic-model-population/manual-sources/${encodeURIComponent(modelId)}/snapshots/${encodeURIComponent(snapshotId)}/commit`,
      counts,
    );
  }
}
