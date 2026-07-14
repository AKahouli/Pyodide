import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import { KnowledgeExtractionOrchestratorService } from '@modules/knowledge-intelligence/services/knowledge-extraction-orchestrator.service';
import { TemporalCandidateRepositoryService } from '@modules/knowledge-intelligence/services/temporal-candidate-repository.service';
import type { KnowledgeExtractionJobDocument } from '@modules/knowledge-intelligence/schemas/knowledge-extraction-job.schema';
import { WorkspaceDoc, WorkspaceDocumentDoc } from '@modules/workspace/schemas/workspace-document.schema';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument } from '../schemas/governance-source-version.schema';
import { LogicalSearchEvidenceService } from './logical-search-evidence.service';
import { TemporalCandidateExtractorService } from './temporal-candidate-extractor.service';
import { TemporalCandidateValidatorService } from './temporal-candidate-validator.service';

@Injectable()
export class GovernanceTemporalIntelligenceWorkerService {
  private readonly logger = new Logger(GovernanceTemporalIntelligenceWorkerService.name);
  private running = false;
  constructor(
    private readonly config: ConfigService,
    private readonly jobs: KnowledgeExtractionOrchestratorService,
    private readonly records: TemporalCandidateRepositoryService,
    private readonly search: LogicalSearchEvidenceService,
    private readonly extractor: TemporalCandidateExtractorService,
    private readonly validator: TemporalCandidateValidatorService,
    @InjectModel(GovernanceSource.name) private readonly sources: Model<GovernanceSourceDocument>,
    @InjectModel(GovernanceSourceVersion.name) private readonly versions: Model<GovernanceSourceVersionDocument>,
    @InjectModel(WorkspaceDoc.name) private readonly documents: Model<WorkspaceDocumentDoc>,
  ) {}

  @Interval(5_000)
  async tick(): Promise<void> {
    if (this.running || !this.config.get<boolean>('dataRoom.validityIntelligenceEnabled')) return;
    this.running = true;
    try {
      const job = await this.jobs.claimNext(['technical_metadata', 'temporal_extraction']);
      if (job) await this.process(job);
    } finally { this.running = false; }
  }

  private async process(job: KnowledgeExtractionJobDocument): Promise<void> {
    const leaseToken = job.leaseToken;
    if (!leaseToken) throw new Error('Claimed extraction job has no lease token.');
    try {
      const version = await this.versions.findById(job.sourceVersionId).exec();
      const source = await this.sources.findById(job.sourceId).exec();
      if (!version || !source || source.isArchived || source.currentCandidateVersionId?.toString() !== version._id.toString() || version.technicalStatus !== 'ready' || ['rejected', 'superseded'].includes(version.lifecycleStatus)) throw new Error('The extraction target is no longer the current ready source version.');
      if (!version.workspaceId || !version.documentId) throw new Error('The source version is not bound to a workspace document.');
      const document = await this.documents.findOne({ _id: version.documentId, workspaceId: version.workspaceId }).lean().exec();
      this.assertIdentity(version, document);
      if (job.jobType === 'technical_metadata') {
        if (!await this.jobs.heartbeat(job._id.toString(), leaseToken)) throw new Error('The extraction job lease was lost.');
        version.extractedMetadata = { ...version.extractedMetadata, fileName: document.originalName, mimeType: document.mimeType, fileSize: document.size, technicalMetadataExtractedAt: new Date() };
        await version.save();
        await this.jobs.enqueue({ programId: job.programId.toString(), sourceId: job.sourceId.toString(), sourceVersionId: job.sourceVersionId.toString(), connectorId: job.connectorId.toString(), jobType: 'temporal_extraction', inputHash: createHash('sha256').update(`${job.inputHash}:${document.originalName}`).digest('hex'), engineVersion: 'temporal-regex-v1' });
      } else {
        const rawEvidence = await this.search.search({ connectorId: job.connectorId.toString(), workspaceId: version.workspaceId.toString(), documentId: version.documentId.toString(), sourceVersionId: version._id.toString(), fileName: document.originalName });
        if (!await this.jobs.heartbeat(job._id.toString(), leaseToken)) throw new Error('The extraction job lease was lost.');
        const extracted = this.extractor.extract(rawEvidence);
        const validation = this.validator.validateSet(extracted.map((item) => item.candidate), { evidence: extracted.map((item) => item.evidence), reviewFrequencyDays: version.validity.reviewFrequencyDays });
        const afterSearch = await this.documents.findById(version.documentId).lean().exec();
        this.assertIdentity(version, afterSearch);
        await this.records.upsertMany({ programId: job.programId.toString(), sourceId: job.sourceId.toString(), sourceVersionId: job.sourceVersionId.toString(), jobId: job._id.toString(), inputHash: job.inputHash, engineVersion: job.engineVersion, candidates: extracted.map((item, index) => ({ candidate: item.candidate, validation: validation[index], evidence: [item.evidence] })) });
      }
      if (!await this.jobs.markCompleted(job._id.toString(), leaseToken)) throw new Error('The extraction job lease was lost before completion.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown temporal extraction failure';
      this.logger.warn(`Temporal extraction job ${job._id.toString()} failed: ${message}`);
      await this.jobs.markFailed(job._id.toString(), leaseToken, message, job.attempts);
    }
  }

  private assertIdentity(version: GovernanceSourceVersionDocument, document: Pick<WorkspaceDoc, 'contentHash' | 'indexingAttemptId'> | null): asserts document is WorkspaceDoc {
    if (!document) throw new Error('The workspace document no longer exists.');
    if (version.contentHash && document.contentHash !== version.contentHash) throw new Error('The workspace document content changed during evidence extraction.');
    if (version.indexingAttemptId && document.indexingAttemptId !== version.indexingAttemptId) throw new Error('The workspace indexing attempt changed during evidence extraction.');
  }
}
