import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyMemoryProposalDocument = HydratedDocument<WorkyMemoryProposal>;
export type WorkyMemoryEntryDocument = HydratedDocument<WorkyMemoryEntry>;

/**
 * Owner-scoped memory proposal. Created by the backend on durable
 * learnings (stream completion, etc.). The owner must confirm before
 * the proposal is persisted as a `WorkyMemoryEntry` (Part 4 §7,
 * canonical §21). Rejected proposals write nothing.
 */
@Schema({
  timestamps: true,
  collection: 'worky_memory_proposals',
})
export class WorkyMemoryProposal extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerUserId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', default: null, index: true })
  sourceStreamId?: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: ['stream_summary', 'preference', 'person', 'decision_history', 'role_clarification'],
    required: true,
  })
  category!: string;

  @Prop({ type: String, required: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, required: true, maxlength: 5000 })
  content!: string;

  @Prop({
    type: String,
    enum: ['pending', 'confirmed', 'rejected'],
    required: true,
    default: 'pending',
    index: true,
  })
  status!: string;

  @Prop({ type: Date, default: null })
  decidedAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyMemoryProposalSchema = SchemaFactory.createForClass(WorkyMemoryProposal);
WorkyMemoryProposalSchema.index({ ownerUserId: 1, status: 1 });
WorkyMemoryProposalSchema.index({ createdAt: -1 });

WorkyMemoryProposalSchema.set('toJSON', {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

@Schema({
  timestamps: true,
  collection: 'worky_memory_entries',
})
export class WorkyMemoryEntry extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerUserId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyMemoryProposal', default: null })
  sourceProposalId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', default: null, index: true })
  sourceStreamId?: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: ['stream_summary', 'preference', 'person', 'decision_history', 'role_clarification'],
    required: true,
  })
  category!: string;

  @Prop({ type: String, required: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, required: true, maxlength: 5000 })
  content!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyMemoryEntrySchema = SchemaFactory.createForClass(WorkyMemoryEntry);
WorkyMemoryEntrySchema.index({ ownerUserId: 1, createdAt: -1 });

WorkyMemoryEntrySchema.set('toJSON', {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
