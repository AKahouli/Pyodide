import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EvaluationSettingsDocument = HydratedDocument<EvaluationSettings>;

@Schema({ _id: false })
export class ResponseReliabilitySettingsSchemaClass {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: String, enum: ['informative'], default: 'informative' })
  mode!: 'informative';

  @Prop({ type: String, default: null })
  judgeModelId!: string | null;

  @Prop({ type: Number, default: 3 })
  maxConcurrentEvaluations!: number;

  @Prop({ type: Number, default: 30000 })
  timeoutMs!: number;

  @Prop({ type: Number, default: 5 })
  maxFindings!: number;
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
