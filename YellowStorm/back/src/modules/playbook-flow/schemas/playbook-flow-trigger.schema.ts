import { Prop, Schema } from '@nestjs/mongoose';

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
