import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { KnowledgePriority, KnowledgeRecommendationType } from '../domain/knowledge-steward';

export type KnowledgeRecommendationDocument = HydratedDocument<KnowledgeRecommendation>;
export type KnowledgeRecommendationStatus = 'proposed' | 'accepted' | 'rejected' | 'applied' | 'superseded';

@Schema({ timestamps: true, collection: 'knowledge_recommendations' })
export class KnowledgeRecommendation {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: [Types.ObjectId], ref: 'GovernanceScope', default: [], index: true }) scopeIds!: Types.ObjectId[];
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSource', index: true }) sourceId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSourceVersion', index: true }) sourceVersionId?: Types.ObjectId;
  @Prop({ type: [Types.ObjectId], ref: 'KnowledgeAlert', default: [] }) alertIds!: Types.ObjectId[];
  @Prop({ required: true, enum: ['assign_owner', 'schedule_review', 'confirm_validity', 'resolve_conflict', 'enrich_metadata', 'add_synonyms', 'merge_duplicate', 'reindex', 'change_scope', 'exclude_from_runtime'], index: true }) type!: KnowledgeRecommendationType;
  @Prop({ required: true, enum: ['critical', 'high', 'medium', 'low'], index: true }) priority!: KnowledgePriority;
  @Prop({ required: true, maxlength: 2000 }) reason!: string;
  @Prop({ required: true, maxlength: 2000 }) impactSummary!: string;
  @Prop({ type: Object }) proposedAction?: Record<string, unknown>;
  @Prop({ required: true, enum: ['proposed', 'accepted', 'rejected', 'applied', 'superseded'], default: 'proposed', index: true }) status!: KnowledgeRecommendationStatus;
  @Prop({ required: true, maxlength: 512 }) deduplicationKey!: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) decidedBy?: Types.ObjectId;
  @Prop() decidedAt?: Date;
  @Prop({ maxlength: 2000 }) decisionReason?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) appliedBy?: Types.ObjectId;
  @Prop() appliedAt?: Date;
  @Prop({ maxlength: 64 }) applicationToken?: string;
  @Prop({ index: true }) applicationLeaseExpiresAt?: Date;
}

export const KnowledgeRecommendationSchema = SchemaFactory.createForClass(KnowledgeRecommendation);
KnowledgeRecommendationSchema.index({ programId: 1, deduplicationKey: 1 }, { unique: true });
KnowledgeRecommendationSchema.index({ programId: 1, scopeIds: 1, status: 1, priority: 1, createdAt: -1 });
KnowledgeRecommendationSchema.set('toJSON', { virtuals: true, transform: (_doc, value: KnowledgeRecommendation & { _id?: Types.ObjectId; __v?: number; id?: string }) => { value.id = String(value._id); delete value._id; delete value.__v; } });
