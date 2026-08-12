import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GuardrailsSettingsDocument = HydratedDocument<GuardrailsSettings>;

@Schema({ _id: false })
export class PromptInjectionGuardrailsSettings {
  @Prop({ type: Boolean, default: false })
  inputEnabled!: boolean;

  @Prop({ type: Boolean, default: false })
  outputEnabled!: boolean;

  @Prop({ type: String, enum: ['monitor', 'balanced', 'strict'], default: 'balanced' })
  mode!: 'monitor' | 'balanced' | 'strict';

  @Prop({ type: String, default: '' })
  inputClassifierPrompt!: string;

  @Prop({ type: String, default: '' })
  outputClassifierPrompt!: string;

  @Prop({ type: String, default: 'I cannot follow this instruction.' })
  blockMessage!: string;
}

const PromptInjectionGuardrailsSettingsSchema = SchemaFactory.createForClass(PromptInjectionGuardrailsSettings);

@Schema({ _id: false })
export class ToolActionReviewSettings {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: String, enum: ['monitor', 'balanced', 'strict'], default: 'balanced' })
  mode!: 'monitor' | 'balanced' | 'strict';

  @Prop({ type: String, default: '' })
  classifierPrompt!: string;

  @Prop({ type: String, default: 'I cannot perform this action.' })
  blockMessage!: string;
}

const ToolActionReviewSettingsSchema = SchemaFactory.createForClass(ToolActionReviewSettings);

@Schema({ timestamps: true, collection: 'guardrails_settings' })
export class GuardrailsSettings {
  @Prop({ type: Boolean, default: false })
  forceActivation!: boolean;

  @Prop({ type: PromptInjectionGuardrailsSettingsSchema, default: () => ({}) })
  promptInjection!: PromptInjectionGuardrailsSettings;

  @Prop({ type: ToolActionReviewSettingsSchema, default: () => ({}) })
  toolActionReview!: ToolActionReviewSettings;
}

export const GuardrailsSettingsSchema = SchemaFactory.createForClass(GuardrailsSettings);
