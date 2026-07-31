import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EvaluationSettingsDocument = HydratedDocument<EvaluationSettings>;

@Schema({ _id: false })
export class ResponseCorrectionSettingsSchemaClass {
  @Prop({ type: Number, default: 70 })
  threshold!: number;

  @Prop({ type: Number, default: 1 })
  maxAttempts!: number;

  @Prop({ type: Number, default: 60000 })
  maxDurationMs!: number;

  @Prop({ type: Boolean, default: false })
  allowAdditionalDocumentRetrieval!: boolean;

  @Prop({ type: Boolean, default: false })
  allowConnectorQueries!: boolean;

  @Prop({ type: Boolean, default: false })
  allowCalculationReruns!: boolean;

  @Prop({ type: String, enum: ['publish_with_warning', 'abstain', 'require_human_review'], default: 'publish_with_warning' })
  failureBehavior!: 'publish_with_warning' | 'abstain' | 'require_human_review';

  @Prop({ type: Boolean, default: true })
  showOriginalAnswer!: boolean;
}

const ResponseCorrectionSettingsSchema = SchemaFactory.createForClass(ResponseCorrectionSettingsSchemaClass);

@Schema({ _id: false })
export class ResponseReliabilitySettingsSchemaClass {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: String, enum: ['informative', 'corrective_transparent', 'corrective_guarded'], default: 'informative' })
  mode!: 'informative' | 'corrective_transparent' | 'corrective_guarded';

  @Prop({ type: String, default: null })
  judgeModelId!: string | null;

  @Prop({ type: Number, default: 3 })
  maxConcurrentEvaluations!: number;

  @Prop({ type: Number, default: 30000 })
  timeoutMs!: number;

  @Prop({ type: Number, default: 5 })
  maxFindings!: number;

  @Prop({ type: ResponseCorrectionSettingsSchema, required: true, default: () => ({}) })
  correction!: ResponseCorrectionSettingsSchemaClass;
}

const ResponseReliabilitySettingsSchema = SchemaFactory.createForClass(
  ResponseReliabilitySettingsSchemaClass,
);

@Schema({ collection: 'evaluation_settings', timestamps: true })
export class EvaluationSettings {
  @Prop({ type: String, required: true, unique: true, default: 'global' })
  key!: string;

  @Prop({ type: ResponseReliabilitySettingsSchema, required: true, default: () => ({}) })
  responseReliability!: ResponseReliabilitySettingsSchemaClass;
}

export const EvaluationSettingsSchema = SchemaFactory.createForClass(EvaluationSettings);
