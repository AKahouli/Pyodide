import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MetadataCandidateDocument = HydratedDocument<MetadataCandidate>;
export type MetadataCandidateStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';

@Schema({ timestamps: true, collection: 'metadata_candidates' })
export class MetadataCandidate {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: [Types.ObjectId], ref: 'GovernanceScope', default: [], index: true }) scopeIds!: Types.ObjectId[];
  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDoc', required: true, index: true }) documentId!: Types.ObjectId;
  @Prop({ required: true, maxlength: 120 }) key!: string;
  @Prop({ type: Object, required: true }) proposedValue!: unknown;
  @Prop({ required: true, enum: ['document', 'business', 'search'], index: true }) candidateType!: 'document' | 'business' | 'search';
  @Prop({ required: true, min: 0, max: 1 }) confidence!: number;
  @Prop({ required: true, enum: ['low', 'medium', 'high'] }) riskLevel!: 'low' | 'medium' | 'high';
  @Prop({ type: [String], default: [] }) evidenceRefs!: string[];
  @Prop({ required: true, enum: ['proposed', 'accepted', 'rejected', 'superseded'], default: 'proposed', index: true }) status!: MetadataCandidateStatus;
  @Prop({ required: true, maxlength: 512 }) candidateKey!: string;
  @Prop({ type: Object }) acceptedValue?: unknown;
  @Prop({ type: Types.ObjectId, ref: 'User' }) decidedBy?: Types.ObjectId;
  @Prop() decidedAt?: Date;
  @Prop({ maxlength: 2000 }) decisionReason?: string;
}

export const MetadataCandidateSchema = SchemaFactory.createForClass(MetadataCandidate);
MetadataCandidateSchema.index({ programId: 1, documentId: 1, candidateKey: 1 }, { unique: true });
MetadataCandidateSchema.index({ programId: 1, scopeIds: 1, status: 1, createdAt: -1 });
MetadataCandidateSchema.set('toJSON', { virtuals: true, transform: (_doc, value: MetadataCandidate & { _id?: Types.ObjectId; __v?: number; id?: string }) => { value.id = String(value._id); delete value._id; delete value.__v; } });
