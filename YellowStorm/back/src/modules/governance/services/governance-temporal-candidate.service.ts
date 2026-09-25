import { Inject, BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { KnowledgeExtractionOrchestratorService } from '@modules/knowledge-intelligence/services/knowledge-extraction-orchestrator.service';
import { TemporalCandidateRepositoryService } from '@modules/knowledge-intelligence/services/temporal-candidate-repository.service';
import { WorkspaceEvidenceSearchSettingsService } from '@modules/system/workspace-evidence-search-settings.service';
import { WORKSPACE_DOCUMENT_READ_PORT, type WorkspaceDocumentReadPort } from '@modules/workspace/ports';
import type { TemporalCandidate } from '../domain/temporal-candidate';
import type { DocumentValidity } from '../domain/document-validity';
import { GOVERNANCE_DOCUMENT_STORE, type GovernanceDocumentRecord, type GovernanceDocumentStore } from '../persistence';
import { GovernanceDocumentService } from './governance-document.service';
import { GovernanceDocumentEventService } from './governance-document-event.service';
import { TemporalCandidateValidatorService } from './temporal-candidate-validator.service';

@Injectable()
export class GovernanceTemporalCandidateService {
  constructor(
    private readonly documentService: GovernanceDocumentService,
    @Inject(GOVERNANCE_DOCUMENT_STORE) private readonly documentStore: GovernanceDocumentStore,
    @Inject(WORKSPACE_DOCUMENT_READ_PORT) private readonly workspaceDocuments: WorkspaceDocumentReadPort,
    private readonly jobs: KnowledgeExtractionOrchestratorService,
    private readonly records: TemporalCandidateRepositoryService,
    private readonly validator: TemporalCandidateValidatorService,
    private readonly events: GovernanceDocumentEventService,
    private readonly settings: WorkspaceEvidenceSearchSettingsService,
  ) {}

  async list(actorId: string, programId: string, documentId: string) { await this.documentService.findRecord(actorId, programId, documentId); return this.records.list(documentId); }
  async status(actorId: string, programId: string, documentId: string) { await this.documentService.findRecord(actorId, programId, documentId); const job = await this.jobs.latestForDocument(documentId); return job ? { id: job.id, jobType: job.jobType, status: job.status, attempts: job.attempts, error: job.error } : null; }

  async run(actorId: string, programId: string, documentId: string) {
    const governance = await this.documentService.findRecord(actorId, programId, documentId);
    const document = await this.workspaceDocuments.findOne({ id: governance.documentId, workspaceId: governance.workspaceId, isFolder: false });
    if (!document || document.indexingStatus !== 'ready') throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Only an indexed document can be analyzed.');
    const { connectorId } = await this.settings.getSettings();
    if (!connectorId) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Select an evidence-search connector before starting analysis.');
    const retried = await this.jobs.retryLatestFailedForDocument(documentId, connectorId, actorId);
    if (retried) return retried;
    const inputHash = createHash('sha256').update(JSON.stringify({ programId, documentId, contentHash: document.contentHash ?? null, indexingAttemptId: document.indexingAttemptId ?? null, connectorId })).digest('hex');
    return this.jobs.enqueue({ programId, documentId, connectorId, requestedByUserId: actorId, jobType: 'technical_metadata', inputHash, engineVersion: 'technical-metadata-v2' });
  }

  async decide(actorId: string, actorEmail: string, programId: string, documentId: string, recordId: string, input: { action: 'confirm' | 'correct' | 'reject'; correctedValue?: string; comment?: string }) {
    const governance = await this.documentService.findRecord(actorId, programId, documentId);
    if (['rejected', 'archived'].includes(governance.status)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This governed document cannot receive temporal decisions.');
    const record = await this.records.beginDecision(documentId, recordId);
    if (!record?.decisionToken) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This candidate was already decided or does not exist.');
    try {
      if (input.action === 'reject') return this.finishDecision(governance, recordId, record.decisionToken, actorId, actorEmail, programId, documentId, 'rejected', record.candidate, input.comment);
      const candidate: TemporalCandidate = input.action === 'correct' ? { ...record.candidate, value: record.candidate.field === 'validityMode' ? undefined : input.correctedValue, mode: record.candidate.field === 'validityMode' ? input.correctedValue as TemporalCandidate['mode'] : record.candidate.mode, confidence: 1, reasoningSummary: 'Corrected and confirmed by a reviewer.' } : record.candidate;
      const evidence = record.evidence.map((item) => ({ ...item, value: candidate.value ?? candidate.mode, validatedBy: actorId, validatedAt: new Date(), isCritical: candidate.criticality === 'high' }));
      const validation = this.validator.validate(candidate, { evidence, reviewFrequencyDays: (governance.validity as unknown as DocumentValidity).reviewFrequencyDays });
      if (validation.status === 'rejected' || validation.status === 'conflicting') throw new BadRequestException(ErrorCode.VALIDATION_ERROR, validation.issues.map((issue) => issue.message).join(' '));
      const previousValidity = governance.validity as unknown as DocumentValidity;
      const validity: DocumentValidity = { ...previousValidity, evidence: [...previousValidity.evidence, ...evidence], confidence: Math.max(previousValidity.confidence, candidate.confidence), manuallyOverridden: input.action === 'correct' || previousValidity.manuallyOverridden };
      if (candidate.field === 'effectiveFrom') validity.effectiveFrom = new Date(`${candidate.value}T00:00:00.000Z`);
      if (candidate.field === 'effectiveUntil') validity.effectiveUntil = new Date(`${candidate.value}T00:00:00.000Z`);
      if (candidate.field === 'validityMode' && candidate.mode) validity.mode = candidate.mode;
      const updated = await this.documentStore.updateGuarded(governance.id, { temporalDecisionRevision: governance.temporalDecisionRevision }, {
        set: { validity: validity as unknown as Record<string, unknown> },
        bumpGovernanceRevision: true,
        bumpTemporalDecisionRevision: true,
      });
      if (!updated) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Document validity changed concurrently.');
      return this.finishDecision(governance, recordId, record.decisionToken, actorId, actorEmail, programId, documentId, input.action === 'correct' ? 'corrected' : 'confirmed', candidate, input.comment, input.action === 'correct' ? candidate : undefined);
    } catch (error) { await this.records.releaseDecision(recordId, record.decisionToken); throw error; }
  }

  private async finishDecision(governance: GovernanceDocumentRecord, recordId: string, token: string, actorId: string, actorEmail: string, programId: string, documentId: string, status: 'confirmed' | 'corrected' | 'rejected', candidate: TemporalCandidate, comment?: string, corrected?: TemporalCandidate) {
    const result = await this.records.markDecision(recordId, token, actorId, status, comment, corrected);
    if (!result) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The candidate decision lease was lost.');
    await this.events.append({ programId, governanceDocumentId: governance.id, documentId, actorId, actorEmail, eventType: 'validity.candidate_decided', after: { candidateId: candidate.candidateId, field: candidate.field, value: candidate.value ?? candidate.mode, status }, deduplicationKey: `candidate-decision:${recordId}` });
    return result;
  }
}
