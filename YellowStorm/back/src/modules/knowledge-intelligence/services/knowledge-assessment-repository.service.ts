import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { KnowledgeAssessmentDimensions, KnowledgeHealthStatus } from '../domain/knowledge-steward';
import { KnowledgeAssessment, KnowledgeAssessmentDocument } from '../schemas/knowledge-assessment.schema';

@Injectable()
export class KnowledgeAssessmentRepositoryService {
  constructor(@InjectModel(KnowledgeAssessment.name) private readonly model: Model<KnowledgeAssessmentDocument>) {}

  async upsert(input: { programId: string; scopeIds: string[]; sourceId: string; sourceVersionId: string; assessmentVersion: string; inputHash: string; assessedAt: Date; dimensions: KnowledgeAssessmentDimensions; overallHealthScore: number; status: KnowledgeHealthStatus; summary: string }): Promise<KnowledgeAssessmentDocument> {
    return this.model.findOneAndUpdate(
      { sourceVersionId: new Types.ObjectId(input.sourceVersionId), assessmentVersion: input.assessmentVersion, inputHash: input.inputHash },
      { $set: { programId: new Types.ObjectId(input.programId), scopeIds: input.scopeIds.map((id) => new Types.ObjectId(id)), sourceId: new Types.ObjectId(input.sourceId), assessedAt: input.assessedAt, dimensions: input.dimensions, overallHealthScore: input.overallHealthScore, status: input.status, summary: input.summary }, $setOnInsert: { sourceVersionId: new Types.ObjectId(input.sourceVersionId), assessmentVersion: input.assessmentVersion, inputHash: input.inputHash } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).exec();
  }

  async latestByProgram(programId: string, scopeIds?: string[]): Promise<KnowledgeAssessmentDocument[]> {
    const match: Record<string, unknown> = { programId: new Types.ObjectId(programId) };
    if (scopeIds && !scopeIds.includes('*')) match.$or = [{ scopeIds: { $in: scopeIds.map((id) => new Types.ObjectId(id)) } }, { scopeIds: { $size: 0 } }];
    return this.model.aggregate<KnowledgeAssessmentDocument>([
      { $match: match },
      { $sort: { assessedAt: -1 } },
      { $group: { _id: '$sourceId', record: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$record' } },
      { $sort: { assessedAt: -1 } },
    ]).exec();
  }

  async purgeSource(sourceId: string): Promise<void> { await this.model.deleteMany({ sourceId: new Types.ObjectId(sourceId) }).exec(); }
}
