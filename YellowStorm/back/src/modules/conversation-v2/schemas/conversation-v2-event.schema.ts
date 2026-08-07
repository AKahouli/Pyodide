import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ConversationV2EventDocument = HydratedDocument<ConversationV2Event>;

export type ConversationV2EventTypeName =
  | 'message'
  | 'tool'
  | 'step'
  | 'plan'
  | 'title'
  | 'done'
  | 'wait'
  | 'error'
  | 'application_component'
  | 'app_build_progress';

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'conversation_v2_events',
})
export class ConversationV2Event extends Document {
  @Prop({ required: true, index: true })
  sessionId!: string;

  // Per-session monotonic int. Unique with sessionId.
  @Prop({ required: true })
  sequence!: number;

  // The AI service's event_id from the gRPC frame. Unique with sessionId
  // so a retried gRPC chunk cannot duplicate a row.
  @Prop({ required: true })
  eventId!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['message', 'tool', 'step', 'plan', 'title', 'done', 'wait', 'error', 'application_component', 'app_build_progress'],
  })
  type!: ConversationV2EventTypeName;

  // AI service's wire timestamp (epoch seconds).
  @Prop({ type: Number, required: true })
  emittedAt!: number;

  // Payload shape matches the discriminated union in
  // types/conversation-v2.types.ts (minus the outer type/event_id/timestamp,
  // which live in their own columns).
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  payload!: Record<string, unknown>;

  // Captured from ChatRequest.model on the first assistant `message` event
  // of a stream. Same string the wire used ("azure/gpt-4.1", etc.).
  @Prop({ type: String, maxlength: 200, default: null })
  modelId?: string | null;

  createdAt!: Date;
}

export const ConversationV2EventSchema =
  SchemaFactory.createForClass(ConversationV2Event);

ConversationV2EventSchema.index({ sessionId: 1, sequence: 1 }, { unique: true });
ConversationV2EventSchema.index({ sessionId: 1, eventId: 1 }, { unique: true });
ConversationV2EventSchema.index({ sessionId: 1, type: 1, sequence: 1 });

ConversationV2EventSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});
