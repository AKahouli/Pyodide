import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlaybookMascotConfirmationDocument = HydratedDocument<PlaybookMascotConfirmation>;

@Schema({ timestamps: true })
export class PlaybookMascotConfirmation {
  @Prop({ required: true, type: String })
  confirmationId!: string;

  @Prop({ required: true, type: String })
  tenantId!: string;

  @Prop({ required: true, type: String })
  userId!: string;

  @Prop({ required: true, type: String })
  agentId!: string;

  @Prop({ required: true, type: String })
  conversationId!: string;

  @Prop({ required: true, type: String })
  correlationId!: string;

  @Prop({ required: true, type: String })
  toolName!: string;

  @Prop({ required: true, type: String })
  argumentsHash!: string;

  @Prop({ required: false, type: String, select: false })
  activeKey?: string;

  @Prop({ required: true, type: Object, select: false })
  canonicalArguments!: Record<string, unknown>;

  @Prop({ required: true, type: Object })
  summary!: Record<string, unknown>;

  @Prop({ required: true, type: String })
  idempotencyKey!: string;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  @Prop({ required: false, type: String, select: false })
  continuationCorrelationId?: string;

  @Prop({ required: false, type: Date })
  consumedAt?: Date;

  @Prop({ required: false, type: Object, select: false })
  continuationResult?: Record<string, unknown>;

  @Prop({ required: true, type: String, enum: ['pending', 'confirmed', 'consuming', 'executing', 'rejected', 'expired', 'executed', 'failed'], default: 'pending' })
  status!: 'pending' | 'confirmed' | 'consuming' | 'executing' | 'rejected' | 'expired' | 'executed' | 'failed';

  @Prop({ required: false, type: String })
  executionId?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PlaybookMascotConfirmationSchema = SchemaFactory.createForClass(PlaybookMascotConfirmation);
PlaybookMascotConfirmationSchema.index({ confirmationId: 1 }, { unique: true });
PlaybookMascotConfirmationSchema.index(
  { activeKey: 1 },
  { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } },
);
PlaybookMascotConfirmationSchema.index({ tenantId: 1, userId: 1, agentId: 1, conversationId: 1, argumentsHash: 1, status: 1 });
PlaybookMascotConfirmationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
