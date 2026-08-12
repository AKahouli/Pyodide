import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { DocumentValidity } from '../domain/document-validity';

export type GovernanceDocumentDocument = HydratedDocument<GovernanceDocument>;
export type GovernanceDocumentLifecycleStatus = 'captured' | 'to_review' | 'approved' | 'published' | 'rejected' | 'archived';

@Schema({ timestamps: true, collection: 'governance_documents' })
export class GovernanceDocument {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDoc', required: true, index: true }) documentId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true }) workspaceId!: Types.ObjectId;
  @Prop({ type: String, enum: ['captured', 'to_review', 'approved', 'published', 'rejected', 'archived'], default: 'captured', index: true }) status!: GovernanceDocumentLifecycleStatus;
  @Prop({ type: Object, required: true }) validity!: DocumentValidity;
  @Prop({ type: [String], default: [], index: true }) tags!: string[];
  @Prop({ type: Object, default: {} }) metadata!: Record<string, unknown>;
  @Prop({ type: Types.ObjectId, ref: 'User', index: true }) ownerUserId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', index: true }) ownerScopeId?: Types.ObjectId;
  @Prop({ type: Number, default: 0, min: 0 }) governanceRevision!: number;
  @Prop({ type: Number, default: 0, min: 0 }) temporalDecisionRevision!: number;
  @Prop({ type: Types.ObjectId, ref: 'User' }) submittedForReviewBy?: Types.ObjectId;
  @Prop() submittedForReviewAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) reviewedBy?: Types.ObjectId;
  @Prop() reviewedAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) approvedBy?: Types.ObjectId;
  @Prop() approvedAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) publishedBy?: Types.ObjectId;
  @Prop() publishedAt?: Date;
  @Prop({ maxlength: 2000 }) reviewComment?: string;
  @Prop() archivedAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) archivedBy?: Types.ObjectId;
  @Prop({ maxlength: 2000 }) archiveReason?: string;
  @Prop({ maxlength: 200 }) lastIntegrationEventId?: string;
  @Prop() lastIntegrationEventAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceDocumentSchema = SchemaFactory.createForClass(GovernanceDocument);
GovernanceDocumentSchema.index({ programId: 1, documentId: 1 }, { unique: true });
GovernanceDocumentSchema.index({ programId: 1, workspaceId: 1, status: 1 });
GovernanceDocumentSchema.index({ programId: 1, 'validity.nextReviewAt': 1 });
GovernanceDocumentSchema.index({ documentId: 1, updatedAt: -1 });
GovernanceDocumentSchema.set('toJSON', {
  virtuals: true,
  transform: (_document, returned) => {
    const serialized = returned as unknown as Record<string, unknown>;
    serialized.id = serialized._id?.toString();
    delete serialized._id;
    delete serialized.__v;
    return serialized;
  },
});
