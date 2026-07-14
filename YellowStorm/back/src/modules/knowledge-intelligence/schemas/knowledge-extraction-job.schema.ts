import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type KnowledgeExtractionJobDocument = HydratedDocument<KnowledgeExtractionJob>;
export type KnowledgeExtractionJobType = 'technical_metadata' | 'temporal_extraction' | 'metadata_enrichment';
export type KnowledgeExtractionJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

@Schema({ timestamps: true, collection: 'knowledge_extraction_jobs' })
export class KnowledgeExtractionJob {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSource', required: true, index: true }) sourceId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSourceVersion', required: true, index: true }) sourceVersionId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Connector', required: true, index: true }) connectorId!: Types.ObjectId;
  @Prop({ required: true, enum: ['technical_metadata', 'temporal_extraction', 'metadata_enrichment'], index: true }) jobType!: KnowledgeExtractionJobType;
  @Prop({ required: true, enum: ['pending', 'running', 'completed', 'failed', 'cancelled'], default: 'pending', index: true }) status!: KnowledgeExtractionJobStatus;
  @Prop({ required: true, maxlength: 128 }) inputHash!: string;
  @Prop({ required: true, maxlength: 64 }) engineVersion!: string;
  @Prop({ required: true, default: 0, min: 0 }) attempts!: number;
  @Prop({ maxlength: 2000 }) error?: string;
  @Prop() startedAt?: Date;
  @Prop() completedAt?: Date;
  @Prop({ index: true }) leaseExpiresAt?: Date;
  @Prop({ maxlength: 64 }) leaseToken?: string;
  @Prop({ index: true }) nextAttemptAt?: Date;
}

export const KnowledgeExtractionJobSchema = SchemaFactory.createForClass(KnowledgeExtractionJob);
KnowledgeExtractionJobSchema.set('toJSON', {
  virtuals: true,
  transform: (_document, returned: KnowledgeExtractionJob & { _id?: Types.ObjectId; __v?: number; id?: string }) => {
    returned.id = String(returned._id);
    delete returned._id;
    delete returned.__v;
  },
});
KnowledgeExtractionJobSchema.index({ sourceVersionId: 1, jobType: 1, inputHash: 1, engineVersion: 1 }, { unique: true });
KnowledgeExtractionJobSchema.index({ status: 1, createdAt: 1 });
KnowledgeExtractionJobSchema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 });
