import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export class MessageComponentSchema {
  @Prop({ type: String })
  id?: string;

  @Prop({ type: String, required: true, enum: ['text', 'code', 'reasoning', 'plan', 'queue', 'checkpoint', 'chart', 'task', 'error', 'sources', 'sandbox', 'webPreview', 'artifact', 'citation'] })
  type!: string;

  @Prop({ type: Object, required: true })
  data!: Record<string, unknown>;
}

@Schema({
  timestamps: true,
  collection: 'messages',
})
export class Message extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  senderId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message', index: true })
  parentMessageId?: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['user', 'ai'] })
  conversationType!: string;

  // User messages
  @Prop({ type: String, maxlength: 50000 })
  content?: string;

  // AI messages - structured components (id preserved for citation parent matching, _id disabled)
  @Prop({
    type: [new MongooseSchema({
      id: String,
      type: { type: String, required: true, enum: ['text', 'code', 'reasoning', 'plan', 'queue', 'checkpoint', 'chart', 'task', 'error', 'sources', 'sandbox', 'webPreview', 'artifact', 'citation'] },
      data: { type: MongooseSchema.Types.Mixed, required: true },
    }, { _id: false })],
    default: undefined,
  })
  components?: MessageComponentSchema[];

  // File attachments (in system workspace)
  @Prop({ type: [{ type: Types.ObjectId, ref: 'WorkspaceDocument' }], default: undefined })
  attachedFileIds?: Types.ObjectId[];

  // Mentioned agent IDs (for regenerate)
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Agent' }], default: undefined })
  agentIds?: Types.ObjectId[];

  // Mentioned member IDs
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: undefined })
  memberIds?: Types.ObjectId[];

  // AI metadata
  @Prop({ type: String, maxlength: 100 })
  modelId?: string;

  @Prop({ type: Boolean, default: false })
  webSearchEnabled!: boolean;

  // Bidirectional linking
  @Prop({ type: Types.ObjectId, ref: 'Message' })
  questionMessageId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message' })
  answerMessageId?: Types.ObjectId;

  // Feedback
  @Prop({ type: String, enum: ['like', 'dislike'] })
  feedback?: string;

  @Prop({ type: Date })
  feedbackAt?: Date;

  // Edit tracking
  @Prop({ type: Boolean, default: false })
  isEdited!: boolean;

  @Prop({ type: Date })
  editedAt?: Date;

  // Streaming state
  @Prop({ type: Boolean, default: false })
  isStreaming!: boolean;

  @Prop({ type: Boolean, default: false })
  isComplete!: boolean;

  // Token usage
  @Prop({ type: Number })
  inputTokens?: number;

  @Prop({ type: Number })
  outputTokens?: number;

  @Prop({ type: Number })
  durationMs?: number;

  @Prop({ type: Number })
  timeToFirstChunk?: number;

  @Prop({ type: Number })
  timeToFirstToken?: number;

  // Request tracking for log correlation
  @Prop({ type: String, index: true })
  requestId?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Indexes
MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ conversationId: 1, createdAt: -1 }); // Descending sort for paginated message fetch
MessageSchema.index({ conversationId: 1, conversationType: 1 });
MessageSchema.index({ questionMessageId: 1, conversationType: 1, createdAt: 1 }); // Branch queries
MessageSchema.index({ isStreaming: 1, updatedAt: 1 });
MessageSchema.index({ requestId: 1 });

// JSON transform
MessageSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
