import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { MetadataCandidate, MetadataCandidateDocument, type MetadataCandidateStatus } from '../schemas/metadata-candidate.schema';

export interface MetadataCandidateInput { programId: string; scopeIds: string[]; documentId: string; key: string; proposedValue: unknown; candidateType: 'document' | 'business' | 'search'; confidence: number; riskLevel: 'low' | 'medium' | 'high'; evidenceRefs: string[]; candidateKey: string; }

@Injectable()
export class MetadataCandidateRepositoryService {
  constructor(@InjectModel(MetadataCandidate.name) private readonly model: Model<MetadataCandidateDocument>) {}

  async synchronize(documentId: string, candidates: MetadataCandidateInput[]): Promise<void> {
    const keys = candidates.map((item) => item.candidateKey);
    await Promise.all(candidates.map((item) => this.model.findOneAndUpdate(
      { programId: new Types.ObjectId(item.programId), documentId: new Types.ObjectId(item.documentId), candidateKey: item.candidateKey },
      { $set: { scopeIds: item.scopeIds.map((id) => new Types.ObjectId(id)), key: item.key, proposedValue: item.proposedValue, candidateType: item.candidateType, confidence: item.confidence, riskLevel: item.riskLevel, evidenceRefs: item.evidenceRefs }, $setOnInsert: { programId: new Types.ObjectId(item.programId), documentId: new Types.ObjectId(item.documentId), candidateKey: item.candidateKey, status: 'proposed' } },
      { upsert: true, setDefaultsOnInsert: true },
    ).exec()));
    await this.model.updateMany({ documentId: new Types.ObjectId(documentId), status: 'proposed', candidateKey: { $nin: keys } }, { $set: { status: 'superseded' } }).exec();
  }

  async list(programId: string, scopeIds?: string[], status?: MetadataCandidateStatus): Promise<MetadataCandidateDocument[]> {
    const query: Record<string, unknown> = { programId: new Types.ObjectId(programId) };
    if (scopeIds && !scopeIds.includes('*')) query.$or = [{ scopeIds: { $in: scopeIds.map((id) => new Types.ObjectId(id)) } }, { scopeIds: { $size: 0 } }];
    if (status) query.status = status;
    return this.model.find(query).sort({ status: 1, createdAt: -1 }).limit(500).exec();
  }

  async decide(programId: string, id: string, actorId: string, action: 'accept' | 'reject', accessibleScopeIds: string[], acceptedValue?: unknown, reason?: string, session?: ClientSession): Promise<MetadataCandidateDocument | null> {
    const scopeFilter = accessibleScopeIds.includes('*') ? {} : { $or: [{ scopeIds: { $in: accessibleScopeIds.map((scopeId) => new Types.ObjectId(scopeId)) } }, { scopeIds: { $size: 0 } }] };
    return this.model.findOneAndUpdate({ _id: new Types.ObjectId(id), programId: new Types.ObjectId(programId), status: 'proposed', ...scopeFilter }, { $set: { status: action === 'accept' ? 'accepted' : 'rejected', acceptedValue: action === 'accept' ? acceptedValue : undefined, decidedBy: new Types.ObjectId(actorId), decidedAt: new Date(), decisionReason: reason } }, { new: true, session }).exec();
  }
}
