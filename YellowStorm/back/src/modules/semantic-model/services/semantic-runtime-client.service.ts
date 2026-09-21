import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios from 'axios';
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

  private requireWrites(): string {
    if (!this.config.runtimeEnabled || !this.config.runtimeWritesEnabled) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic runtime writes are disabled',
      );
    }
    if (!this.config.runtimeUrl || !this.config.runtimeServiceKey) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic runtime is not configured',
      );
    }
    return this.config.runtimeUrl.replace(/\/+$/, '');
  }

  private async post<T>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const base = this.requireWrites();
    try {
      const { data } = await axios.post<T>(`${base}${path}`, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Semantic-Service-Key': this.config.runtimeServiceKey,
          ...headers,
        },
        timeout: this.config.runtimeRequestTimeoutMs,
      });
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail = this.errorDetail(error);
        if (error.response?.status === 409) {
          throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, detail);
        }
        if (error.response?.status === 404) {
          throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, detail);
        }
      }
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic runtime request failed',
      );
    }
  }

  private errorDetail(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
      if (typeof detail === 'string' && detail) return detail.slice(0, 200);
    }
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
}
