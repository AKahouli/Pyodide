import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowExecutionLeaseDocument = HydratedDocument<FlowExecutionLease>;

@Schema({ timestamps: true })
export class FlowExecutionLease {
  @Prop({ required: true, type: String, index: true })
  executionId!: string;

  @Prop({ required: true, type: String })
  ownerId!: string;

  @Prop({ required: true, type: String })
  flowId!: string;

  @Prop({ required: true, type: String, enum: ['global', 'owner', 'flow', 'provider', 'model'] })
  scopeType!: 'global' | 'owner' | 'flow' | 'provider' | 'model';

  @Prop({ required: true, type: String })
  scopeKey!: string;

  @Prop({ required: true, type: Number, min: 0 })
  slot!: number;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  createdAt?: Date;

  updatedAt?: Date;
}

export const FlowExecutionLeaseSchema = SchemaFactory.createForClass(FlowExecutionLease);

FlowExecutionLeaseSchema.index({ executionId: 1, scopeType: 1 }, { unique: true });
FlowExecutionLeaseSchema.index({ scopeKey: 1, slot: 1 }, { unique: true });
FlowExecutionLeaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
