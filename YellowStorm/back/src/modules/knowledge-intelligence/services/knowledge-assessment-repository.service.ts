import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { KnowledgeAssessmentDimensions, KnowledgeHealthStatus } from '../domain/knowledge-steward';
import { KnowledgeAssessment, KnowledgeAssessmentDocument } from '../schemas/knowledge-assessment.schema';

@Injectable()
export class KnowledgeAssessmentRepositoryService {
  constructor(@InjectModel(KnowledgeAssessment.name) private readonly model: Model<KnowledgeAssessmentDocument>) {}

  async upsert(input: { programId: string; scopeIds: string[]; documentId: string; assessmentVersion: string; inputHash: string; assessedAt: Date; dimensions: KnowledgeAssessmentDimensions; overallHealthScore: number; status: KnowledgeHealthStatus; summary: string }): Promise<KnowledgeAssessmentDocument> {
    return this.model.findOneAndUpdate(
      { programId: new Types.ObjectId(input.programId), documentId: new Types.ObjectId(input.documentId), assessmentVersion: input.assessmentVersion, inputHash: input.inputHash },
      { $set: { scopeIds: input.scopeIds.map((id) => new Types.ObjectId(id)), assessedAt: input.assessedAt, dimensions: input.dimensions, overallHealthScore: input.overallHealthScore, status: input.status, summary: input.summary }, $setOnInsert: { programId: new Types.ObjectId(input.programId), documentId: new Types.ObjectId(input.documentId), assessmentVersion: input.assessmentVersion, inputHash: input.inputHash } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).exec();
  }

  async latestByProgram(programId: string, scopeIds?: string[]): Promise<KnowledgeAssessmentDocument[]> {
    const match: Record<string, unknown> = { programId: new Types.ObjectId(programId) };
    if (scopeIds && !scopeIds.includes('*')) match.$or = [{ scopeIds: { $in: scopeIds.map((id) => new Types.ObjectId(id)) } }, { scopeIds: { $size: 0 } }];
    return this.model.aggregate<KnowledgeAssessmentDocument>([
      { $match: match },
      { $sort: { assessedAt: -1 } },
      { $group: { _id: '$documentId', record: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$record' } },
      { $sort: { assessedAt: -1 } },
    ]).exec();
  }

  async purgeDocument(documentId: string): Promise<void> { await this.model.deleteMany({ documentId: new Types.ObjectId(documentId) }).exec(); }
}
