import { createHash } from 'crypto';
import { Inject, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { IndexingService } from '@modules/indexing/indexing.service';
import { WORKSPACE_DOCUMENT_READ_PORT, type WorkspaceDocumentReadPort, type WorkspaceDocumentRecord } from '@modules/workspace/ports';
import type { KnowledgeAssessmentContext, KnowledgeAssessmentDimensions, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { KnowledgeAssessmentRepositoryService } from '@modules/knowledge-intelligence/services/knowledge-assessment-repository.service';
import { KnowledgeAlertRepositoryService } from '@modules/knowledge-intelligence/services/knowledge-alert-repository.service';
import { KnowledgeRecommendationRepositoryService } from '@modules/knowledge-intelligence/services/knowledge-recommendation-repository.service';
import { MetadataCandidateRepositoryService } from '@modules/knowledge-intelligence/services/metadata-candidate-repository.service';
import {
  BINDING_STORE,
  GOVERNANCE_DOCUMENT_STORE,
  type BindingStore,
  type GovernanceBindingRecord,
  type GovernanceDocumentRecord,
  type GovernanceDocumentStore,
} from '../persistence';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceDocumentEventService } from './governance-document-event.service';
import { KnowledgeAlertEngineService } from './knowledge-alert-engine.service';
import { KnowledgeRecommendationEngineService } from './knowledge-recommendation-engine.service';
import { MetadataCandidateEngineService } from './metadata-candidate-engine.service';
import { BusinessValidityEvaluator } from './knowledge-evaluators/business-validity.evaluator';
import { FreshnessEvaluator } from './knowledge-evaluators/freshness.evaluator';
import { AvailabilityEvaluator } from './knowledge-evaluators/availability.evaluator';
import { IntegrityEvaluator } from './knowledge-evaluators/integrity.evaluator';
import { SearchQualityEvaluator } from './knowledge-evaluators/search-quality.evaluator';
import { GovernanceQualityEvaluator } from './knowledge-evaluators/governance-quality.evaluator';

const ASSESSMENT_VERSION = 'knowledge-health-v2';

@Injectable()
export class GovernanceKnowledgeAssessmentService {
  private readonly logger = new Logger(GovernanceKnowledgeAssessmentService.name);
  private running = false;
  private readonly evaluators: KnowledgeEvaluator[];

  constructor(
    @Inject(GOVERNANCE_DOCUMENT_STORE) private readonly documentStore: GovernanceDocumentStore,
    @Inject(WORKSPACE_DOCUMENT_READ_PORT) private readonly workspaceDocuments: WorkspaceDocumentReadPort,
    @Inject(BINDING_STORE) private readonly bindingStore: BindingStore,
    private readonly programs: GovernanceProgramService,
    private readonly access: GovernanceAccessService,
    private readonly assessments: KnowledgeAssessmentRepositoryService,
    private readonly alerts: KnowledgeAlertRepositoryService,
    private readonly recommendations: KnowledgeRecommendationRepositoryService,
    private readonly metadataCandidates: MetadataCandidateRepositoryService,
    private readonly alertEngine: KnowledgeAlertEngineService,
    private readonly recommendationEngine: KnowledgeRecommendationEngineService,
    private readonly metadataEngine: MetadataCandidateEngineService,
    businessValidity: BusinessValidityEvaluator,
    freshness: FreshnessEvaluator,
    availability: AvailabilityEvaluator,
    integrity: IntegrityEvaluator,
    searchQuality: SearchQualityEvaluator,
    governanceQuality: GovernanceQualityEvaluator,
    private readonly events: GovernanceDocumentEventService,
    private readonly audit: AuditLogService,
    private readonly indexing: IndexingService,
    private readonly features: FeatureVisibilityService,
  ) { this.evaluators = [businessValidity, freshness, availability, integrity, searchQuality, governanceQuality]; }

  @Interval(300_000)
  async assessCurrentDocuments(): Promise<void> {
    if (this.running || !this.features.isEnabled('dataRoomKnowledgeAssessment')) return;
    this.running = true;
    try {
      const records = await this.documentStore.listNonArchived(200);
      for (const record of records) await this.assess(record);
    } catch (error) {
      this.logger.error('Knowledge assessment backfill failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    } finally { this.running = false; }
  }

  async refresh(actorId: string, actorEmail: string, programId: string, scopeId?: string): Promise<{ assessed: number }> {
    this.assertEnabled();
    const scopeIds = await this.authorizedScopeIds(actorId, programId, scopeId);
    const bindings = await this.effectiveBindings(programId, scopeIds, scopeId);
    const workspaceIds = bindings.map((binding) => binding.workspaceId);
    const records = workspaceIds.length ? await this.documentStore.listForProgramWorkspaces(programId, workspaceIds, false) : [];
    const capped = records.slice(0, 500).filter((record) => !['rejected', 'archived'].includes(record.status));
    for (const record of capped) await this.assess(record, bindings.find((binding) => binding.workspaceId === record.workspaceId));
    this.audit.logSuccess({ actorId, actorEmail, action: 'governance.knowledge.refreshed', targetType: 'governance_program', targetId: programId, metadata: { scopeId, assessed: capped.length } });
    return { assessed: capped.length };
  }

  async healthSummary(actorId: string, programId: string, scopeId?: string) { this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId, scopeId); const records = await this.assessments.latestByProgram(programId, scopeId ? [scopeId] : scopeIds); const byStatus = { healthy: 0, warning: 0, critical: 0 }; for (const record of records) byStatus[record.status] += 1; return { totalDocuments: records.length, averageHealthScore: records.length ? Math.round(records.reduce((sum, item) => sum + item.overallHealthScore, 0) / records.length) : 0, byStatus, assessments: records.map((record) => this.serialize(record)) }; }
  async listAlerts(actorId: string, programId: string, query: { scopeId?: string; status?: 'open' | 'acknowledged' | 'resolved' | 'ignored'; category?: 'validity' | 'freshness' | 'availability' | 'integrity' | 'governance' | 'search_quality' | 'impact'; severity?: 'critical' | 'high' | 'medium' | 'low' }) { this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId, query.scopeId); return (await this.alerts.list(programId, { ...query, scopeIds: query.scopeId ? [query.scopeId] : scopeIds })).map((item) => this.serialize(item)); }
  async listRecommendations(actorId: string, programId: string, query: { scopeId?: string; status?: 'proposed' | 'accepted' | 'rejected' | 'applied' | 'superseded'; priority?: 'critical' | 'high' | 'medium' | 'low' }) { this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId, query.scopeId); return (await this.recommendations.list(programId, { ...query, scopeIds: query.scopeId ? [query.scopeId] : scopeIds })).map((item) => this.serialize(item)); }
  async listMetadataCandidates(actorId: string, programId: string, scopeId?: string, status?: 'proposed' | 'accepted' | 'rejected' | 'superseded') { this.assertEnabled(); const scopeIds = await this.authorizedScopeIds(actorId, programId, scopeId); return (await this.metadataCandidates.list(programId, scopeId ? [scopeId] : scopeIds, status)).map((item) => this.serialize(item)); }
  async acknowledgeAlert(actorId: string, actorEmail: string, programId: string, alertId: string) { const scopes = await this.authorizedScopeIds(actorId, programId); const result = await this.alerts.acknowledge(programId, alertId, actorId, scopes); if (!result) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Only an accessible open alert can be acknowledged.'); this.audit.logSuccess({ actorId, actorEmail, action: 'governance.knowledge.alert_acknowledged', targetType: 'knowledge_alert', targetId: alertId }); return this.serialize(result); }
  async decideRecommendation(actorId: string, actorEmail: string, programId: string, id: string, action: 'accept' | 'reject', reason?: string) { const scopes = await this.authorizedScopeIds(actorId, programId); const result = await this.recommendations.decide(programId, id, actorId, action, scopes, reason); if (!result) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Only an accessible proposed recommendation can be decided.'); this.audit.logSuccess({ actorId, actorEmail, action: `governance.knowledge.recommendation_${action}ed`, targetType: 'knowledge_recommendation', targetId: id }); return this.serialize(result); }

  async applyRecommendation(actorId: string, actorEmail: string, programId: string, id: string) {
    const scopes = await this.authorizedScopeIds(actorId, programId);
    const recommendation = await this.recommendations.beginApply(programId, id, scopes);
    if (!recommendation?.applicationToken || !recommendation.documentId) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Accept an accessible document recommendation before applying it.');
    try {
      const document = await this.workspaceDocuments.findById(recommendation.documentId.toString());
      if (!document) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
      if (recommendation.type === 'reindex') await this.indexing.reindexDocument(document.workspaceId, document.id, false, `knowledge-recommendation:${id}`);
      else if (recommendation.type === 'schedule_review') await this.documentStore.patchValidityForDocument(programId, document.id, { nextReviewAt: new Date(Date.now() + Number(recommendation.proposedAction?.reviewFrequencyDays ?? 30) * 86_400_000), reviewFrequencyDays: Number(recommendation.proposedAction?.reviewFrequencyDays ?? 30) });
      else throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This recommendation requires a dedicated human workflow.');
      const applied = await this.recommendations.markApplied(id, actorId, recommendation.applicationToken);
      if (!applied) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The recommendation changed while it was being applied.');
      this.audit.logSuccess({ actorId, actorEmail, action: 'governance.knowledge.recommendation_applied', targetType: 'knowledge_recommendation', targetId: id });
      return this.serialize(applied);
    } catch (error) { await this.recommendations.releaseApplication(id, recommendation.applicationToken); throw error; }
  }

  async decideMetadataCandidate(actorId: string, actorEmail: string, programId: string, id: string, action: 'accept' | 'reject', acceptedValue?: unknown, reason?: string) {
    const scopes = await this.authorizedScopeIds(actorId, programId);
    const candidate = (await this.metadataCandidates.list(programId, scopes, 'proposed')).find((item) => item.id === id);
    if (!candidate) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Metadata candidate not found.');
    const value = acceptedValue ?? candidate.proposedValue;
    if (action === 'accept') {
      const updated = await this.documentStore.setMetadataField(programId, candidate.documentId.toString(), candidate.key, value);
      if (!updated) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The governed document is no longer editable.');
      await this.events.append({ programId, governanceDocumentId: updated.id, documentId: candidate.documentId.toString(), eventType: 'metadata.candidate_decided', actorId, actorEmail, metadata: { candidateId: id, key: candidate.key, action } });
    }
    const result = await this.metadataCandidates.decide(programId, id, actorId, action, scopes, action === 'accept' ? value : undefined, reason);
    if (!result) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The metadata candidate changed while it was being decided.');
    return this.serialize(result);
  }

  private async assess(record: GovernanceDocumentRecord, bindingInput?: GovernanceBindingRecord): Promise<void> {
    const document = await this.workspaceDocuments.findOne({ id: record.documentId, workspaceId: record.workspaceId, isFolder: false });
    if (!document) return;
    const binding = bindingInput ?? (await this.bindingStore.listEnabledForWorkspace(record.workspaceId)).find((candidate) => candidate.programId === record.programId && candidate.enabled);
    if (!binding) return;
    const context = this.context(document, record, binding);
    const dimensions = {} as KnowledgeAssessmentDimensions;
    for (const evaluator of this.evaluators) dimensions[evaluator.key] = await evaluator.evaluate(context);
    const scores = Object.values(dimensions).map((item) => item.score);
    const overallHealthScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    const status = overallHealthScore >= 80 ? 'healthy' : overallHealthScore >= 50 ? 'warning' : 'critical';
    const inputHash = createHash('sha256').update(this.stableStringify({ document: context.document, governance: context.governance, binding: context.binding, assessmentVersion: ASSESSMENT_VERSION })).digest('hex');
    await this.assessments.upsert({ programId: record.programId, scopeIds: context.binding.scopeIds, documentId: context.document.id, assessmentVersion: ASSESSMENT_VERSION, inputHash, assessedAt: context.now, dimensions, overallHealthScore, status, summary: `Knowledge health is ${status} with a score of ${overallHealthScore}.` });
    const alerts = await this.alerts.synchronize(document.id, this.alertEngine.build(context, dimensions).map((item) => ({ ...item, programId: record.programId })), context.now);
    await this.recommendations.synchronize(document.id, this.recommendationEngine.build(context, dimensions).map((item) => ({ ...item, programId: record.programId, alertIds: alerts.map((alert) => alert.id) })));
    await this.metadataCandidates.synchronize(document.id, this.metadataEngine.build(record.programId, context));
    await this.events.append({ programId: record.programId, governanceDocumentId: record.id, documentId: document.id, eventType: 'knowledge.assessed', deduplicationKey: `knowledge-assessed:${inputHash}`, metadata: { assessmentVersion: ASSESSMENT_VERSION, overallHealthScore, status } });
  }

  private context(document: WorkspaceDocumentRecord, governance: GovernanceDocumentRecord, binding: GovernanceBindingRecord): KnowledgeAssessmentContext {
    const validity = governance.validity as KnowledgeAssessmentContext['governance']['validity'];
    return { document: { id: document.id, workspaceId: document.workspaceId, originalName: document.originalName, mimeType: document.mimeType, type: document.type, sourceUrl: document.sourceUrl, contentHash: document.contentHash, status: document.status, indexingStatus: document.indexingStatus, updatedAt: this.date(document.updatedAt) ?? new Date(0), metadata: (document.metadata as Record<string, unknown>) ?? {} }, governance: { status: governance.status, validity, tags: governance.tags, metadata: governance.metadata, ownerUserId: governance.ownerUserId, ownerScopeId: governance.ownerScopeId }, binding: { visibility: binding.visibility, scopeIds: binding.scopeIds, ingestionMode: binding.ingestionMode }, now: new Date() };
  }

  private async effectiveBindings(programId: string, scopeIds: string[], requested?: string): Promise<GovernanceBindingRecord[]> { return this.bindingStore.listEnabled(programId, scopeIds.includes('*') ? '*' : requested ? [requested] : scopeIds); }
  private async authorizedScopeIds(actorId: string, programId: string, requested?: string): Promise<string[]> { await this.programs.assertOwnedProgram(actorId, programId); if (requested) { await this.access.assertScopeAccess(actorId, programId, requested); return [requested]; } return this.access.getAccessibleScopeIds(actorId, programId); }
  private assertEnabled(): void { if (!this.features.isEnabled('dataRoomKnowledgeAssessment')) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Knowledge assessment is disabled.'); }
  private date(value: unknown): Date | undefined { if (!value) return undefined; const date = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(date.getTime()) ? undefined : date; }
  private serialize(value: unknown): Record<string, unknown> { const input = value as Record<string, unknown>; const output: Record<string, unknown> = { ...input, id: String(input._id ?? input.id) }; delete output._id; delete output.__v; for (const key of ['programId', 'documentId', 'decidedBy', 'appliedBy', 'acknowledgedBy']) if (output[key]) output[key] = String(output[key]); if (Array.isArray(output.scopeIds)) output.scopeIds = output.scopeIds.map(String); if (Array.isArray(output.alertIds)) output.alertIds = output.alertIds.map(String); return output; }
  private stableStringify(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (value instanceof Date) return JSON.stringify(value.toISOString()); if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(object[key])}`).join(',')}}`; }
}
