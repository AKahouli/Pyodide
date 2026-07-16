import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { KnowledgePriority } from '../domain/knowledge-steward';

export type KnowledgeAlertDocument = HydratedDocument<KnowledgeAlert>;
export type KnowledgeAlertStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored';
export type KnowledgeAlertCategory = 'validity' | 'freshness' | 'availability' | 'integrity' | 'governance' | 'search_quality' | 'impact';

@Schema({ timestamps: true, collection: 'knowledge_alerts' })
export class KnowledgeAlert {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: [Types.ObjectId], ref: 'GovernanceScope', default: [], index: true }) scopeIds!: Types.ObjectId[];
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSource', index: true }) sourceId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSourceVersion', index: true }) sourceVersionId?: Types.ObjectId;
  @Prop({ required: true, enum: ['validity', 'freshness', 'availability', 'integrity', 'governance', 'search_quality', 'impact'], index: true }) category!: KnowledgeAlertCategory;
  @Prop({ required: true, enum: ['critical', 'high', 'medium', 'low'], index: true }) severity!: KnowledgePriority;
  @Prop({ required: true, enum: ['open', 'acknowledged', 'resolved', 'ignored'], default: 'open', index: true }) status!: KnowledgeAlertStatus;
  @Prop({ required: true, maxlength: 240 }) title!: string;
  @Prop({ required: true, maxlength: 2000 }) description!: string;
  @Prop({ required: true, maxlength: 512 }) deduplicationKey!: string;
  @Prop({ type: [String], default: [] }) evidenceRefs!: string[];
  @Prop({ required: true }) openedAt!: Date;
  @Prop() resolvedAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) acknowledgedBy?: Types.ObjectId;
  @Prop() acknowledgedAt?: Date;
}

export const KnowledgeAlertSchema = SchemaFactory.createForClass(KnowledgeAlert);
KnowledgeAlertSchema.index({ programId: 1, deduplicationKey: 1 }, { unique: true });
KnowledgeAlertSchema.index({ programId: 1, scopeIds: 1, status: 1, severity: 1, openedAt: -1 });
KnowledgeAlertSchema.set('toJSON', { virtuals: true, transform: (_doc, value: KnowledgeAlert & { _id?: Types.ObjectId; __v?: number; id?: string }) => { value.id = String(value._id); delete value._id; delete value.__v; } });
