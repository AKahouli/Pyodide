import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlaybookAssistantRevisionDocument = HydratedDocument<PlaybookAssistantRevision>;

@Schema({ timestamps: true })
export class PlaybookAssistantRevision {
  @Prop({ required: true, type: String, unique: true, index: true })
  operationId!: string;

  @Prop({ required: true, type: String, index: true })
  playbookId!: string;

  @Prop({ required: true, type: String, index: true })
  ownerId!: string;

  @Prop({ required: true, type: Number, min: 0 })
  definitionRevision!: number;

  @Prop({ required: true, type: Object })
  definition!: Record<string, unknown>;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;
}

export const PlaybookAssistantRevisionSchema = SchemaFactory.createForClass(PlaybookAssistantRevision);
PlaybookAssistantRevisionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
