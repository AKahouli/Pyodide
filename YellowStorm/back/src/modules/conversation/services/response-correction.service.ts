import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { ResponseReliabilitySettings } from '@modules/evaluation/services/evaluation-settings.service';
import { ModelsService } from '@modules/models/models.service';
import { LoggerService } from '@modules/logger';
import type { AppliedCorrection, MessageComponent, ReliabilityEvaluation, ResponseCorrectionWorkflow } from '../interfaces/message.interface';
import { MessageService } from './message.service';
import { ResponseReliabilityEvidenceBuilder, ResponseReliabilityInput, type ReliabilityEvidenceItem } from './response-reliability-evidence.builder';
import { ResponseReliabilityScoringService, type EvaluatedReliabilityClaim } from './response-reliability-scoring.service';
import { ResponseCorrectionPlannerService } from './response-correction-planner.service';
import { CorrectedResponseComponentBuilder } from './corrected-response-component.builder';
import { ResponseCorrectionPolicyService } from './response-correction-policy.service';
import { ReportService } from './report.service';
import { CorrectiveReplayContextService } from './corrective-replay-context.service';
import { CorrectiveReplayFailure, CorrectiveReplayRunnerService } from './corrective-replay-runner.service';

const MAX_CORRECTION_QUEUE_SIZE = 50;

interface CorrectionJob {
  messageId: string;
  conversationId: string;
  questionMessageId: string;
  userId: string;
  requestId: string;
  originalEvaluation: ReliabilityEvaluation;
  settings: ResponseReliabilitySettings;
  queuedAt: string;
}

interface CorrectorResponse {
  correctedSegments: Array<{ text: string; evidenceIds: string[] }>;
  appliedCorrections: AppliedCorrection[];
  remainingUncertainties: string[];
  correctorVersion: string;
  promptVersion: string;
}

@Injectable()
export class ResponseCorrectionService {
  private readonly queue: CorrectionJob[] = [];
  private readonly scheduled = new Set<string>();
  private active = false;

  constructor(
    private readonly messageService: MessageService,
    private readonly modelsService: ModelsService,
    private readonly configService: ConfigService,
    private readonly evidenceBuilder: ResponseReliabilityEvidenceBuilder,
    private readonly scoringService: ResponseReliabilityScoringService,
    private readonly planner: ResponseCorrectionPlannerService,
    private readonly componentBuilder: CorrectedResponseComponentBuilder,
    private readonly policy: ResponseCorrectionPolicyService,
    private readonly reportService: ReportService,
    private readonly replayContextService: CorrectiveReplayContextService,
    private readonly replayRunner: CorrectiveReplayRunnerService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ResponseCorrectionService.name);
  }

  async schedule(input: Omit<CorrectionJob, 'queuedAt'>): Promise<void> {
    if (this.scheduled.has(input.messageId)) return;
    const queuedAt = new Date().toISOString();
    const job = { ...input, queuedAt };
    this.scheduled.add(input.messageId);
    await this.persist(job, { status: 'queued', activeVersion: 'original', attemptCount: 0 });
    if (this.queue.length >= MAX_CORRECTION_QUEUE_SIZE) {
      this.scheduled.delete(input.messageId);
      await this.applyFailure(job, 'correction_queue_capacity_exceeded', 0);
      return;
    }
    this.queue.push(job);
    this.drain();
  }

  async applyInsufficientEvidence(input: Omit<CorrectionJob, 'queuedAt'>): Promise<void> {
    const job = { ...input, queuedAt: new Date().toISOString() };
    await this.applyFailure(job, 'insufficient_evidence', 0);
  }

  private drain(): void {
    if (this.active || !this.queue.length) return;
    const job = this.queue.shift()!;
    this.active = true;
    void this.process(job).catch((error) => {
      this.logger.warn('Response correction failed', { messageId: job.messageId, error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      this.active = false;
      this.scheduled.delete(job.messageId);
      this.drain();
    });
  }

  private async process(job: CorrectionJob): Promise<void> {
    const started = Date.now();
    const deadline = started + job.settings.correction.maxDurationMs;
    let attemptsMade = 0;
    try {
      const message = await this.messageService.getMessageDocument(job.messageId);
      const question = await this.messageService.getMessageDocument(job.questionMessageId);
      const originalComponents = (message.components || []) as MessageComponent[];
      const evidenceInput = this.evidenceBuilder.build(message, question.content || '', job.requestId);
      const evidence = [...evidenceInput.globalEvidence, ...evidenceInput.segments.flatMap((segment) => segment.evidence)];
      const model = job.settings.judgeModelId ? await this.modelsService.findById(job.settings.judgeModelId) : null;
      if (!model?.isActive) throw new CorrectionFailure('judge_model_unavailable');
      const modelName = this.modelsService.getModelIdentifier(model);
      let currentEvaluation = job.originalEvaluation;
      let previousCandidateSegments: Array<{ text: string }> = [];
      let previousCandidateComponents: MessageComponent[] | undefined;
      const replayContext = await this.resolveReplayContext(job.questionMessageId, job.messageId);

      for (let attempt = 1; attempt <= job.settings.correction.maxAttempts; attempt += 1) {
        attemptsMade = attempt;
        this.assertDuration(deadline);
        await this.persist(job, { status: 'correcting', activeVersion: 'original', attemptCount: attempt, startedAt: new Date(started).toISOString() });
        let correctedComponents: MessageComponent[];
        let candidateInput: ResponseReliabilityInput;
        let candidate: CorrectorResponse | undefined;
        let strategy: ResponseCorrectionWorkflow['strategy'] = 'existing_evidence';
        let promptVersion = '';

        if (replayContext) {
          try {
            const replay = await this.replayRunner.run({
              userId: job.userId,
              conversationId: job.conversationId,
              messageId: job.messageId,
              questionMessageId: job.questionMessageId,
              request: replayContext.request,
              originalComponents: previousCandidateComponents ?? originalComponents,
              evaluation: currentEvaluation,
              attemptNumber: attempt,
              timeoutMs: this.remaining(deadline),
            });
            correctedComponents = replay.components;
            previousCandidateComponents = replay.components;
            promptVersion = replay.promptVersion;
            strategy = 'corrective_replay';
            candidateInput = this.evidenceBuilder.buildFromComponents({
              messageId: job.messageId,
              components: replay.evidenceComponents,
              question: replayContext.request.content,
              requestId: `${job.requestId}:replay:${attempt}`,
            });
            const replayEvidenceCount = candidateInput.globalEvidence.length
              + candidateInput.segments.reduce((count, segment) => count + segment.evidence.length, 0);
            if (!replayEvidenceCount) throw new CorrectiveReplayFailure('corrective_replay_no_evidence', true);
          } catch (error) {
            if (!(error instanceof CorrectiveReplayFailure) || error.replayStarted) throw error;
            this.logger.warn('Corrective replay unavailable before execution; using existing evidence', {
              messageId: job.messageId,
              failureCode: error.code,
            });
            ({ correctedComponents, candidateInput, candidate } = await this.buildExistingEvidenceCandidate(
              job, attempt, currentEvaluation, evidenceInput, evidence, originalComponents,
              previousCandidateSegments, modelName, model.omitTemperature, deadline,
            ));
            previousCandidateSegments = candidate.correctedSegments;
          }
        } else {
          this.logger.warn('Corrective replay context unavailable; using existing evidence', {
            messageId: job.messageId,
            failureCode: 'corrective_replay_context_unavailable',
          });
          ({ correctedComponents, candidateInput, candidate } = await this.buildExistingEvidenceCandidate(
            job, attempt, currentEvaluation, evidenceInput, evidence, originalComponents,
            previousCandidateSegments, modelName, model.omitTemperature, deadline,
          ));
          previousCandidateSegments = candidate.correctedSegments;
        }
        await this.persist(job, { status: 're_evaluating', activeVersion: 'original', attemptCount: attempt, startedAt: new Date(started).toISOString() });
        this.assertDuration(deadline);
        const finalEvaluation = await this.evaluateCandidate(candidateInput, modelName, model.id, model.omitTemperature, job.settings, this.remaining(deadline));
        currentEvaluation = finalEvaluation;
        const hasText = correctedComponents.some((component) => component.type === 'text'
          && (typeof component.data.content === 'string' ? component.data.content.trim() : typeof component.data.text === 'string' && component.data.text.trim()));
        if (this.policy.isSuccessfulCorrection(finalEvaluation, job.settings.correction.threshold, job.originalEvaluation.score ?? 0, Boolean(hasText))) {
          await this.persist(job, {
            status: 'corrected', activeVersion: 'corrected', attemptCount: attempt,
            correctedComponents, finalReliabilityEvaluation: finalEvaluation,
            appliedCorrections: candidate?.appliedCorrections,
            remainingUncertainties: candidate?.remainingUncertainties,
            startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - started,
            correctionModel: {
              modelId: model.id,
              modelName,
              correctorVersion: candidate?.correctorVersion ?? 'corrective-replay-v2',
              promptVersion: candidate?.promptVersion ?? promptVersion,
            },
            strategy,
          });
          return;
        }
      }
      await this.applyFailure(job, 'correction_attempts_exhausted', Date.now() - started, attemptsMade);
    } catch (error) {
      const code = this.failureCode(error);
      await this.applyFailure(job, code, Date.now() - started, attemptsMade);
    }
  }

  private async resolveReplayContext(questionMessageId: string, messageId: string) {
    try {
      return await this.replayContextService.resolve(questionMessageId);
    } catch (error) {
      this.logger.warn('Corrective replay context could not be resolved', {
        messageId,
        failureCode: 'corrective_replay_context_unavailable',
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async buildExistingEvidenceCandidate(
    job: CorrectionJob,
    attempt: number,
    currentEvaluation: ReliabilityEvaluation,
    evidenceInput: ResponseReliabilityInput,
    evidence: ReliabilityEvidenceItem[],
    originalComponents: MessageComponent[],
    previousCandidateSegments: Array<{ text: string }>,
    modelName: string,
    omitTemperature: boolean,
    deadline: number,
  ): Promise<{ correctedComponents: MessageComponent[]; candidateInput: ResponseReliabilityInput; candidate: CorrectorResponse }> {
    const candidate = await this.callCorrector({
      requestId: job.requestId,
      messageId: job.messageId,
      attemptNumber: attempt,
      question: evidenceInput.question,
      originalSegments: evidenceInput.segments.map(({ componentId, text }) => ({ componentId, text })),
      previousCandidateSegments,
      instructions: this.planner.build(currentEvaluation),
      evidence,
      judgeModel: modelName,
      omitTemperature,
    }, this.remaining(deadline));
    return {
      candidate,
      correctedComponents: this.componentBuilder.build(originalComponents, evidenceInput.segments, candidate.correctedSegments),
      candidateInput: {
        ...evidenceInput,
        segments: evidenceInput.segments.map((segment, index) => ({ ...segment, text: candidate.correctedSegments[index].text })),
      },
    };
  }

  private async callCorrector(payload: Record<string, unknown>, timeout: number): Promise<CorrectorResponse> {
    const { data } = await axios.post(`${this.adkBaseUrl()}/response-evaluation/correct`, payload, { headers: this.headers(String(payload.requestId)), timeout });
    if (!data || !Array.isArray(data.correctedSegments) || data.correctedSegments.length > 100
      || !Array.isArray(data.appliedCorrections) || data.appliedCorrections.length > 100
      || !Array.isArray(data.remainingUncertainties) || data.remainingUncertainties.length > 100
      || data.remainingUncertainties.some((item: unknown) => typeof item !== 'string' || !item.trim())
      || typeof data.correctorVersion !== 'string' || typeof data.promptVersion !== 'string') throw new CorrectionFailure('corrector_invalid_response');
    const evidenceIds = new Set((payload.evidence as Array<{ id?: unknown }> || []).map((item) => item.id).filter((id): id is string => typeof id === 'string'));
    const instructionClaims = new Set((payload.instructions as Array<{ claim?: unknown }> || []).map((item) => item.claim).filter((claim): claim is string => typeof claim === 'string'));
    const actions = new Set(['removed', 'qualified', 'replaced', 'citation_repaired']);
    if (data.correctedSegments.length !== (payload.originalSegments as unknown[]).length
      || data.correctedSegments.some((segment: unknown) => !segment || typeof segment !== 'object'
        || typeof (segment as { text?: unknown }).text !== 'string' || !(segment as { text: string }).text.trim()
        || !Array.isArray((segment as { evidenceIds?: unknown }).evidenceIds)
        || (segment as { evidenceIds: unknown[] }).evidenceIds.some((id) => typeof id !== 'string' || !evidenceIds.has(id)))
      || data.appliedCorrections.some((correction: unknown) => !correction || typeof correction !== 'object'
        || !instructionClaims.has((correction as { claim?: string }).claim || '')
        || !actions.has((correction as { action?: string }).action || '')
        || typeof (correction as { explanation?: unknown }).explanation !== 'string'
        || !Array.isArray((correction as { evidenceIds?: unknown }).evidenceIds)
        || (correction as { evidenceIds: unknown[] }).evidenceIds.some((id) => typeof id !== 'string' || !evidenceIds.has(id)))) {
      throw new CorrectionFailure('corrector_invalid_response');
    }
    return data as CorrectorResponse;
  }

  private async evaluateCandidate(
    input: ResponseReliabilityInput, judgeModel: string, modelId: string, omitTemperature: boolean,
    settings: ResponseReliabilitySettings, timeout: number,
  ): Promise<ReliabilityEvaluation> {
    const { data } = await axios.post(`${this.adkBaseUrl()}/response-evaluation/evaluate`, {
      ...input, judgeModel, maxFindings: settings.maxFindings, omitTemperature,
    }, { headers: this.headers(input.requestId), timeout });
    if (!data || data.applicability !== 'evaluated' || !Array.isArray(data.claims) || data.claims.length > 100) throw new CorrectionFailure('candidate_evaluation_invalid');
    const evidenceIds = new Set([...input.globalEvidence, ...input.segments.flatMap((segment) => segment.evidence)].map((item) => item.id));
    const statuses = new Set(['supported', 'partially_supported', 'unsupported', 'contradicted']);
    const importance = new Set(['critical', 'major', 'minor']);
    const claims = data.claims.map((claim: unknown): EvaluatedReliabilityClaim => {
      if (!claim || typeof claim !== 'object') throw new CorrectionFailure('candidate_evaluation_invalid');
      const item = claim as Record<string, unknown>;
      if (typeof item.claim !== 'string' || typeof item.explanation !== 'string'
        || !statuses.has(String(item.status)) || !importance.has(String(item.importance))
        || !Array.isArray(item.evidenceIds)
        || item.evidenceIds.some((id) => typeof id !== 'string' || !evidenceIds.has(id))) {
        throw new CorrectionFailure('candidate_evaluation_invalid');
      }
      return item as unknown as EvaluatedReliabilityClaim;
    });
    const scored = this.scoringService.scoreClaims(claims, settings.maxFindings);
    return {
      status: 'completed', ...scored, claims,
      evaluator: { modelId, modelName: judgeModel, evaluatorVersion: String(data.evaluatorVersion), promptVersion: String(data.promptVersion) },
      evaluatedAt: new Date().toISOString(),
    };
  }

  private async applyFailure(job: CorrectionJob, failureCode: string, durationMs: number, attemptCount = 0): Promise<void> {
    const behavior = job.settings.correction.failureBehavior;
    const status = behavior === 'abstain' ? 'abstained' : behavior === 'require_human_review' ? 'human_review_required' : 'failed';
    const reviewReportId = behavior === 'require_human_review'
      ? (await this.reportService.createSystemCorrectionReport({ conversationId: job.conversationId, messageId: job.messageId, userId: job.userId })).id
      : undefined;
    await this.persist(job, {
      status, activeVersion: behavior === 'abstain' ? 'abstention' : 'original', attemptCount,
      failureCode, completedAt: new Date().toISOString(), durationMs, reviewReportId,
    });
  }

  private async persist(job: CorrectionJob, patch: Partial<ResponseCorrectionWorkflow>): Promise<void> {
    await this.messageService.updateCorrectionWorkflow(job.messageId, {
      mode: 'corrective_transparent', status: patch.status || 'queued', activeVersion: patch.activeVersion || 'original',
      originalScore: job.originalEvaluation.score, threshold: job.settings.correction.threshold,
      attemptCount: patch.attemptCount ?? 0, maxAttempts: job.settings.correction.maxAttempts,
      failureBehavior: job.settings.correction.failureBehavior, showOriginalAnswer: job.settings.correction.showOriginalAnswer,
      queuedAt: job.queuedAt, ...patch,
    });
  }

  private remaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new CorrectionFailure('correction_duration_exceeded');
    return remaining;
  }

  private assertDuration(deadline: number): void { this.remaining(deadline); }
  private failureCode(error: unknown): string {
    if (error instanceof CorrectiveReplayFailure) return error.code;
    if (error instanceof CorrectionFailure) return error.code;
    if (!axios.isAxiosError(error)) return 'correction_failed';
    if (error.code === 'ECONNABORTED') return 'correction_duration_exceeded';
    if (error.response?.status === 502) {
      return error.response.data?.detail === 'The response corrector returned an invalid response'
        ? 'corrector_invalid_response'
        : 'corrector_unavailable';
    }
    return 'corrector_http_error';
  }
  private adkBaseUrl(): string { return (this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(/\/$/, ''); }
  private headers(requestId: string): Record<string, string> {
    const apiKey = (this.configService.get<string>('indexing.adkApiKey') || '').trim();
    if (!apiKey) throw new CorrectionFailure('adk_api_key_unavailable');
    return { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'X-Request-ID': requestId };
  }
}

class CorrectionFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
