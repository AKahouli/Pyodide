import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GuardrailsSettingsDocument = HydratedDocument<GuardrailsSettings>;

@Schema({ _id: false })
export class PromptInjectionGuardrailsSettings {
  @Prop({ type: Boolean, default: false })
  inputGuardrailEnabled!: boolean;

  @Prop({ type: Boolean, default: false })
  outputGuardrailEnabled!: boolean;

  @Prop({ type: Boolean, default: false })
  toolCallGuardrailEnabled!: boolean;

  @Prop({ type: String, default: '' })
  inputClassifierPrompt!: string;

  @Prop({ type: String, default: '' })
  outputClassifierPrompt!: string;

  @Prop({ type: String, default: '' })
  toolCallClassifierPrompt!: string;

  @Prop({ type: String, default: 'I cannot follow this instruction.' })
  blockMessage!: string;
}

const PromptInjectionGuardrailsSettingsSchema = SchemaFactory.createForClass(PromptInjectionGuardrailsSettings);

@Schema({ timestamps: true, collection: 'guardrails_settings' })
export class GuardrailsSettings {
  @Prop({ type: Boolean, default: false })
  forceActivation!: boolean;

  @Prop({ type: PromptInjectionGuardrailsSettingsSchema, default: () => ({}) })
  promptInjection!: PromptInjectionGuardrailsSettings;
}

export const GuardrailsSettingsSchema = SchemaFactory.createForClass(GuardrailsSettings);
