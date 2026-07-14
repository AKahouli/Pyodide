import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { KnowledgeExtractionOrchestratorService } from '@modules/knowledge-intelligence/services/knowledge-extraction-orchestrator.service';
import { TemporalCandidateRepositoryService } from '@modules/knowledge-intelligence/services/temporal-candidate-repository.service';
import type { TemporalCandidate } from '../domain/temporal-candidate';
import type { SourceValidity } from '../domain/source-validity';
import { GovernanceSourceService } from './governance-source.service';
import { GovernanceSourceVersionService } from './governance-source-version.service';
import { GovernanceSourceEventService } from './governance-source-event.service';
import { TemporalCandidateValidatorService } from './temporal-candidate-validator.service';
import { WorkspaceEvidenceSearchSettingsService } from '@modules/system/workspace-evidence-search-settings.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class GovernanceTemporalCandidateService {
  constructor(private readonly sources: GovernanceSourceService, private readonly versions: GovernanceSourceVersionService, private readonly jobs: KnowledgeExtractionOrchestratorService, private readonly records: TemporalCandidateRepositoryService, private readonly validator: TemporalCandidateValidatorService, private readonly events: GovernanceSourceEventService, private readonly settings: WorkspaceEvidenceSearchSettingsService, @InjectConnection() private readonly connection: Connection) {}

  async list(actorId: string, programId: string, sourceId: string, versionId: string) { await this.sources.findById(actorId, programId, sourceId); await this.versions.find(sourceId, versionId); return this.records.list(versionId); }
  async status(actorId: string, programId: string, sourceId: string, versionId: string) { await this.sources.findById(actorId, programId, sourceId); await this.versions.find(sourceId, versionId); const job = await this.jobs.latestForVersion(versionId); return job ? { id: job._id.toString(), jobType: job.jobType, status: job.status, attempts: job.attempts, error: job.error } : null; }

  async run(actorId: string, programId: string, sourceId: string, versionId: string) {
    await this.sources.findById(actorId, programId, sourceId); const version = await this.versions.assertCandidateDecisionAllowed(sourceId, versionId);
    if (version.technicalStatus !== 'ready') throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Only a ready source version can be analyzed.');
    const { connectorId } = await this.settings.getSettings();
    if (!connectorId) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Select an evidence-search connector before starting analysis.');
    const inputHash = createHash('sha256').update(JSON.stringify({ versionId, contentHash: version.contentHash ?? null, indexingAttemptId: version.indexingAttemptId ?? null, connectorId })).digest('hex');
    return this.jobs.enqueue({ programId, sourceId, sourceVersionId: versionId, connectorId, jobType: 'technical_metadata', inputHash, engineVersion: 'technical-metadata-v1' });
  }

  async decide(actorId: string, actorEmail: string, programId: string, sourceId: string, versionId: string, recordId: string, input: { action: 'confirm' | 'correct' | 'reject'; correctedValue?: string; comment?: string }) {
    await this.sources.findById(actorId, programId, sourceId); const version = await this.versions.assertCandidateDecisionAllowed(sourceId, versionId); const record = await this.records.beginDecision(versionId, recordId);
    if (!record) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This candidate was already decided or does not exist.');
    const decisionToken = record.decisionToken;
    if (!decisionToken) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The candidate decision could not be claimed.');
    const session = await this.connection.startSession();
    try {
      if (input.action === 'reject') { let decided = null; await session.withTransaction(async () => { if (!await this.records.ownsDecision(recordId, decisionToken, session)) throw new Error('The candidate decision lease was lost.'); await this.versions.assertCandidateDecisionAllowed(sourceId, versionId, session); await this.versions.fenceCandidateDecision(sourceId, versionId, session); decided = await this.records.markDecision(recordId, decisionToken, actorId, 'rejected', input.comment, undefined, session); if (!decided) throw new Error('The candidate decision lease was lost.'); await this.appendEvent(actorId, actorEmail, programId, sourceId, versionId, recordId, 'rejected', record.candidate, session); }); return decided; }
      const candidate: TemporalCandidate = input.action === 'correct' ? { ...record.candidate, value: record.candidate.field === 'validityMode' ? undefined : input.correctedValue, mode: record.candidate.field === 'validityMode' ? input.correctedValue as TemporalCandidate['mode'] : record.candidate.mode, confidence: 1, reasoningSummary: 'Corrected and confirmed by a reviewer.' } : record.candidate;
    const evidence = record.evidence.map((item) => ({ ...item, value: candidate.value ?? candidate.mode, validatedBy: actorId, validatedAt: new Date(), isCritical: candidate.criticality === 'high' }));
    const result = this.validator.validate(candidate, { evidence, reviewFrequencyDays: version.validity.reviewFrequencyDays });
    if (result.status === 'rejected' || result.status === 'conflicting') throw new BadRequestException(ErrorCode.VALIDATION_ERROR, result.issues.map((issue) => issue.message).join(' '));
    const patch: Partial<SourceValidity> = { evidence: [...version.validity.evidence, ...evidence], confidence: Math.max(version.validity.confidence, candidate.confidence), manuallyOverridden: input.action === 'correct' || version.validity.manuallyOverridden };
    if (candidate.field === 'effectiveFrom') patch.effectiveFrom = new Date(`${candidate.value}T00:00:00.000Z`); if (candidate.field === 'effectiveUntil') patch.effectiveUntil = new Date(`${candidate.value}T00:00:00.000Z`); if (candidate.field === 'validityMode') patch.mode = candidate.mode;
      const status = input.action === 'correct' ? 'corrected' : 'confirmed'; let decided = null;
      await session.withTransaction(async () => { if (!await this.records.ownsDecision(recordId, decisionToken, session)) throw new Error('The candidate decision lease was lost.'); await this.versions.assertCandidateDecisionAllowed(sourceId, versionId, session); await this.versions.fenceCandidateDecision(sourceId, versionId, session); await this.versions.updateValidity(actorId, programId, sourceId, versionId, patch, session); decided = await this.records.markDecision(recordId, decisionToken, actorId, status, input.comment, input.action === 'correct' ? candidate : undefined, session); if (!decided) throw new Error('The candidate decision lease was lost.'); await this.appendEvent(actorId, actorEmail, programId, sourceId, versionId, recordId, status, candidate, session); }); return decided;
    } catch (error) { await this.records.releaseDecision(recordId, decisionToken); throw error; } finally { await session.endSession(); }
  }

  private async appendEvent(actorId: string, actorEmail: string, programId: string, sourceId: string, versionId: string, recordId: string, status: string, candidate: TemporalCandidate, session: import('mongoose').ClientSession) { await this.events.append({ programId, sourceId, versionId, actorId, actorEmail, eventType: 'validity.candidate_decided', after: { candidateId: candidate.candidateId, field: candidate.field, value: candidate.value ?? candidate.mode, status }, deduplicationKey: `candidate-decision:${recordId}`, session }); }
}
