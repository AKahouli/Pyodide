import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorkyPlanStepArtifactDocument = WorkyPlanStepArtifact & Document;

@Schema({ timestamps: true, collection: 'worky_plan_step_artifacts' })
export class WorkyPlanStepArtifact extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  /** Postgres `plan_step_artifacts.artifact_id` — idempotent upsert key. */
  @Prop({ type: String, default: null })
  externalId?: string | null;

  /** Parent step: Postgres `plan_steps.step_id` (== WorkyTask.externalId). */
  @Prop({ type: String, required: true, index: true })
  stepExternalId!: string;

  @Prop({ type: String, required: true })
  filePath!: string;

  @Prop({ type: String, required: true })
  filename!: string;

  @Prop({ type: String, default: null })
  artifactKind?: string | null;

  @Prop({ type: String, default: null })
  mimeType?: string | null;

  @Prop({ type: Number, default: null })
  size?: number | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyPlanStepArtifactSchema = SchemaFactory.createForClass(WorkyPlanStepArtifact);

WorkyPlanStepArtifactSchema.index({ streamId: 1, stepExternalId: 1, createdAt: 1 });
WorkyPlanStepArtifactSchema.index(
  { streamId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);
WorkyPlanStepArtifactSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
