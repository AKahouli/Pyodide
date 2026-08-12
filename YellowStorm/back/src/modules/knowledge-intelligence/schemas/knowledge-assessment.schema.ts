import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { KnowledgeAssessmentDimensions, KnowledgeHealthStatus } from '../domain/knowledge-steward';

export type KnowledgeAssessmentDocument = HydratedDocument<KnowledgeAssessment>;

@Schema({ timestamps: true, collection: 'knowledge_assessments' })
export class KnowledgeAssessment {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: [Types.ObjectId], ref: 'GovernanceScope', default: [], index: true }) scopeIds!: Types.ObjectId[];
  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDoc', required: true, index: true }) documentId!: Types.ObjectId;
  @Prop({ required: true, maxlength: 64 }) assessmentVersion!: string;
  @Prop({ required: true, maxlength: 128 }) inputHash!: string;
  @Prop({ required: true, index: true }) assessedAt!: Date;
  @Prop({ type: Object, required: true }) dimensions!: KnowledgeAssessmentDimensions;
  @Prop({ required: true, min: 0, max: 100 }) overallHealthScore!: number;
  @Prop({ required: true, enum: ['healthy', 'warning', 'critical'], index: true }) status!: KnowledgeHealthStatus;
  @Prop({ required: true, maxlength: 1000 }) summary!: string;
}

export const KnowledgeAssessmentSchema = SchemaFactory.createForClass(KnowledgeAssessment);
KnowledgeAssessmentSchema.index({ programId: 1, documentId: 1, assessmentVersion: 1, inputHash: 1 }, { unique: true });
KnowledgeAssessmentSchema.index({ programId: 1, scopeIds: 1, status: 1, assessedAt: -1 });
KnowledgeAssessmentSchema.set('toJSON', { virtuals: true, transform: (_doc, value: KnowledgeAssessment & { _id?: Types.ObjectId; __v?: number; id?: string }) => { value.id = String(value._id); delete value._id; delete value.__v; } });
