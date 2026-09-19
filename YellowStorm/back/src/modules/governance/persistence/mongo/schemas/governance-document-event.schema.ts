import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GovernanceDocumentEventDocument = HydratedDocument<GovernanceDocumentEvent>;
export type GovernanceDocumentEventType = 'document.governance_created' | 'document.captured' | 'document.submitted_for_review' | 'document.returned_to_editing' | 'document.approved' | 'document.rejected' | 'document.published' | 'document.archived' | 'document.restored' | 'document.governance_deleted' | 'validity.updated' | 'validity.review_due' | 'validity.candidate_decided' | 'knowledge.assessed' | 'knowledge.recommendation_applied' | 'metadata.candidate_decided';

@Schema({ timestamps: true, collection: 'governance_document_events' })
export class GovernanceDocumentEvent {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceDocument', required: true, index: true }) governanceDocumentId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDoc', required: true, index: true }) documentId!: Types.ObjectId;
  @Prop({ required: true, index: true }) eventType!: GovernanceDocumentEventType;
  @Prop({ type: Types.ObjectId, ref: 'User' }) actorId?: Types.ObjectId;
  @Prop({ type: String, enum: ['user', 'system', 'integration'], default: 'system', required: true }) actorType!: 'user' | 'system' | 'integration';
  @Prop({ maxlength: 320 }) actorEmail?: string;
  @Prop({ required: true, index: true }) occurredAt!: Date;
  @Prop({ maxlength: 2000 }) reason?: string;
  @Prop({ type: Object }) before?: Record<string, unknown>;
  @Prop({ type: Object }) after?: Record<string, unknown>;
  @Prop({ type: Object, default: {} }) metadata!: Record<string, unknown>;
  @Prop({ index: true }) correlationId?: string;
  @Prop() causationId?: string;
  @Prop({ trim: true, maxlength: 300 }) deduplicationKey?: string;
}

export const GovernanceDocumentEventSchema = SchemaFactory.createForClass(GovernanceDocumentEvent);
GovernanceDocumentEventSchema.index({ governanceDocumentId: 1, occurredAt: -1 });
GovernanceDocumentEventSchema.index({ documentId: 1, occurredAt: -1 });
GovernanceDocumentEventSchema.index({ programId: 1, eventType: 1, occurredAt: -1 });
GovernanceDocumentEventSchema.index({ governanceDocumentId: 1, deduplicationKey: 1 }, { unique: true, partialFilterExpression: { deduplicationKey: { $type: 'string' } } });
