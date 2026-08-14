import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorkyMessageComponentDocument = WorkyMessageComponent & Document;

@Schema({ timestamps: true, collection: 'worky_message_components' })
export class WorkyMessageComponent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  /** The manager's Postgres `message_components.component_id` — idempotent upsert key. */
  @Prop({ type: String, default: null })
  externalId?: string | null;

  /** Parent manager message: Postgres `messages.id` (== WorkyMessage.externalId). */
  @Prop({ type: String, required: true, index: true })
  messageExternalId!: string;

  @Prop({ type: Number, default: 0 })
  ordinal!: number;

  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Object, default: {} })
  data!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyMessageComponentSchema = SchemaFactory.createForClass(WorkyMessageComponent);

WorkyMessageComponentSchema.index({ streamId: 1, messageExternalId: 1, ordinal: 1 });
WorkyMessageComponentSchema.index(
  { streamId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);
WorkyMessageComponentSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
