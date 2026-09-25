import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { createHash } from 'crypto';
import { KnowledgeExtractionOrchestratorService } from '@modules/knowledge-intelligence/services/knowledge-extraction-orchestrator.service';
import { TemporalCandidateRepositoryService } from '@modules/knowledge-intelligence/services/temporal-candidate-repository.service';
import type { KnowledgeExtractionJobRecord } from '@modules/knowledge-intelligence/knowledge-intelligence.types';
import { WORKSPACE_DOCUMENT_READ_PORT, type WorkspaceDocumentReadPort } from '@modules/workspace/ports';
import { GOVERNANCE_DOCUMENT_STORE, type GovernanceDocumentRecord, type GovernanceDocumentStore } from '../persistence';
import { LogicalSearchEvidenceService } from './logical-search-evidence.service';
import { TemporalCandidateExtractorService } from './temporal-candidate-extractor.service';
import { TemporalCandidateValidatorService } from './temporal-candidate-validator.service';

@Injectable()
export class GovernanceTemporalIntelligenceWorkerService {
  private readonly logger = new Logger(GovernanceTemporalIntelligenceWorkerService.name);
  private running = false;
  constructor(
    private readonly features: FeatureVisibilityService,
    private readonly jobs: KnowledgeExtractionOrchestratorService,
    private readonly records: TemporalCandidateRepositoryService,
    private readonly search: LogicalSearchEvidenceService,
    private readonly extractor: TemporalCandidateExtractorService,
    private readonly validator: TemporalCandidateValidatorService,
    @Inject(GOVERNANCE_DOCUMENT_STORE) private readonly documentStore: GovernanceDocumentStore,
    @Inject(WORKSPACE_DOCUMENT_READ_PORT) private readonly documents: WorkspaceDocumentReadPort,
  ) {}

  @Interval(5_000)
  async tick(): Promise<void> { if (this.running || !this.features.isEnabled('dataRoomValidityIntelligence')) return; this.running = true; try { const job = await this.jobs.claimNext(['technical_metadata', 'temporal_extraction']); if (job) await this.process(job); } finally { this.running = false; } }

  private async process(job: KnowledgeExtractionJobRecord): Promise<void> {
    const token = job.leaseToken;
    if (!token) throw new Error('Claimed extraction job has no lease token.');
    try {
      const governance = await this.findAvailableGovernanceDocument(job.programId.toString(), job.documentId.toString());
      const before = await this.documents.findOne({ id: job.documentId.toString(), isFolder: false, indexingStatus: 'ready' });
      if (!governance || !before || !job.requestedByUserId) throw new Error('The extraction target is no longer an available indexed governed document.');
      const identity = { contentHash: before.contentHash, indexingAttemptId: before.indexingAttemptId };
      if (job.jobType === 'technical_metadata') {
        if (!await this.jobs.heartbeat(job.id, token)) throw new Error('The extraction job lease was lost.');
        await this.jobs.enqueue({ programId: job.programId, documentId: job.documentId, connectorId: job.connectorId.toString(), requestedByUserId: job.requestedByUserId.toString(), jobType: 'temporal_extraction', inputHash: createHash('sha256').update(`${job.inputHash}:${before.originalName}`).digest('hex'), engineVersion: 'temporal-regex-v2' });
      } else {
        const rawEvidence = await this.search.search({ connectorId: job.connectorId.toString(), workspaceId: before.workspaceId, authorizationUserId: job.requestedByUserId.toString(), documentId: before.id, fileName: before.originalName });
        if (!await this.jobs.heartbeat(job.id, token)) throw new Error('The extraction job lease was lost.');
        const extracted = this.extractor.extract(rawEvidence);
        const validation = this.validator.validateSet(extracted.map((item) => item.candidate), { evidence: extracted.map((item) => item.evidence), reviewFrequencyDays: (governance.validity as { reviewFrequencyDays?: number }).reviewFrequencyDays });
        const after = await this.documents.findById(job.documentId.toString());
        if (!after || after.contentHash !== identity.contentHash || after.indexingAttemptId !== identity.indexingAttemptId) throw new Error('The workspace document changed during evidence extraction.');
        await this.records.upsertMany({ programId: job.programId, documentId: job.documentId, jobId: job.id, inputHash: job.inputHash, engineVersion: job.engineVersion, candidates: extracted.map((item, index) => ({ candidate: item.candidate, validation: validation[index], evidence: [item.evidence] })) });
      }
      if (!await this.jobs.markCompleted(job.id, token)) throw new Error('The extraction job lease was lost before completion.');
    } catch (error) { const message = error instanceof Error ? error.message : 'Unknown temporal extraction failure'; this.logger.warn(`Temporal extraction job ${job.id} failed: ${message}`); await this.jobs.markFailed(job.id, token, message, job.attempts); }
  }

  private async findAvailableGovernanceDocument(programId: string, documentId: string): Promise<GovernanceDocumentRecord | null> {
    const record = await this.documentStore.findByProgramAndDocumentId(programId, documentId);
    if (!record || ['rejected', 'archived'].includes(record.status)) return null;
    return record;
  }
}
