import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SourceValidity } from '../domain/source-validity';

export type GovernanceSourceVersionDocument = HydratedDocument<GovernanceSourceVersion>;
export type GovernanceSourceVersionLifecycleStatus = 'captured' | 'to_review' | 'approved' | 'published' | 'rejected' | 'superseded';
export type GovernanceSourceVersionTechnicalStatus = 'pending' | 'processing' | 'ready' | 'failed';

@Schema({ timestamps: true, collection: 'governance_source_versions' })
export class GovernanceSourceVersion {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSource', required: true, index: true }) sourceId!: Types.ObjectId;
  @Prop({ required: true, min: 1 }) versionNumber!: number;
  @Prop({ type: Types.ObjectId, ref: 'Workspace', index: true }) workspaceId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDoc', index: true }) documentId?: Types.ObjectId;
  @Prop({ trim: true, maxlength: 2048 }) canonicalUrl?: string;
  @Prop({ trim: true, maxlength: 128, index: true }) contentHash?: string;
  @Prop({ trim: true, maxlength: 200 }) indexingTaskId?: string;
  @Prop({ trim: true, maxlength: 200 }) indexingRevisionId?: string;
  @Prop({ trim: true, maxlength: 200, index: true }) indexingAttemptId?: string;
  @Prop() indexingStartedAt?: Date;
  @Prop() indexingCompletedAt?: Date;
  @Prop({ required: true }) capturedAt!: Date;
  @Prop() fetchedAt?: Date;
  @Prop({ type: Object, default: {} }) http!: { status?: number; etag?: string; lastModified?: string; contentType?: string };
  @Prop({ type: String, enum: ['captured', 'to_review', 'approved', 'published', 'rejected', 'superseded'], default: 'captured', index: true }) lifecycleStatus!: GovernanceSourceVersionLifecycleStatus;
  @Prop({ type: String, enum: ['pending', 'processing', 'ready', 'failed'], default: 'pending', index: true }) technicalStatus!: GovernanceSourceVersionTechnicalStatus;
  @Prop({ type: Object, required: true }) validity!: SourceValidity;
  @Prop({ type: Object, default: {} }) extractedMetadata!: Record<string, unknown>;
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) submittedForReviewBy?: Types.ObjectId;
  @Prop() submittedForReviewAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) reviewedBy?: Types.ObjectId;
  @Prop() reviewedAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) approvedBy?: Types.ObjectId;
  @Prop() approvedAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) publishedBy?: Types.ObjectId;
  @Prop() publishedAt?: Date;
  @Prop({ trim: true, maxlength: 2000 }) reviewComment?: string;
  @Prop({ trim: true, maxlength: 200, unique: true, sparse: true }) originEventId?: string;
  @Prop({ trim: true, maxlength: 200 }) lastIntegrationEventId?: string;
  @Prop() lastIntegrationEventAt?: Date;
}
export const GovernanceSourceVersionSchema = SchemaFactory.createForClass(GovernanceSourceVersion);
GovernanceSourceVersionSchema.set('toJSON', {
  virtuals: true,
  transform: (_document, returned: any) => {
    returned.id = String(returned._id);
    delete returned._id;
    delete returned.__v;
  },
});
GovernanceSourceVersionSchema.index({ sourceId: 1, versionNumber: 1 }, { unique: true });
GovernanceSourceVersionSchema.index({ programId: 1, lifecycleStatus: 1, technicalStatus: 1 });
GovernanceSourceVersionSchema.index({ programId: 1, 'validity.nextReviewAt': 1 });
GovernanceSourceVersionSchema.index({ documentId: 1, contentHash: 1 });
GovernanceSourceVersionSchema.index({ canonicalUrl: 1, capturedAt: -1 });
