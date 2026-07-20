import { createHash } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { IndexingService } from '@modules/indexing/indexing.service';
import type { KnowledgeAssessmentContext, KnowledgeAssessmentDimensions, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { KnowledgeAssessmentRepositoryService } from '@modules/knowledge-intelligence/services/knowledge-assessment-repository.service';
import { KnowledgeAlertRepositoryService } from '@modules/knowledge-intelligence/services/knowledge-alert-repository.service';
import { KnowledgeRecommendationRepositoryService } from '@modules/knowledge-intelligence/services/knowledge-recommendation-repository.service';
import { MetadataCandidateRepositoryService } from '@modules/knowledge-intelligence/services/metadata-candidate-repository.service';
import type { KnowledgeRecommendationDocument } from '@modules/knowledge-intelligence/schemas/knowledge-recommendation.schema';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument } from '../schemas/governance-source-version.schema';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceSourceEventService } from './governance-source-event.service';
import { KnowledgeAlertEngineService } from './knowledge-alert-engine.service';
import { KnowledgeRecommendationEngineService } from './knowledge-recommendation-engine.service';
import { MetadataCandidateEngineService } from './metadata-candidate-engine.service';
import { BusinessValidityEvaluator } from './knowledge-evaluators/business-validity.evaluator';
import { FreshnessEvaluator } from './knowledge-evaluators/freshness.evaluator';
import { AvailabilityEvaluator } from './knowledge-evaluators/availability.evaluator';
import { IntegrityEvaluator } from './knowledge-evaluators/integrity.evaluator';
import { SearchQualityEvaluator } from './knowledge-evaluators/search-quality.evaluator';
import { GovernanceQualityEvaluator } from './knowledge-evaluators/governance-quality.evaluator';

const ASSESSMENT_VERSION = 'knowledge-health-v1';

@Injectable()
export class GovernanceKnowledgeAssessmentService {
  private readonly logger = new Logger(GovernanceKnowledgeAssessmentService.name);
  private scheduledRunActive = false;
  private readonly evaluators: KnowledgeEvaluator[];

  constructor(
    @InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>,
    @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>,
    private readonly programs: GovernanceProgramService,
    private readonly access: GovernanceAccessService,
    private readonly assessments: KnowledgeAssessmentRepositoryService,
    private readonly alerts: KnowledgeAlertRepositoryService,
    private readonly recommendations: KnowledgeRecommendationRepositoryService,
    private readonly metadataCandidates: MetadataCandidateRepositoryService,
    private readonly alertEngine: KnowledgeAlertEngineService,
    private readonly recommendationEngine: KnowledgeRecommendationEngineService,
    private readonly metadataEngine: MetadataCandidateEngineService,
    private readonly businessValidity: BusinessValidityEvaluator,
    private readonly freshness: FreshnessEvaluator,
    private readonly availability: AvailabilityEvaluator,
    private readonly integrity: IntegrityEvaluator,
    private readonly searchQuality: SearchQualityEvaluator,
    private readonly governanceQuality: GovernanceQualityEvaluator,
    private readonly events: GovernanceSourceEventService,
    private readonly audit: AuditLogService,
    private readonly indexing: IndexingService,
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {
    this.evaluators = [businessValidity, freshness, availability, integrity, searchQuality, governanceQuality];
  }

  @Interval(300_000)
  async assessCurrentVersions(): Promise<void> {
    if (this.scheduledRunActive || !this.config.get<boolean>('dataRoom.knowledgeAssessmentEnabled')) return;
    this.scheduledRunActive = true;
    try {
      const sources = await this.sourceModel.find({ isArchived: { $ne: true }, $or: [{ currentCandidateVersionId: { $exists: true } }, { currentPublishedVersionId: { $exists: true } }] }).sort({ updatedAt: 1 }).limit(200).exec();
      for (const source of sources) {
        const versionId = source.currentCandidateVersionId ?? source.currentPublishedVersionId;
        if (!versionId) continue;
        const version = await this.versionModel.findOne({ _id: versionId, sourceId: source._id, programId: source.programId, technicalStatus: 'ready', lifecycleStatus: { $nin: ['rejected', 'superseded'] } }).lean().exec();
        if (version) await this.assess(source.programId.toString(), source, version);
      }
    } catch (error) {
      this.logger.error('Knowledge assessment backfill failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      this.scheduledRunActive = false;
    }
  }

  async refresh(actorId: string, actorEmail: string, programId: string, scopeId?: string): Promise<{ assessed: number }> {
    this.assertEnabled();
    const scopeIds = await this.authorizedScopeIds(actorId, programId, scopeId);
    const sources = await this.loadSources(programId, scopeIds, scopeId);
    let assessed = 0;
    for (const source of sources.slice(0, 500)) {
      const versionId = source.currentCandidateVersionId ?? source.currentPublishedVersionId;
      if (!versionId) continue;
      const version = await this.versionModel.findOne({ _id: versionId, sourceId: source._id, programId: source.programId }).lean().exec();
      if (!version) continue;
      await this.assess(programId, source, version);
      assessed += 1;
    }
    this.audit.logSuccess({ actorId, actorEmail, action: 'governance.knowledge.refreshed', targetType: 'governance_program', targetId: programId, metadata: { scopeId, assessed } });
    return { assessed };
  }

  async healthSummary(actorId: string, programId: string, scopeId?: string) {
    this.assertEnabled();
    const scopeIds = await this.authorizedScopeIds(actorId, programId, scopeId);
    const records = await this.assessments.latestByProgram(programId, scopeId ? [scopeId] : scopeIds);
    const byStatus = { healthy: 0, warning: 0, critical: 0 };
    for (const record of records) byStatus[record.status] += 1;
    const averageHealthScore = records.length ? Math.round(records.reduce((sum, item) => sum + item.overallHealthScore, 0) / records.length) : 0;
    return { totalSources: records.length, averageHealthScore, byStatus, assessments: records.map((record) => this.serialize(record)) };
  }

  async listAlerts(actorId: string, programId: string, query: { scopeId?: string; status?: 'open' | 'acknowledged' | 'resolved' | 'ignored'; category?: 'validity' | 'freshness' | 'availability' | 'integrity' | 'governance' | 'search_quality' | 'impact'; severity?: 'critical' | 'high' | 'medium' | 'low' }) {
    this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId, query.scopeId); return (await this.alerts.list(programId, { ...query, scopeIds: query.scopeId ? [query.scopeId] : scopeIds })).map((item) => this.serialize(item.toObject()));
  }

  async listRecommendations(actorId: string, programId: string, query: { scopeId?: string; status?: 'proposed' | 'accepted' | 'rejected' | 'applied' | 'superseded'; priority?: 'critical' | 'high' | 'medium' | 'low' }) {
    this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId, query.scopeId); return (await this.recommendations.list(programId, { ...query, scopeIds: query.scopeId ? [query.scopeId] : scopeIds })).map((item) => this.serialize(item.toObject()));
  }

  async listMetadataCandidates(actorId: string, programId: string, scopeId?: string, status?: 'proposed' | 'accepted' | 'rejected' | 'superseded') {
    this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId, scopeId); return (await this.metadataCandidates.list(programId, scopeId ? [scopeId] : scopeIds, status)).map((item) => this.serialize(item.toObject()));
  }

  async acknowledgeAlert(actorId: string, actorEmail: string, programId: string, alertId: string) {
    this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId); const result = await this.alerts.acknowledge(programId, alertId, actorId, scopeIds); if (!result) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Only an accessible open alert can be acknowledged.'); this.audit.logSuccess({ actorId, actorEmail, action: 'governance.knowledge.alert_acknowledged', targetType: 'knowledge_alert', targetId: alertId, metadata: { programId } }); return this.serialize(result.toObject());
  }

  async decideRecommendation(actorId: string, actorEmail: string, programId: string, id: string, action: 'accept' | 'reject', reason?: string) {
    this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId); const result = await this.recommendations.decide(programId, id, actorId, action, scopeIds, reason); if (!result) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Only an accessible proposed recommendation can be decided.'); this.audit.logSuccess({ actorId, actorEmail, action: `governance.knowledge.recommendation_${action}ed`, targetType: 'knowledge_recommendation', targetId: id, metadata: { programId, type: result.type } }); return this.serialize(result.toObject());
  }

  async applyRecommendation(actorId: string, actorEmail: string, programId: string, id: string) {
    this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId); const recommendation = await this.recommendations.beginApply(programId, id, scopeIds); if (!recommendation) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Accept an accessible recommendation before applying it.');
    const applicationToken = recommendation.applicationToken;
    if (!applicationToken) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The recommendation application lease could not be acquired.');
    try {
      if (recommendation.type === 'reindex') {
        const source = await this.sourceModel.findById(recommendation.sourceId).lean().exec();
        const version = await this.versionModel.findById(recommendation.sourceVersionId).lean().exec();
        if (!source?.workspaceId || !version?.documentId) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The recommendation has no reindexable workspace document.');
        await this.indexing.reindexDocument(source.workspaceId.toString(), version.documentId.toString(), false, `knowledge-recommendation:${id}`);
      } else if (recommendation.type === 'schedule_review') {
        const applied = await this.applyReviewSchedule(recommendation.sourceId?.toString(), recommendation.sourceVersionId?.toString(), Number(recommendation.proposedAction?.reviewFrequencyDays ?? 30), actorId, programId, id, applicationToken);
        this.audit.logSuccess({ actorId, actorEmail, action: 'governance.knowledge.recommendation_applied', targetType: 'knowledge_recommendation', targetId: id, metadata: { programId, type: recommendation.type } }); return this.serialize(applied.toObject());
      } else {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This recommendation requires a dedicated human workflow and cannot be applied automatically.');
      }
      const applied = await this.recommendations.markApplied(id, actorId, applicationToken); if (!applied) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The recommendation changed while it was being applied.');
      this.audit.logSuccess({ actorId, actorEmail, action: 'governance.knowledge.recommendation_applied', targetType: 'knowledge_recommendation', targetId: id, metadata: { programId, type: recommendation.type } }); return this.serialize(applied.toObject());
    } catch (error) {
      await this.recommendations.releaseApplication(id, applicationToken);
      throw error;
    }
  }

  async decideMetadataCandidate(actorId: string, actorEmail: string, programId: string, id: string, action: 'accept' | 'reject', acceptedValue?: unknown, reason?: string) {
    this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId);
    if (action === 'reject') { const rejected = await this.metadataCandidates.decide(programId, id, actorId, action, scopeIds, undefined, reason); if (!rejected) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Only an accessible proposed metadata candidate can be decided.'); this.audit.logSuccess({ actorId, actorEmail, action: 'governance.knowledge.metadata_rejected', targetType: 'metadata_candidate', targetId: id, metadata: { programId } }); return this.serialize(rejected.toObject()); }
    const candidate = (await this.metadataCandidates.list(programId, scopeIds, 'proposed')).find((item) => item.id === id || item._id.toString() === id);
    if (!candidate) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Metadata candidate not found.');
    const session = await this.connection.startSession();
    try {
      let result: unknown;
      await session.withTransaction(async () => {
        const value = acceptedValue ?? candidate.proposedValue;
        const source = await this.sourceModel.findOneAndUpdate({ _id: candidate.sourceId, programId: new Types.ObjectId(programId), isArchived: { $ne: true }, $or: [{ currentCandidateVersionId: candidate.sourceVersionId }, { currentPublishedVersionId: candidate.sourceVersionId }] }, { $set: { [`metadata.${candidate.key}`]: value } }, { new: true, session }).exec();
        if (!source) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The source is no longer editable.');
        const accepted = await this.metadataCandidates.decide(programId, id, actorId, 'accept', scopeIds, value, reason, session);
        if (!accepted) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The metadata candidate changed while it was being accepted.');
        await this.events.append({ programId, sourceId: candidate.sourceId.toString(), versionId: candidate.sourceVersionId.toString(), eventType: 'metadata.candidate_decided', actorId, actorEmail, actorType: 'user', occurredAt: new Date(), metadata: { candidateId: id, key: candidate.key, action: 'accept' }, session });
        result = this.serialize(accepted.toObject());
      });
      return result;
    } finally { await session.endSession(); }
  }

  private async assess(programId: string, source: GovernanceSourceDocument | Record<string, unknown>, version: GovernanceSourceVersionDocument | Record<string, unknown>): Promise<void> {
    const context = this.context(source, version);
    const dimensions = {} as KnowledgeAssessmentDimensions;
    for (const evaluator of this.evaluators) dimensions[evaluator.key] = await evaluator.evaluate(context);
    const scores = Object.values(dimensions).map((item) => item.score);
    const overallHealthScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    const status = overallHealthScore >= 80 ? 'healthy' : overallHealthScore >= 50 ? 'warning' : 'critical';
    const inputHash = createHash('sha256').update(this.stableStringify({ source: context.source, version: context.version, assessmentVersion: ASSESSMENT_VERSION })).digest('hex');
    await this.assessments.upsert({ programId, scopeIds: context.source.scopeIds, sourceId: context.source.id, sourceVersionId: context.version.id, assessmentVersion: ASSESSMENT_VERSION, inputHash, assessedAt: context.now, dimensions, overallHealthScore, status, summary: `Knowledge health is ${status} with a score of ${overallHealthScore}.` });
    const alertInputs = this.alertEngine.build(context, dimensions).map((item) => ({ ...item, programId }));
    const alerts = await this.alerts.synchronize(context.version.id, alertInputs, context.now);
    const alertIds = alerts.map((item) => item._id.toString());
    const recommendationInputs = this.recommendationEngine.build(context, dimensions).map((item) => ({ ...item, programId, alertIds }));
    await this.recommendations.synchronize(context.version.id, recommendationInputs);
    await this.metadataCandidates.synchronize(context.version.id, this.metadataEngine.build(programId, context));
    await this.events.append({ programId, sourceId: context.source.id, versionId: context.version.id, eventType: 'knowledge.assessed', actorType: 'system', occurredAt: context.now, deduplicationKey: `knowledge-assessed:${context.version.id}:${inputHash}`, metadata: { assessmentVersion: ASSESSMENT_VERSION, inputHash, overallHealthScore, status } });
  }

  private context(sourceValue: GovernanceSourceDocument | Record<string, unknown>, versionValue: GovernanceSourceVersionDocument | Record<string, unknown>): KnowledgeAssessmentContext {
    const source = sourceValue as unknown as Record<string, unknown>; const version = versionValue as unknown as Record<string, unknown>; const validity = (version.validity ?? {}) as Record<string, unknown>;
    return { source: { id: String(source._id), title: String(source.title ?? ''), sourceType: String(source.sourceType ?? ''), status: String(source.status ?? ''), visibility: String(source.visibility ?? ''), scopeIds: Array.isArray(source.scopeIds) ? source.scopeIds.map(String) : [], ownerUserId: source.ownerUserId ? String(source.ownerUserId) : undefined, reviewFrequencyDays: typeof source.reviewFrequencyDays === 'number' ? source.reviewFrequencyDays : undefined, metadata: (source.metadata as Record<string, unknown>) ?? {} }, version: { id: String(version._id), lifecycleStatus: String(version.lifecycleStatus ?? ''), technicalStatus: String(version.technicalStatus ?? ''), contentHash: typeof version.contentHash === 'string' ? version.contentHash : undefined, documentId: version.documentId ? String(version.documentId) : undefined, canonicalUrl: typeof version.canonicalUrl === 'string' ? version.canonicalUrl : undefined, capturedAt: this.date(version.capturedAt) ?? new Date(0), extractedMetadata: (version.extractedMetadata as Record<string, unknown>) ?? {}, validity: { mode: String(validity.mode ?? 'unknown'), businessStatus: String(validity.businessStatus ?? 'unknown'), effectiveUntil: this.date(validity.effectiveUntil), lastReviewedAt: this.date(validity.lastReviewedAt), nextReviewAt: this.date(validity.nextReviewAt), reviewFrequencyDays: typeof validity.reviewFrequencyDays === 'number' ? validity.reviewFrequencyDays : undefined, evidence: Array.isArray(validity.evidence) ? validity.evidence : [] } }, now: new Date() };
  }

  private async authorizedScopeIds(actorId: string, programId: string, requestedScopeId?: string): Promise<string[]> { await this.programs.assertOwnedProgram(actorId, programId); if (requestedScopeId) { await this.access.assertScopeAccess(actorId, programId, requestedScopeId); return [requestedScopeId]; } return this.access.getAccessibleScopeIds(actorId, programId); }
  private async loadSources(programId: string, scopeIds: string[], requestedScopeId?: string): Promise<GovernanceSourceDocument[]> { const query: Record<string, unknown> = { programId: new Types.ObjectId(programId), isArchived: { $ne: true } }; if (!scopeIds.includes('*')) { const scoped = requestedScopeId ? [new Types.ObjectId(requestedScopeId)] : scopeIds.map((id) => new Types.ObjectId(id)); query.$or = [{ visibility: 'program_shared' }, { scopeIds: { $in: scoped } }]; } return this.sourceModel.find(query).sort({ updatedAt: -1 }).limit(500).exec(); }
  private assertEnabled(): void { if (!this.config.get<boolean>('dataRoom.knowledgeAssessmentEnabled')) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Knowledge assessment is disabled.'); }
  private date(value: unknown): Date | undefined { if (!value) return undefined; const result = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(result.getTime()) ? undefined : result; }
  private serialize(value: unknown): Record<string, unknown> { const input = value as Record<string, unknown>; const output: Record<string, unknown> = { ...input, id: String(input._id ?? input.id) }; delete output._id; delete output.__v; for (const key of ['programId', 'sourceId', 'sourceVersionId', 'decidedBy', 'appliedBy', 'acknowledgedBy']) if (output[key]) output[key] = String(output[key]); if (Array.isArray(output.scopeIds)) output.scopeIds = output.scopeIds.map(String); if (Array.isArray(output.alertIds)) output.alertIds = output.alertIds.map(String); return output; }
  private stableStringify(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (value instanceof Date) return JSON.stringify(value.toISOString()); if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(object[key])}`).join(',')}}`; }
  private async applyReviewSchedule(sourceId: string | undefined, versionId: string | undefined, days: number, actorId: string, programId: string, recommendationId: string, applicationToken: string): Promise<KnowledgeRecommendationDocument> { if (!sourceId || !versionId || !Number.isInteger(days) || days < 1 || days > 3650) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The review schedule is invalid.'); const session = await this.connection.startSession(); try { let applied: KnowledgeRecommendationDocument | null | undefined; await session.withTransaction(async () => { const sourceFence = await this.sourceModel.updateOne({ _id: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId), currentCandidateVersionId: new Types.ObjectId(versionId), isArchived: { $ne: true } }, { $inc: { knowledgeGovernanceRevision: 1 } }, { session }).exec(); if (sourceFence.modifiedCount !== 1) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Only the current candidate version can receive a review schedule.'); const nextReviewAt = new Date(Date.now() + days * 86_400_000); const updated = await this.versionModel.updateOne({ _id: new Types.ObjectId(versionId), sourceId: new Types.ObjectId(sourceId), lifecycleStatus: { $in: ['captured', 'to_review'] } }, { $set: { 'validity.nextReviewAt': nextReviewAt, 'validity.reviewFrequencyDays': days } }, { session }).exec(); if (updated.modifiedCount !== 1) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The source version is no longer eligible for scheduling.'); await this.events.append({ programId, sourceId, versionId, eventType: 'knowledge.recommendation_applied', actorId, actorType: 'user', occurredAt: new Date(), metadata: { type: 'schedule_review', days, nextReviewAt }, session }); applied = await this.recommendations.markApplied(recommendationId, actorId, applicationToken, session); if (!applied) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The recommendation changed while it was being applied.'); }); if (!applied) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The recommendation was not applied.'); return applied; } finally { await session.endSession(); } }
}
