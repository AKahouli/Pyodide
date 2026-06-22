import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyInteractionDocument = HydratedDocument<WorkyInteraction>;

/**
 * A pending clarification/approval/review/etc. raised by the Manager and
 * answered by the stream owner (or another human) via
 * `POST /worky/interactions/{id}/respond`. Lifecycle logic lives in
 * `worky-interaction.service.ts` (Part 2/3).
 */
@Schema({
  timestamps: true,
  collection: 'worky_interactions',
})
export class WorkyInteraction extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyTask', default: null })
  taskId?: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: [
      'clarification',
      'approval',
      'review',
      'missing_input',
      'assignment_disambiguation',
      'budget_decision',
      'deadline_decision',
      'escalation_decision',
      'replan_review',
    ],
    required: true,
  })
  type!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  targetUserId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, maxlength: 5000 })
  question!: string;

  @Prop({ type: [String], default: [] })
  options!: string[];

  @Prop({
    type: String,
    enum: ['pending', 'responded', 'canceled', 'expired'],
    required: true,
    default: 'pending',
    index: true,
  })
  status!: string;

  @Prop({ type: String, default: 'stream' })
  blockingScope!: string;

  @Prop({ type: [Types.ObjectId], ref: 'WorkyTask', default: [] })
  blocksTaskIds!: Types.ObjectId[];

  @Prop({ type: Date, default: null })
  respondedAt?: Date | null;

  @Prop({ type: String, default: null, maxlength: 5000 })
  response?: string | null;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyInteractionSchema = SchemaFactory.createForClass(WorkyInteraction);

WorkyInteractionSchema.index({ streamId: 1, status: 1 });
WorkyInteractionSchema.index({ targetUserId: 1, status: 1 });

WorkyInteractionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
