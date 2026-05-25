import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class FlowScheduleTriggerConfig {
  @Prop({ required: true, type: Boolean })
  enabled!: boolean;

  @Prop({ required: false, type: String })
  timezone?: string;

  @Prop({ required: false, type: String })
  scheduleType?: string;

  @Prop({ required: false, type: String })
  cronExpression?: string;

  @Prop({ required: false, type: Number })
  dayOfMonth?: number;

  @Prop({ required: false, type: Number })
  dayOfWeek?: number;

  @Prop({ required: false, type: String })
  timeOfDay?: string;

  @Prop({ required: false, type: [String] })
  days?: string[];
}

@Schema({ _id: false })
export class FlowMailTriggerFilters {
  @Prop({ type: [String], default: [] })
  from!: string[];

  @Prop({ type: [String], default: [] })
  subjectContains!: string[];

  @Prop({ type: [String], default: [] })
  bodyContains!: string[];

  @Prop({ type: Boolean, default: null })
  hasAttachments!: boolean | null;
}

@Schema({ _id: false })
export class FlowMailTriggerConfig {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: String, default: null })
  mailboxAppKey?: string | null;

  @Prop({ type: String, default: null })
  notificationUrl?: string | null;

  @Prop({ type: Date, default: null })
  autoRenewUntil?: Date | null;

  @Prop({ type: Boolean, default: false })
  attachmentImportEnabled?: boolean;

  @Prop({ type: [String], default: [] })
  allowedAttachmentExtensions?: string[];

  @Prop({ type: Boolean, default: false })
  runtimeEnabled?: boolean;

  @Prop({ type: String, default: null })
  subscriptionId?: string | null;

  @Prop({ type: String, default: null })
  subscriptionClientState?: string | null;

  @Prop({ type: Date, default: null })
  subscriptionExpiresAt?: Date | null;

  @Prop({ type: FlowMailTriggerFilters, default: () => ({}) })
  filters?: FlowMailTriggerFilters;
}

export const FlowScheduleTriggerConfigSchema = SchemaFactory.createForClass(FlowScheduleTriggerConfig);
export const FlowMailTriggerConfigSchema = SchemaFactory.createForClass(FlowMailTriggerConfig);
export const FlowMailTriggerFiltersSchema = SchemaFactory.createForClass(FlowMailTriggerFilters);
