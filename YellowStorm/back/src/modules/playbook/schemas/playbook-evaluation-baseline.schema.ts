import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type PlaybookEvaluationBaselineDocument = HydratedDocument<PlaybookEvaluationBaseline>;

@Schema({ _id: false })
export class PlaybookEvaluationBaselineArtifactSnapshot {
  @Prop({ type: String, default: null })
  id!: string | null;

  @Prop({ type: String, required: true, enum: ['text', 'document', 'code', 'image', 'data', 'dashboard'] })
  kind!: string;

  @Prop({ type: String, default: null })
  name!: string | null;

  @Prop({ type: String, default: null })
  mimeType!: string | null;

  @Prop({ type: String, default: null })
  uri!: string | null;

  @Prop({ type: String, default: null })
  textPreview!: string | null;

  @Prop({ type: Object, default: null })
  metadata!: Record<string, unknown> | null;
}

export const PlaybookEvaluationBaselineArtifactSnapshotSchema = SchemaFactory.createForClass(PlaybookEvaluationBaselineArtifactSnapshot);

@Schema({ _id: false })
export class PlaybookEvaluationBaselineInputSnapshot {
  @Prop({ type: String, required: true })
  sourceTaskId!: string;

  @Prop({ type: String, default: null })
  sourceOutputPortId!: string | null;

  @Prop({ type: String, default: null })
  targetInputPortId!: string | null;

  @Prop({ type: String, default: null })
  output!: string | null;

  @Prop({ type: [PlaybookEvaluationBaselineArtifactSnapshotSchema], default: [], _id: false })
  artifacts!: PlaybookEvaluationBaselineArtifactSnapshot[];
}

export const PlaybookEvaluationBaselineInputSnapshotSchema = SchemaFactory.createForClass(PlaybookEvaluationBaselineInputSnapshot);

@Schema({ timestamps: true, collection: 'playbook_evaluation_baselines' })
export class PlaybookEvaluationBaseline extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Playbook', required: true, index: true })
  playbookId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  evaluationTaskId!: string;

  @Prop({ type: Types.ObjectId, ref: 'PlaybookExecution', required: true })
  sourceExecutionId!: Types.ObjectId;

  @Prop({ type: String, enum: ['selected_execution', 'current_inputs'], required: true })
  sourceMode!: string;

  @Prop({ type: [PlaybookEvaluationBaselineInputSnapshotSchema], default: [], _id: false })
  inputSnapshots!: PlaybookEvaluationBaselineInputSnapshot[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdByUserId!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  replacedAt!: Date | null;
}

export const PlaybookEvaluationBaselineSchema = SchemaFactory.createForClass(PlaybookEvaluationBaseline);
PlaybookEvaluationBaselineSchema.index({ playbookId: 1, evaluationTaskId: 1, replacedAt: 1 });
