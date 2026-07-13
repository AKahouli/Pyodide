import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { DEFAULT_UNKNOWN_VALIDITY, type SourceValidity } from '../domain/source-validity';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument, type GovernanceSourceVersionTechnicalStatus } from '../schemas/governance-source-version.schema';
import { GovernanceSourceEventService } from './governance-source-event.service';
import type { CreateGovernanceSourceVersionDto } from '../dto/create-governance-source-version.dto';

@Injectable()
export class GovernanceSourceVersionService {
  constructor(@InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>, @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>, private readonly events: GovernanceSourceEventService) {}
  async create(actorId: string, programId: string, sourceId: string, dto: CreateGovernanceSourceVersionDto, originEventId?: string): Promise<GovernanceSourceVersionDocument> {
    if (originEventId) { const existing = await this.versionModel.findOne({ originEventId }).exec(); if (existing) return existing; }
    const source = await this.sourceModel.findOneAndUpdate({ _id: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId) }, { $inc: { versionSequence: 1 } }, { new: true }).exec();
    if (!source) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    const version = await this.versionModel.create({ programId: source.programId, sourceId: source._id, versionNumber: source.versionSequence, workspaceId: dto.workspaceId ? new Types.ObjectId(dto.workspaceId) : undefined, documentId: dto.documentId ? new Types.ObjectId(dto.documentId) : undefined, canonicalUrl: dto.canonicalUrl, contentHash: dto.contentHash, capturedAt: new Date(), validity: { ...DEFAULT_UNKNOWN_VALIDITY, evidence: [] }, extractedMetadata: dto.extractedMetadata ?? {}, createdBy: new Types.ObjectId(actorId), originEventId });
    source.currentCandidateVersionId = version._id;
    await source.save();
    await this.events.append({ programId, sourceId, versionId: version._id.toString(), actorId, eventType: 'version.captured' });
    return version;
  }
  async list(sourceId: string): Promise<GovernanceSourceVersionDocument[]> { return this.versionModel.find({ sourceId: new Types.ObjectId(sourceId) }).sort({ versionNumber: -1 }).exec(); }
  async find(sourceId: string, versionId: string): Promise<GovernanceSourceVersionDocument> { const version = await this.versionModel.findOne({ _id: new Types.ObjectId(versionId), sourceId: new Types.ObjectId(sourceId) }).exec(); if (!version) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND); return version; }
  async updateTechnicalStatus(programId: string, sourceId: string, versionId: string, status: GovernanceSourceVersionTechnicalStatus, eventId?: string, eventAt = new Date()): Promise<GovernanceSourceVersionDocument> { const version = await this.find(sourceId, versionId); if (version.lastIntegrationEventAt && version.lastIntegrationEventAt > eventAt) return version; const order = { pending: 0, processing: 1, ready: 2, failed: 3 }; if (order[status] < order[version.technicalStatus] && status !== 'failed') return version; const before = version.technicalStatus; version.technicalStatus = status; version.lastIntegrationEventId = eventId; version.lastIntegrationEventAt = eventAt; await version.save(); await this.events.append({ programId, sourceId, versionId, eventType: 'version.technical_status_changed', before: { technicalStatus: before }, after: { technicalStatus: status } }); return version; }
  async updateValidity(actorId: string, programId: string, sourceId: string, versionId: string, validity: SourceValidity): Promise<GovernanceSourceVersionDocument> { const version = await this.find(sourceId, versionId); version.validity = validity; await version.save(); await this.events.append({ programId, sourceId, versionId, actorId, eventType: 'validity.updated' }); return version; }
}
