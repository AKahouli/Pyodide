import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernanceSourceDocument = HydratedDocument<GovernanceSource>;
export type GovernanceSourceVisibility = 'program_shared' | 'scope_specific' | 'multi_scope';
export type GovernanceSourceStatus = 'draft' | 'to_review' | 'validated' | 'published' | 'expired' | 'rejected';
export type GovernanceSourceType = 'pdf' | 'web_page' | 'api' | 'manual_record' | 'spreadsheet';

@Schema({ timestamps: true, collection: 'governance_sources' })
export class GovernanceSource extends Document {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true })
  programId!: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'GovernanceScope', default: [], index: true })
  scopeIds!: Types.ObjectId[];

  @Prop({ type: String, enum: ['program_shared', 'scope_specific', 'multi_scope'], required: true, index: true })
  visibility!: GovernanceSourceVisibility;

  @Prop({ required: true, trim: true, maxlength: 240 })
  title!: string;

  @Prop({ type: String, enum: ['pdf', 'web_page', 'api', 'manual_record', 'spreadsheet'], required: true })
  sourceType!: GovernanceSourceType;

  @Prop({ trim: true, maxlength: 2048 })
  url?: string;

  @Prop({ type: Types.ObjectId, ref: 'Workspace' })
  workspaceId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDocument' })
  documentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceSourceVersion' })
  currentCandidateVersionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceSourceVersion' })
  currentPublishedVersionId?: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  versionSequence!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  temporalDecisionRevision!: number;

  @Prop({ trim: true, maxlength: 1024, index: true })
  originKey?: string;

  @Prop({ type: String, enum: ['draft', 'to_review', 'validated', 'published', 'expired', 'rejected'], default: 'draft', index: true })
  status!: GovernanceSourceStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  ownerUserId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', index: true })
  ownerScopeId?: Types.ObjectId;

  @Prop({ type: [String], default: [], index: true })
  tags!: string[];

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ type: Date })
  lastReviewedAt?: Date;

  @Prop({ type: Date, index: true })
  nextReviewAt?: Date;

  @Prop({ type: Number, min: 1 })
  reviewFrequencyDays?: number;

  @Prop({ type: Boolean, default: false, index: true })
  isArchived!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  knowledgeGovernanceRevision!: number;

  @Prop({ type: Date })
  archivedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  archivedBy?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 2000 })
  archiveReason?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceSourceSchema = SchemaFactory.createForClass(GovernanceSource);

GovernanceSourceSchema.index({ programId: 1, visibility: 1, status: 1 });
GovernanceSourceSchema.index({ programId: 1, scopeIds: 1, status: 1 });
GovernanceSourceSchema.index({ nextReviewAt: 1, status: 1 });
GovernanceSourceSchema.index({ programId: 1, isArchived: 1, updatedAt: -1 });
GovernanceSourceSchema.index({ programId: 1, originKey: 1 }, { unique: true, partialFilterExpression: { originKey: { $type: 'string' } } });

GovernanceSourceSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
