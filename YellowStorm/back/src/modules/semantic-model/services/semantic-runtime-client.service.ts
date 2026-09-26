import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

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
  result: Record<string, unknown> | null;
  errorCode: string | null;
}

export interface RuntimeBoundRecords {
  modelId: string;
  modelVersionId: string;
  dataRevisionId: string;
  entities: Array<{
    entityId: string;
    conceptId: string;
    label: string;
    attributes: Record<string, unknown>;
    provenance: Record<string, unknown>;
  }>;
  relationships: Array<{
    relationId: string;
    sourceEntityId: string;
    targetEntityId: string;
    matchingStrategy: string | null;
  }>;
  counts: { entities: number; assertions: number; relationships: number };
  specification: {
    concepts: Array<{ conceptId: string; label: string; allowedFields: string[] }>;
    relations: Array<{ relationId: string; label: string }>;
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
  nodes: Array<{ id: string; label: string; properties: Record<string, unknown> }>;
  edges: Array<{
    id: string;
    label: string;
    sourceId: string;
    targetId: string;
    properties: Record<string, unknown>;
  }>;
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

@Injectable()
export class SemanticRuntimeClientService {
  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
  ) {}

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

  async commitManualSnapshot(modelId: string, snapshotId: string, counts: { rowCount: number; linkCount: number }): Promise<{ reused: boolean }> {
    return this.post(
      `/v1/semantic-model-population/manual-sources/${encodeURIComponent(modelId)}/snapshots/${encodeURIComponent(snapshotId)}/commit`,
      counts,
    );
  }
}
