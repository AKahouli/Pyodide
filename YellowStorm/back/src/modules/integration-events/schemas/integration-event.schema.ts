import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { IntegrationEventStatus } from '../interfaces/integration-event.interface';
export type IntegrationEventDocument = HydratedDocument<IntegrationEvent>;
@Schema({ timestamps: true, collection: 'integration_events' })
export class IntegrationEvent {
  @Prop({ required: true, unique: true, index: true }) eventId!: string;
  @Prop({ required: true, index: true }) eventType!: string;
  @Prop({ required: true, index: true }) aggregateType!: string;
  @Prop({ required: true, index: true }) aggregateId!: string;
  @Prop({ type: Object, required: true }) payload!: Record<string, unknown>;
  @Prop({ required: true, index: true }) occurredAt!: Date;
  @Prop({ type: String, enum: ['pending', 'processing', 'completed', 'failed', 'dead_letter'], default: 'pending', index: true }) status!: IntegrationEventStatus;
  @Prop({ default: 0, min: 0 }) attempts!: number;
  @Prop({ index: true }) nextAttemptAt?: Date;
  @Prop() lockedAt?: Date;
  @Prop() lockOwner?: string;
  @Prop() processedAt?: Date;
  @Prop({ maxlength: 2000 }) lastError?: string;
  @Prop({ index: true }) correlationId?: string;
  @Prop() causationId?: string;
}
export const IntegrationEventSchema = SchemaFactory.createForClass(IntegrationEvent);
IntegrationEventSchema.index({ status: 1, nextAttemptAt: 1 });
IntegrationEventSchema.index({ lockedAt: 1 });
IntegrationEventSchema.index({ aggregateType: 1, aggregateId: 1, occurredAt: 1 });
