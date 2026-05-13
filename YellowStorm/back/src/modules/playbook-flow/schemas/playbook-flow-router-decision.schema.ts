import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowRouterDecisionDocument = HydratedDocument<FlowRouterDecision>;

@Schema({ timestamps: { createdAt: 'decidedAt', updatedAt: false } })
export class FlowRouterDecision {
  @Prop({ required: true, type: String })
  executionId!: string;

  @Prop({ required: true, type: String })
  routerNodeId!: string;

  @Prop({ required: true, type: Number, default: 0 })
  iteration!: number;

  @Prop({ required: true, type: String })
  label!: string;

  @Prop({ type: Date })
  decidedAt!: Date;
}

export const FlowRouterDecisionSchema = SchemaFactory.createForClass(FlowRouterDecision);

FlowRouterDecisionSchema.index({ executionId: 1, decidedAt: 1 });
FlowRouterDecisionSchema.index({ executionId: 1, routerNodeId: 1, iteration: 1 });

FlowRouterDecisionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
