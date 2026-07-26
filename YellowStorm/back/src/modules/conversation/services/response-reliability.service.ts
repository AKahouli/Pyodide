import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { EvaluationSettingsService, ResponseReliabilitySettings } from '@modules/evaluation/services/evaluation-settings.service';
import { ModelsService } from '@modules/models/models.service';
import { LoggerService } from '@modules/logger';
import type { ReliabilityClaimImportance, ReliabilityClaimStatus } from '../interfaces/message.interface';
import { MessageService } from './message.service';
import { ResponseReliabilityEvidenceBuilder, ResponseReliabilityInput } from './response-reliability-evidence.builder';
import { EvaluatedReliabilityClaim, ResponseReliabilityScoringService } from './response-reliability-scoring.service';

const MAX_PENDING_QUEUE_SIZE = 100;
const STALE_PENDING_MS = 5 * 60 * 1000;

interface ReliabilityJob {
  messageId: string;
  conversationId: string;
  questionMessageId: string;
  userId: string;
  requestId: string;
  requestedAt: string;
  settings: ResponseReliabilitySettings;
}

interface AdkReliabilityResponse {
  applicability: 'evaluated' | 'not_applicable';
  claims: EvaluatedReliabilityClaim[];
  evaluatorVersion: string;
  promptVersion: string;
}

@Injectable()
export class ResponseReliabilityService implements OnModuleInit {
  private readonly queue: ReliabilityJob[] = [];
  private readonly scheduledMessageIds = new Set<string>();
  private activeEvaluations = 0;

  constructor(
    private readonly settingsService: EvaluationSettingsService,
    private readonly messageService: MessageService,
    private readonly modelsService: ModelsService,
    private readonly configService: ConfigService,
    private readonly evidenceBuilder: ResponseReliabilityEvidenceBuilder,
    private readonly scoringService: ResponseReliabilityScoringService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ResponseReliabilityService.name);
  }

  async onModuleInit(): Promise<void> {
    await this.cleanupStalePending();
  }

  async schedule(input: {
    messageId: string;
    conversationId: string;
    questionMessageId?: string;
    userId: string;
    requestId?: string;
  }): Promise<void> {
    if (this.scheduledMessageIds.has(input.messageId)) return;
    const settings = (await this.settingsService.getSettings()).responseReliability;
    if (!settings.enabled) return;

    const message = await this.messageService.getMessageDocument(input.messageId);
    const components = Array.isArray(message.components) ? message.components : [];
    const eligible = message.conversationType === 'ai'
      && message.isComplete === true
      && message.isStreaming === false
      && components.some((component) => component.type === 'text'
        && typeof component.data?.content === 'string' && component.data.content.trim())
      && !components.some((component) => component.type === 'error')
      && !message.reliabilityEvaluation;
    if (!eligible) return;

    if (this.scheduledMessageIds.has(input.messageId)) return;
    const questionMessageId = input.questionMessageId || message.questionMessageId?.toString();
    if (!questionMessageId) return;
    const requestedAt = new Date().toISOString();
    this.scheduledMessageIds.add(input.messageId);
    try {
      await this.messageService.updateReliabilityEvaluation(input.messageId, { status: 'pending', requestedAt });
    } catch (error) {
      this.scheduledMessageIds.delete(input.messageId);
      throw error;
    }
    const job: ReliabilityJob = {
      ...input,
      questionMessageId,
      requestId: input.requestId || randomUUID(),
      requestedAt,
      settings,
    };

    if (this.queue.length >= MAX_PENDING_QUEUE_SIZE) {
      this.scheduledMessageIds.delete(input.messageId);
      await this.failJob(job, 'queue_capacity_exceeded');
      return;
    }

    // This FIFO and its concurrency limit are intentionally per backend instance for the MVP.
    this.queue.push(job);
    this.drainQueue();
  }

  @Interval(60_000)
  async cleanupStalePending(): Promise<void> {
    try {
      // Heartbeats are shared through Mongo so another replica cannot expire live local work.
      await this.messageService.touchPendingReliabilityEvaluations([...this.scheduledMessageIds]);
      const count = await this.messageService.markStaleReliabilityEvaluationsFailed(new Date(Date.now() - STALE_PENDING_MS));
      if (count) this.logger.warn('Marked stale reliability evaluations failed', { count });
    } catch (error) {
      this.logger.error('Unable to clean stale reliability evaluations', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private drainQueue(): void {
    const concurrency = this.queue[0]?.settings.maxConcurrentEvaluations ?? 1;
    while (this.activeEvaluations < concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.activeEvaluations += 1;
      void this.processJob(job).catch((error) => {
        this.logger.error('Unable to persist reliability evaluation outcome', {
          messageId: job.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => {
        this.activeEvaluations -= 1;
        this.scheduledMessageIds.delete(job.messageId);
        this.drainQueue();
      });
    }
  }

  private async processJob(job: ReliabilityJob): Promise<void> {
    const startedAt = Date.now();
    try {
      const message = await this.messageService.getMessageDocument(job.messageId);
      const question = await this.messageService.getMessageDocument(job.questionMessageId);
      const evidenceInput = this.evidenceBuilder.build(message, question.content || '', job.requestId);
      const evidenceCount = evidenceInput.globalEvidence.length
        + evidenceInput.segments.reduce((sum, segment) => sum + segment.evidence.length, 0);
      if (!evidenceCount) {
        await this.messageService.updateReliabilityEvaluation(job.messageId, {
          status: 'insufficient_evidence',
          summary: 'The answer did not include enough supporting evidence to verify its factual claims.',
          requestedAt: job.requestedAt,
          evaluatedAt: new Date().toISOString(),
          durationMs: 0,
        });
        return;
      }

      const model = job.settings.judgeModelId ? await this.modelsService.findById(job.settings.judgeModelId) : null;
      if (!model?.isActive || !model.types.some((type) => type === 'chat' || type === 'completion')) {
        await this.failJob(job, 'judge_model_unavailable');
        return;
      }

      const modelName = this.modelsService.getModelIdentifier(model);
      const result = await this.callEvaluator(evidenceInput, modelName, job.settings);
      if (result.applicability === 'not_applicable' || result.claims.length === 0) {
        await this.messageService.updateReliabilityEvaluation(job.messageId, {
          status: 'not_applicable',
          summary: 'No verifiable factual claims were identified in this answer.',
          requestedAt: job.requestedAt,
          evaluatedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      const scored = this.scoringService.scoreClaims(result.claims, job.settings.maxFindings);
      await this.messageService.updateReliabilityEvaluation(job.messageId, {
        status: 'completed',
        ...scored,
        // Claims remain complete; findings are the independently limited attention summary.
        claims: result.claims,
        evaluator: {
          modelId: model.id,
          modelName,
          evaluatorVersion: result.evaluatorVersion,
          promptVersion: result.promptVersion,
        },
        requestedAt: job.requestedAt,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const failureCode = axios.isAxiosError(error)
        ? error.code === 'ECONNABORTED' ? 'evaluator_timeout' : 'evaluator_http_error'
        : error instanceof InvalidEvaluatorResponseError ? 'evaluator_invalid_response' : 'unexpected_evaluation_error';
      this.logger.warn('Response reliability evaluation failed', {
        messageId: job.messageId,
        failureCode,
      });
      await this.failJob(job, failureCode, Date.now() - startedAt);
    }
  }

  private async callEvaluator(input: ResponseReliabilityInput, judgeModel: string, settings: ResponseReliabilitySettings): Promise<AdkReliabilityResponse> {
    const baseUrl = (this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(/\/$/, '');
    const apiKey = (this.configService.get<string>('indexing.adkApiKey') || '').trim();
    if (!apiKey) throw new Error('ADK API key is not configured');
    const { data } = await axios.post(
      `${baseUrl}/response-evaluation/evaluate`,
      { ...input, judgeModel, maxFindings: settings.maxFindings },
      { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'X-Request-ID': input.requestId }, timeout: settings.timeoutMs },
    );
    return this.validateEvaluatorResponse(data, input);
  }

  private validateEvaluatorResponse(value: unknown, input: ResponseReliabilityInput): AdkReliabilityResponse {
    if (!value || typeof value !== 'object') throw new InvalidEvaluatorResponseError();
    const raw = value as Record<string, unknown>;
    if (raw.applicability !== 'evaluated' && raw.applicability !== 'not_applicable') throw new InvalidEvaluatorResponseError();
    if (!Array.isArray(raw.claims) || raw.claims.length > 100
      || typeof raw.evaluatorVersion !== 'string' || typeof raw.promptVersion !== 'string') {
      throw new InvalidEvaluatorResponseError();
    }
    const validStatuses = new Set<ReliabilityClaimStatus>(['supported', 'partially_supported', 'unsupported', 'contradicted']);
    const validImportance = new Set<ReliabilityClaimImportance>(['critical', 'major', 'minor']);
    const evidenceIds = new Set([...input.globalEvidence.map((item) => item.id), ...input.segments.flatMap((segment) => segment.evidence.map((item) => item.id))]);
    const claims = raw.claims.map((claim): EvaluatedReliabilityClaim => {
      if (!claim || typeof claim !== 'object') throw new InvalidEvaluatorResponseError();
      const item = claim as Record<string, unknown>;
      if (typeof item.claim !== 'string' || typeof item.explanation !== 'string'
        || !validStatuses.has(item.status as ReliabilityClaimStatus)
        || !validImportance.has(item.importance as ReliabilityClaimImportance)
        || !Array.isArray(item.evidenceIds)
        || item.evidenceIds.some((id) => typeof id !== 'string' || !evidenceIds.has(id))) {
        throw new InvalidEvaluatorResponseError();
      }
      return {
        claim: item.claim.slice(0, 2000),
        explanation: item.explanation.slice(0, 2000),
        status: item.status as ReliabilityClaimStatus,
        importance: item.importance as ReliabilityClaimImportance,
        evidenceIds: item.evidenceIds as string[],
      };
    });
    return { applicability: raw.applicability, claims, evaluatorVersion: raw.evaluatorVersion, promptVersion: raw.promptVersion };
  }

  private async failJob(job: ReliabilityJob, failureCode: string, durationMs?: number): Promise<void> {
    await this.messageService.updateReliabilityEvaluation(job.messageId, {
      status: 'failed',
      requestedAt: job.requestedAt,
      evaluatedAt: new Date().toISOString(),
      durationMs,
      failureCode,
    });
  }
}

class InvalidEvaluatorResponseError extends Error {
  constructor() {
    super('Evaluator returned an invalid response');
  }
}
