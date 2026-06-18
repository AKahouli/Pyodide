import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyTaskResultDocument = HydratedDocument<WorkyTaskResult>;

/**
 * Versioned output of a task. New attempts supersede prior results by
 * bumping `version`; rows are never deleted (canonical §3.3).
 */
@Schema({
  timestamps: true,
  collection: 'worky_task_results',
})
export class WorkyTaskResult extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyTask', required: true, index: true })
  taskId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  version!: number;

  @Prop({ type: String, required: true, maxlength: 100 })
  status!: string;

  @Prop({ type: String, default: '', maxlength: 5000 })
  summary!: string;

  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDocument', default: null })
  contentArtifactId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'WorkyEphemeralWorker', default: null })
  createdByWorkerId?: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyTaskResultSchema = SchemaFactory.createForClass(WorkyTaskResult);

WorkyTaskResultSchema.index({ taskId: 1, version: 1 }, { unique: true });

WorkyTaskResultSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
