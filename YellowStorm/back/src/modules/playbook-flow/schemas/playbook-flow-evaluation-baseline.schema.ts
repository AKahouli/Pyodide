import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowEvaluationBaselineDocument = HydratedDocument<FlowEvaluationBaseline>;

@Schema({ _id: false })
export class FlowEvaluationBaselineArtifactSnapshot {
  @Prop({ required: false, type: String })
  id?: string;

  @Prop({ required: true, type: String, enum: ['text', 'document', 'code', 'image', 'data', 'dashboard'] })
  kind!: string;

  @Prop({ required: false, type: String })
  name?: string;

  @Prop({ required: false, type: String })
  mimeType?: string;

  @Prop({ required: false, type: String })
  uri?: string;

  @Prop({ required: false, type: String })
  textPreview?: string;

  @Prop({ required: false, type: Object })
  metadata?: Record<string, unknown>;
}

@Schema({ _id: false })
export class FlowEvaluationBaselineInputSnapshot {
  @Prop({ required: true, type: String })
  sourceTaskId!: string;

  @Prop({ required: false, type: String })
  sourceOutputPortId?: string;

  @Prop({ required: false, type: String })
  targetInputPortId?: string;

  @Prop({ required: false, type: String })
  output?: string;

  @Prop({
    required: false,
    type: [SchemaFactory.createForClass(FlowEvaluationBaselineArtifactSnapshot)],
    default: [],
  })
  artifacts!: FlowEvaluationBaselineArtifactSnapshot[];
}

@Schema({ timestamps: true, collection: 'playbook_flow_evaluation_baselines' })
export class FlowEvaluationBaseline {
  @Prop({ required: true, type: String, index: true })
  flowId!: string;

  @Prop({ required: true, type: String, index: true })
  taskId!: string;

  @Prop({ required: true, type: Number, default: 0 })
  iteration!: number;

  @Prop({ required: true, type: String })
  sourceExecutionId!: string;

  @Prop({ required: true, type: String, enum: ['selected_execution', 'current_inputs'] })
  sourceMode!: string;

  @Prop({
    required: false,
    type: [SchemaFactory.createForClass(FlowEvaluationBaselineInputSnapshot)],
    default: [],
  })
  inputSnapshots!: FlowEvaluationBaselineInputSnapshot[];

  @Prop({ required: true, type: String })
  createdByUserId!: string;

  @Prop({ required: false, type: Date, default: null })
  replacedAt?: Date | null;
}

export const FlowEvaluationBaselineSchema = SchemaFactory.createForClass(FlowEvaluationBaseline);

FlowEvaluationBaselineSchema.index({ flowId: 1, taskId: 1, iteration: 1, replacedAt: 1 });

FlowEvaluationBaselineSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
