import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ClassificationRunDocument = HydratedDocument<ClassificationRun>;

export enum ClassificationRunStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Schema({
  timestamps: true,
  collection: 'classification_runs',
})
export class ClassificationRun extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ClassificationRunStatus,
    default: ClassificationRunStatus.QUEUED,
    index: true,
  })
  status!: ClassificationRunStatus;

  @Prop({ type: Types.ObjectId, ref: 'Playbook', required: true })
  playbookId!: Types.ObjectId;

  @Prop({ type: String })
  playbookExecutionId?: string;

  @Prop({ type: String, maxlength: 2000 })
  hint?: string;

  @Prop({ type: Boolean, default: false })
  overwriteExisting!: boolean;

  @Prop({ type: Number, default: 0 })
  totalFiles!: number;

  @Prop({ type: Number, default: 0 })
  classifiedFiles!: number;

  @Prop({ type: String })
  error?: string;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  finishedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  triggeredBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ClassificationRunSchema = SchemaFactory.createForClass(ClassificationRun);

ClassificationRunSchema.index({ workspaceId: 1, createdAt: -1 });
ClassificationRunSchema.index({ status: 1, createdAt: -1 });

ClassificationRunSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
