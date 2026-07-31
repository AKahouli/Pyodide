import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ReportDocument = HydratedDocument<Report>;

@Schema({
  timestamps: true,
  collection: 'reports',
})
export class Report extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message', required: true, index: true })
  messageId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['inaccurate', 'wrong_information', 'offensive', 'out_of_context', 'hallucination', 'other'],
  })
  reason!: string;

  @Prop({ type: String, required: true, maxlength: 2000 })
  description!: string;

  @Prop({ type: String, enum: ['user', 'system_correction'], default: 'user', index: true })
  source!: 'user' | 'system_correction';

  @Prop({ type: String, enum: ['pending', 'reviewed', 'resolved'], default: 'pending' })
  status!: string;

  @Prop({ type: String, maxlength: 2000 })
  adminNotes?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);

// Unique constraint: one report per user per message
ReportSchema.index({ userId: 1, messageId: 1 }, { unique: true });
ReportSchema.index({ messageId: 1, source: 1 }, { unique: true, partialFilterExpression: { source: 'system_correction' } });
ReportSchema.index({ status: 1, createdAt: -1 });

// JSON transform
ReportSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
