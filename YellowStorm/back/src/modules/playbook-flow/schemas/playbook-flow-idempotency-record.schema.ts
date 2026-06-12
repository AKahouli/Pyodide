import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowIdempotencyRecordDocument = HydratedDocument<FlowIdempotencyRecord>;

@Schema({ timestamps: true })
export class FlowIdempotencyRecord {
  @Prop({ required: true, type: String })
  ownerId!: string;

  @Prop({ required: true, type: String })
  idempotencyKey!: string;

  @Prop({ required: true, type: String })
  payloadHash!: string;

  @Prop({ required: false, type: String })
  executionId?: string;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;
}

export const FlowIdempotencyRecordSchema = SchemaFactory.createForClass(FlowIdempotencyRecord);

FlowIdempotencyRecordSchema.index({ ownerId: 1, idempotencyKey: 1 }, { unique: true });
FlowIdempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
FlowIdempotencyRecordSchema.index({ executionId: 1 });
