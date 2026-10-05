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
import type { ResolvedEntity } from '../domain/semantic-source-mapping.types';

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

export interface RuntimeJob {
  jobId: string;
  jobType: string;
  modelId: string | null;
  state: string;
  /** What a running job has done so far (population runs report it source by source). */
  progress?: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
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
  other: { conceptId: string | null; kind: string; count: number; fields?: string[] }[];
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
  nodes: { id: string; label: string; properties: Record<string, unknown> }[];
  edges: {
    id: string;
    label: string;
    sourceId: string;
    targetId: string;
    properties: Record<string, unknown>;
  }[];
  specification: RuntimeBoundRecords['specification'];
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

export interface RuntimeDocumentPreviewRequest {
  actorUserId: string;
  modelId: string;
  /** `unit`: what a row is (a sheet's row, or another concept's record for a derived source). */
  entry: { conceptId: string; conceptLabel?: string; source: Record<string, unknown>; fieldMappings: unknown[]; options?: Record<string, unknown>; unit?: 'row' | 'record' };
  aiExtraction?: { agentSlug: string; model: string | null; contractVersion: string } | null;
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

export interface RuntimeDocumentLabelsRequest {
  actorUserId: string;
  sources: Record<string, unknown>[];
}

export interface RuntimeDocumentLabels {
  documentsRead: number;
  unread: { assetId: string; status: string }[];
  labels: { label: string; kind: 'heading' | 'label'; documents: number; page: number | null; example: string }[];
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

export type RuntimeSearchEnvironment = 'draft' | 'production';
export type RuntimeSearchIndexState = 'ready' | 'queued' | 'indexing' | 'failed' | 'missing' | 'unavailable';

export interface RuntimeRecordProvenance {
  assetId: string;
  workspaceId?: string;
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
  matchClass: 'exact' | 'lexical' | 'vector' | 'hybrid';
  /** Where the best matches were: the record's own search text, or a passage of a long field. */
  matchedIn?: 'record' | 'passage';
  /** Best matching passages of long fields (up to 2), quoted around the words of the query. */
  passages?: RuntimeGraphSearchPassage[];
  rank: number;
  diagnostics: Record<string, unknown>;
  provenance: RuntimeRecordProvenance[];
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
  index: { indexId: string | null; state: RuntimeSearchIndexState; embeddingFingerprint: string | null };
  modeUsed: 'hybrid' | 'lexical_only' | 'exact_only';
  status: 'found' | 'no_match' | 'not_represented' | 'index_not_ready';
  concepts: { conceptId: string; key: string; label: string }[];
  unknownConcepts: string[];
  seeds: RuntimeGraphSearchSeed[];
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
  allowedWorkspaceIds?: string[] | null;
  expectedDataRevisionId?: string;
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
  }[];
  edges: { relationId: string; relationKey: string; sourceEntityId: string; targetEntityId: string }[];
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
export interface RuntimeRecordsGroupBy { field: string; bucket?: string; as?: string }
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
  buckets?: Record<string, unknown>[];
  bucketsTruncated?: boolean;
  aggregates?: Record<string, unknown>;
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
      const status = (error as { status?: unknown }).status;
      if (typeof status === 'number') {
        const detail = this.errorDetail(error);
        if (status === 409) {
          throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, detail);
        }
        if (status === 404) {
          throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, detail);
        }
      }
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic runtime request failed',
      );
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
    } catch {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
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
    } catch {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
    }
    if (res.status === 422) {
      const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail || 'These reading rules cannot be used');
    }
    if (!res.ok) throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
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
    } catch {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
    }
    if (res.status === 422) {
      const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail || 'These reading rules cannot be used');
    }
    if (!res.ok) throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
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
    } catch {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
    }
    if (res.status === 422) {
      const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail || 'This mapping cannot be previewed');
    }
    if (!res.ok) throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
    return await res.json() as RuntimeShapedSheetRows;
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
    } catch {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
    }
    if (res.status === 422) {
      const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, detail || 'This computation cannot be used');
    }
    if (!res.ok) throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
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
      if ((error as { status?: unknown }).status === 404) {
        throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, this.errorDetail(error));
      }
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic runtime request failed',
      );
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
    const detail = ((error as { data?: unknown }).data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail) return detail.slice(0, 200);
    return 'Semantic runtime request failed';
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
  async purgeModelData(modelId: string, actorUserId: string, options: { forgetDocumentReading: boolean }): Promise<RuntimePurgedData> {
    return this.post<RuntimePurgedData>(`/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/purge`, options, {
      'X-Actor-User-Id': actorUserId,
    });
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
    } catch {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
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
    } catch {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
    }
    if (res.ok) return await res.json() as RuntimeClonedData;
    if (res.status === 409) {
      throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT,
        'A build or index job is running on this model. Wait for it to finish, then copy it again with its data.');
    }
    throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'The model data could not be copied.');
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

  /** The actor's run for the model that has not ended yet, if any. */
  async getActiveJob(modelId: string, actorUserId: string, jobType = 'population.run'): Promise<RuntimeJob | null> {
    const params = new URLSearchParams({ modelId, jobType });
    const { job } = await this.get<{ job: RuntimeJob | null }>(`/v1/semantic-model-jobs/active?${params}`, actorUserId);
    return job;
  }

  /** Stop a job: one not started yet ends at once, a running one stops at its next step. */
  async cancelJob(jobId: string, actorUserId: string): Promise<RuntimeJob> {
    return this.post<RuntimeJob>(`/v1/semantic-model-jobs/${encodeURIComponent(jobId)}/cancel`, {}, {
      'X-Actor-User-Id': actorUserId,
    });
  }

  async searchConceptRecords(modelId: string, conceptId: string, actorUserId: string,
    query: { q?: string; limit: number; offset: number; dataRevisionId?: string }): Promise<RuntimeConceptRecordsPage> {
    const params = new URLSearchParams({ environment: 'draft', limit: String(query.limit), offset: String(query.offset) });
    if (query.q) params.set('q', query.q);
    if (query.dataRevisionId) params.set('dataRevisionId', query.dataRevisionId);
    return this.get<RuntimeConceptRecordsPage>(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/concepts/${encodeURIComponent(conceptId)}/records?${params}`,
      actorUserId,
    );
  }

  async getBoundRecords(modelId: string, actorUserId: string, limit: number, conceptId?: string, dataRevisionId?: string): Promise<RuntimeBoundRecords> {
    const concept = conceptId ? `&conceptId=${encodeURIComponent(conceptId)}` : '';
    const revision = dataRevisionId ? `&dataRevisionId=${encodeURIComponent(dataRevisionId)}` : '';
    return this.get<RuntimeBoundRecords>(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/records?environment=draft&limit=${limit}${concept}${revision}`,
      actorUserId,
    );
  }

  async getBoundGraph(modelId: string, actorUserId: string, dataRevisionId?: string): Promise<RuntimeBoundGraph> {
    const revision = dataRevisionId ? `&dataRevisionId=${encodeURIComponent(dataRevisionId)}` : '';
    return this.get<RuntimeBoundGraph>(
      `/v1/semantic-model-population/models/${encodeURIComponent(modelId)}/graph?environment=draft${revision}`,
      actorUserId,
    );
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
    } catch {
      throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
    }
    if (res.ok) {
      try {
        return await res.json() as T;
      } catch {
        throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
      }
    }
    const detail = this.errorDetail({ data: await this.readErrorPayload(res) });
    if (res.status === 422 || res.status === 400) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        GRAPH_SEARCH_REJECTIONS[detail.split(/[:\s]/)[0]] ?? GRAPH_SEARCH_REJECTIONS.invalid_query);
    }
    if (res.status === 409) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, detail);
    if (res.status === 404) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, detail);
    throw new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Semantic runtime request failed');
  }

  async commitManualSnapshot(modelId: string, snapshotId: string, counts: { rowCount: number; linkCount: number }): Promise<{ reused: boolean }> {
    return this.post(
      `/v1/semantic-model-population/manual-sources/${encodeURIComponent(modelId)}/snapshots/${encodeURIComponent(snapshotId)}/commit`,
      counts,
    );
  }
}
