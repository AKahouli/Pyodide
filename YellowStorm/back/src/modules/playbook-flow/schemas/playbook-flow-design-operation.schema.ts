import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FlowDesignOperationDocument = HydratedDocument<FlowDesignOperation>;

export type FlowDesignOperationStatus =
  | 'queued'
  | 'running'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'cancelled';

@Schema({ timestamps: true })
export class FlowDesignOperation {
  @Prop({ required: true, type: Types.ObjectId, index: true })
  flowId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  ownerId!: Types.ObjectId;

  @Prop({ required: true, type: String })
  query!: string;

  @Prop({ required: true, type: String, enum: ['queued', 'running', 'applying', 'completed', 'failed', 'cancelled'], default: 'queued' })
  status!: FlowDesignOperationStatus;

  @Prop({ required: false, type: String })
  idempotencyKey?: string;

  @Prop({ required: false, type: Date })
  startedAt?: Date;

  @Prop({ required: false, type: Date })
  completedAt?: Date;

  @Prop({ required: false, type: String, default: null })
  error?: string | null;

  @Prop({ required: false, type: Object, default: null })
  snapshotBefore?: Record<string, unknown> | null;

  @Prop({ required: false, type: Object, default: null })
  resultPreview?: Record<string, unknown> | null;

  @Prop({ required: false, type: Types.ObjectId, default: null })
  appliedMessageId?: Types.ObjectId | null;

  @Prop({ required: true, type: Number, default: 0 })
  lockVersion!: number;

  createdAt?: Date;

  updatedAt?: Date;
}

export const FlowDesignOperationSchema = SchemaFactory.createForClass(FlowDesignOperation);

FlowDesignOperationSchema.index({ flowId: 1, status: 1, createdAt: 1 });
FlowDesignOperationSchema.index({ ownerId: 1, status: 1, createdAt: 1 });
FlowDesignOperationSchema.index(
  { ownerId: 1, flowId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

FlowDesignOperationSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
