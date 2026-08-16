import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlaybookAssistantAttachmentDocument = HydratedDocument<PlaybookAssistantAttachment>;

@Schema({ timestamps: true })
export class PlaybookAssistantAttachment {
  @Prop({ required: true, type: String, unique: true, index: true })
  attachmentId!: string;

  @Prop({ required: true, type: String, index: true })
  requestId!: string;

  @Prop({ required: true, type: String, index: true })
  ownerId!: string;

  @Prop({ required: true, type: String, index: true })
  playbookId!: string;

  @Prop({ required: true, type: Number, min: 0 })
  expectedDefinitionRevision!: number;

  @Prop({ required: true, type: String })
  objectKey!: string;

  @Prop({ required: true, type: String })
  mediaType!: string;

  @Prop({ required: true, type: Number, min: 1 })
  declaredSize!: number;

  @Prop({ required: false, type: Number, min: 1, default: null })
  actualSize?: number | null;

  @Prop({ required: false, type: String, default: null })
  contentSha256?: string | null;

  @Prop({ required: true, type: String, enum: ['pending', 'confirmed'], default: 'pending', index: true })
  status!: 'pending' | 'confirmed';

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  createdAt?: Date;
}

export const PlaybookAssistantAttachmentSchema = SchemaFactory.createForClass(PlaybookAssistantAttachment);
PlaybookAssistantAttachmentSchema.index({ ownerId: 1, requestId: 1, createdAt: 1 });
PlaybookAssistantAttachmentSchema.index({ expiresAt: 1 });
