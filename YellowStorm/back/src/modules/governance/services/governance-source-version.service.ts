import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { DEFAULT_UNKNOWN_VALIDITY, type SourceValidity } from '../domain/source-validity';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument, type GovernanceSourceVersionTechnicalStatus } from '../schemas/governance-source-version.schema';
import { GovernanceSourceEventService } from './governance-source-event.service';
import type { CreateGovernanceSourceVersionDto } from '../dto/create-governance-source-version.dto';
import { SourceValidityCalculatorService } from './source-validity-calculator.service';

@Injectable()
export class GovernanceSourceVersionService {
  constructor(@InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>, @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>, private readonly events: GovernanceSourceEventService, private readonly validityCalculator: SourceValidityCalculatorService) {}
  async create(actorId: string, programId: string, sourceId: string, dto: CreateGovernanceSourceVersionDto, originEventId?: string): Promise<GovernanceSourceVersionDocument> {
    if (originEventId) { const existing = await this.versionModel.findOne({ originEventId }).exec(); if (existing) return existing; }
    const source = await this.sourceModel.findOneAndUpdate({ _id: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId), isArchived: { $ne: true } }, { $inc: { versionSequence: 1 } }, { new: true }).exec();
    if (!source) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    const initialValidity: SourceValidity = { ...DEFAULT_UNKNOWN_VALIDITY, ...dto.initialValidity, effectiveFrom: this.asDate(dto.initialValidity?.effectiveFrom), effectiveUntil: this.asDate(dto.initialValidity?.effectiveUntil), lastReviewedAt: this.asDate(dto.initialValidity?.lastReviewedAt), nextReviewAt: this.asDate(dto.initialValidity?.nextReviewAt), evidence: dto.initialValidity?.evidence ?? [] };
    initialValidity.nextReviewAt = this.validityCalculator.computeNextReviewAt(initialValidity);
    initialValidity.businessStatus = this.validityCalculator.computeBusinessStatus(initialValidity, new Date());
    this.validityCalculator.assertValid(initialValidity);
    const version = await this.versionModel.create({ programId: source.programId, sourceId: source._id, versionNumber: source.versionSequence, workspaceId: dto.workspaceId ? new Types.ObjectId(dto.workspaceId) : undefined, documentId: dto.documentId ? new Types.ObjectId(dto.documentId) : undefined, canonicalUrl: dto.canonicalUrl, contentHash: dto.contentHash, capturedAt: new Date(), validity: initialValidity, extractedMetadata: dto.extractedMetadata ?? {}, createdBy: new Types.ObjectId(actorId), originEventId });
    source.currentCandidateVersionId = version._id;
    await source.save();
    await this.events.append({ programId, sourceId, versionId: version._id.toString(), actorId, eventType: 'version.captured' });
    return version;
  }
  async list(sourceId: string): Promise<GovernanceSourceVersionDocument[]> { return this.versionModel.find({ sourceId: new Types.ObjectId(sourceId) }).sort({ versionNumber: -1 }).exec(); }
  async find(sourceId: string, versionId: string): Promise<GovernanceSourceVersionDocument> { const version = await this.versionModel.findOne({ _id: new Types.ObjectId(versionId), sourceId: new Types.ObjectId(sourceId) }).exec(); if (!version) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND); return version; }
  async assertCandidateDecisionAllowed(sourceId: string, versionId: string, session?: ClientSession): Promise<GovernanceSourceVersionDocument> { const versionQuery = this.versionModel.findOne({ _id: new Types.ObjectId(versionId), sourceId: new Types.ObjectId(sourceId) }); const sourceQuery = this.sourceModel.findById(sourceId).select('currentCandidateVersionId isArchived'); if (session) { versionQuery.session(session); sourceQuery.session(session); } const [version, source] = await Promise.all([versionQuery.exec(), sourceQuery.lean().exec()]); if (!version || !source || source.isArchived || source.currentCandidateVersionId?.toString() !== versionId || !['captured', 'to_review'].includes(version.lifecycleStatus)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Candidate decisions are only allowed on the current editable source version.'); return version; }
  async fenceCandidateDecision(sourceId: string, versionId: string, session: ClientSession): Promise<void> { const result = await this.sourceModel.updateOne({ _id: new Types.ObjectId(sourceId), currentCandidateVersionId: new Types.ObjectId(versionId), isArchived: { $ne: true } }, { $inc: { temporalDecisionRevision: 1 } }, { session }).exec(); if (result.modifiedCount !== 1) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The source changed while the candidate decision was being applied.'); }
  async updateTechnicalStatus(programId: string, sourceId: string, versionId: string, status: GovernanceSourceVersionTechnicalStatus, eventId?: string, eventAt = new Date(), indexingAttemptId?: string): Promise<GovernanceSourceVersionDocument> {
    const version = await this.find(sourceId, versionId);
    if (version.lastIntegrationEventAt && version.lastIntegrationEventAt > eventAt) return version;

    if (indexingAttemptId && version.indexingAttemptId !== indexingAttemptId) {
      // A terminal event for an attempt we never started is stale or incomplete.
      if (status !== 'pending' && status !== 'processing') return version;
      version.indexingAttemptId = indexingAttemptId;
      version.technicalStatus = 'pending';
      version.indexingStartedAt = eventAt;
      version.indexingCompletedAt = undefined;
    }

    const allowed: Record<GovernanceSourceVersionTechnicalStatus, GovernanceSourceVersionTechnicalStatus[]> = {
      pending: ['processing'], processing: ['ready', 'failed'], ready: [], failed: [],
    };
    if (version.technicalStatus === status) return version;
    if (!allowed[version.technicalStatus].includes(status)) return version;

    const before = version.technicalStatus;
    version.technicalStatus = status;
    version.lastIntegrationEventId = eventId;
    version.lastIntegrationEventAt = eventAt;
    if (status === 'processing') version.indexingStartedAt = eventAt;
    if (status === 'ready' || status === 'failed') version.indexingCompletedAt = eventAt;
    await version.save();
    await this.events.append({ programId, sourceId, versionId, eventType: 'version.technical_status_changed', before: { technicalStatus: before }, after: { technicalStatus: status, indexingAttemptId: version.indexingAttemptId }, occurredAt: eventAt, deduplicationKey: eventId ? `technical:${eventId}` : undefined });
    return version;
  }
  async updateValidity(actorId: string, programId: string, sourceId: string, versionId: string, patch: Partial<SourceValidity>, session?: ClientSession): Promise<GovernanceSourceVersionDocument> {
    const version = session ? await this.versionModel.findOne({ _id: new Types.ObjectId(versionId), sourceId: new Types.ObjectId(sourceId) }).session(session).exec() : await this.find(sourceId, versionId);
    if (!version) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    if (!['captured', 'to_review'].includes(version.lifecycleStatus)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Approved, published, rejected, and superseded versions are immutable.');
    const validatedEvidence = version.validity.evidence.filter((item) => item.validatedAt || item.validatedBy);
    if (patch.evidence && validatedEvidence.some((item) => !patch.evidence?.some((candidate) => candidate.id === item.id && JSON.stringify(candidate) === JSON.stringify(item)))) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Validated evidence is immutable. Supersede it through a reviewed candidate decision.');
    }
    const evidence = patch.evidence ?? version.validity.evidence;
    const validity: SourceValidity = { ...version.validity, ...patch, evidence: Array.from(new Map(evidence.map((item) => [item.id, item])).values()) };
    const reviewInputsChanged = Object.prototype.hasOwnProperty.call(patch, 'lastReviewedAt') || Object.prototype.hasOwnProperty.call(patch, 'reviewFrequencyDays');
    if (reviewInputsChanged && !Object.prototype.hasOwnProperty.call(patch, 'nextReviewAt')) validity.nextReviewAt = undefined;
    validity.nextReviewAt = this.validityCalculator.computeNextReviewAt(validity);
    validity.businessStatus = this.validityCalculator.computeBusinessStatus(validity, new Date());
    this.validityCalculator.assertValid(validity);
    const before = version.validity;
    version.validity = validity;
    await version.save({ session });
    await this.events.append({ programId, sourceId, versionId, actorId, eventType: 'validity.updated', before: { validity: before as unknown as Record<string, unknown> }, after: { validity: validity as unknown as Record<string, unknown> }, session });
    return version;
  }
  private asDate(value: Date | string | undefined): Date | undefined { if (value === undefined) return undefined; if (value instanceof Date) return value; const datePart = value.slice(0, 10); const calendarDate = new Date(`${datePart}T00:00:00.000Z`); const parsed = new Date(value); if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || Number.isNaN(parsed.getTime()) || Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Validity dates must be valid ISO calendar dates'); return parsed; }
}
