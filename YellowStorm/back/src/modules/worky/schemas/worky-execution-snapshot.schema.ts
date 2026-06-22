import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyExecutionSnapshotDocument = HydratedDocument<WorkyExecutionSnapshot>;

/**
 * Immutable record of the plan state at the moment the owner clicked
 * Start Stream. Created by `worky-execution.service.ts` in Part 2/3.
 */
@Schema({
  timestamps: true,
  collection: 'worky_execution_snapshots',
})
export class WorkyExecutionSnapshot extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  planVersion!: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  startedByUserId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  startedAt!: Date;

  @Prop({ type: [Types.ObjectId], ref: 'WorkyTask', default: [] })
  readyTaskIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'WorkyTask', default: [] })
  blockedTaskIds!: Types.ObjectId[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyExecutionSnapshotSchema = SchemaFactory.createForClass(WorkyExecutionSnapshot);

WorkyExecutionSnapshotSchema.index({ streamId: 1, planVersion: 1 }, { unique: true });

WorkyExecutionSnapshotSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
