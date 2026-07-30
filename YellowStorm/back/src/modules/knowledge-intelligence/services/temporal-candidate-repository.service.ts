import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { ValidityEvidence } from '@modules/governance/domain/document-validity';
import type { TemporalCandidate, TemporalValidationResult } from '@modules/governance/domain/temporal-candidate';
import { TemporalCandidateRecord, TemporalCandidateRecordDocument, type TemporalCandidateDecisionStatus } from '../schemas/temporal-candidate-record.schema';
import { randomUUID } from 'crypto';

@Injectable()
export class TemporalCandidateRepositoryService {
  constructor(@InjectModel(TemporalCandidateRecord.name) private readonly records: Model<TemporalCandidateRecordDocument>) {}

  async upsertMany(input: { programId: string; documentId: string; jobId: string; inputHash: string; engineVersion: string; candidates: Array<{ candidate: TemporalCandidate; validation: TemporalValidationResult; evidence: ValidityEvidence[] }> }): Promise<void> {
    await Promise.all(input.candidates.map(({ candidate, validation, evidence }) => this.records.updateOne(
      { programId: new Types.ObjectId(input.programId), documentId: new Types.ObjectId(input.documentId), candidateId: candidate.candidateId, inputHash: input.inputHash },
      { $setOnInsert: { programId: new Types.ObjectId(input.programId), documentId: new Types.ObjectId(input.documentId), jobId: new Types.ObjectId(input.jobId), candidateId: candidate.candidateId, candidate, validation, evidence, decisionStatus: 'pending', inputHash: input.inputHash, engineVersion: input.engineVersion } },
      { upsert: true },
    ).exec()));
  }

  async list(documentId: string): Promise<TemporalCandidateRecordDocument[]> {
    return this.records.find({ documentId: new Types.ObjectId(documentId) }).sort({ createdAt: -1 }).exec();
  }

  async beginDecision(documentId: string, recordId: string): Promise<TemporalCandidateRecordDocument | null> {
    const now = new Date();
    return this.records.findOneAndUpdate({ _id: new Types.ObjectId(recordId), documentId: new Types.ObjectId(documentId), $or: [{ decisionStatus: 'pending' }, { decisionStatus: 'processing', decisionLeaseExpiresAt: { $lte: now } }] }, { $set: { decisionStatus: 'processing', decisionLeaseExpiresAt: new Date(now.getTime() + 120_000), decisionToken: randomUUID() } }, { new: true }).exec();
  }

  async markDecision(recordId: string, decisionToken: string, actorId: string, status: 'confirmed' | 'corrected' | 'rejected', comment?: string, correctedCandidate?: TemporalCandidate, session?: ClientSession): Promise<TemporalCandidateRecordDocument | null> {
    return this.records.findOneAndUpdate({ _id: new Types.ObjectId(recordId), decisionStatus: 'processing', decisionToken }, { $set: { decisionStatus: status, decidedBy: new Types.ObjectId(actorId), decidedAt: new Date(), decisionComment: comment, correctedCandidate, decisionLeaseExpiresAt: undefined, decisionToken: undefined } }, { new: true, session }).exec();
  }

  async releaseDecision(recordId: string, decisionToken: string): Promise<void> { await this.records.updateOne({ _id: new Types.ObjectId(recordId), decisionStatus: 'processing', decisionToken }, { $set: { decisionStatus: 'pending', decisionLeaseExpiresAt: undefined, decisionToken: undefined } }).exec(); }
  async ownsDecision(recordId: string, decisionToken: string, session: ClientSession): Promise<boolean> { return Boolean(await this.records.exists({ _id: new Types.ObjectId(recordId), decisionStatus: 'processing', decisionToken }).session(session)); }
  async purgeDocument(documentId: string, session?: ClientSession): Promise<void> { await this.records.deleteMany({ documentId: new Types.ObjectId(documentId) }, { session }).exec(); }
}
