import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { ValidityEvidence } from '@modules/governance/domain/document-validity';
import type { TemporalCandidate, TemporalValidationResult } from '@modules/governance/domain/temporal-candidate';

export type TemporalCandidateRecordDocument = HydratedDocument<TemporalCandidateRecord>;
export type TemporalCandidateDecisionStatus = 'pending' | 'processing' | 'confirmed' | 'corrected' | 'rejected';

@Schema({ timestamps: true, collection: 'temporal_candidate_records' })
export class TemporalCandidateRecord {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDoc', required: true, index: true }) documentId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'KnowledgeExtractionJob', required: true }) jobId!: Types.ObjectId;
  @Prop({ required: true, maxlength: 128 }) candidateId!: string;
  @Prop({ type: Object, required: true }) candidate!: TemporalCandidate;
  @Prop({ type: Object, required: true }) validation!: TemporalValidationResult;
  @Prop({ type: [Object], required: true, default: [] }) evidence!: ValidityEvidence[];
  @Prop({ required: true, enum: ['pending', 'processing', 'confirmed', 'corrected', 'rejected'], default: 'pending', index: true }) decisionStatus!: TemporalCandidateDecisionStatus;
  @Prop({ index: true }) decisionLeaseExpiresAt?: Date;
  @Prop({ maxlength: 64 }) decisionToken?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) decidedBy?: Types.ObjectId;
  @Prop() decidedAt?: Date;
  @Prop({ maxlength: 2000 }) decisionComment?: string;
  @Prop({ type: Object }) correctedCandidate?: TemporalCandidate;
  @Prop({ required: true, maxlength: 128 }) inputHash!: string;
  @Prop({ required: true, maxlength: 64 }) engineVersion!: string;
}

export const TemporalCandidateRecordSchema = SchemaFactory.createForClass(TemporalCandidateRecord);
TemporalCandidateRecordSchema.set('toJSON', {
  virtuals: true,
  transform: (_document, returned: TemporalCandidateRecord & { _id?: Types.ObjectId; __v?: number; id?: string }) => {
    returned.id = String(returned._id);
    delete returned._id;
    delete returned.__v;
  },
});
TemporalCandidateRecordSchema.index({ programId: 1, documentId: 1, candidateId: 1, inputHash: 1 }, { unique: true });
TemporalCandidateRecordSchema.index({ documentId: 1, decisionStatus: 1, createdAt: -1 });
