import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernanceMetricDocument = HydratedDocument<GovernanceMetric>;

@Schema({ timestamps: true, collection: 'governance_metrics' })
export class GovernanceMetric extends Document {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true })
  programId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', index: true })
  scopeId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeployment', index: true })
  deploymentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', index: true })
  agentId?: Types.ObjectId;

  @Prop({ type: String, enum: ['widget', 'whatsapp', 'telegram', 'api'] })
  channel?: string;

  @Prop({ required: true, trim: true, maxlength: 120, index: true })
  type!: string;

  @Prop({ required: true })
  value!: number;

  @Prop({ type: Object, default: {} })
  dimensions!: Record<string, string>;

  @Prop({ type: Date, required: true, index: true })
  periodStart!: Date;

  @Prop({ type: Date, required: true, index: true })
  periodEnd!: Date;
}

export const GovernanceMetricSchema = SchemaFactory.createForClass(GovernanceMetric);

GovernanceMetricSchema.index({ programId: 1, periodStart: -1 });
