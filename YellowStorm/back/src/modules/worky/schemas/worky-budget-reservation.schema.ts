import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyBudgetReservationDocument = HydratedDocument<WorkyBudgetReservation>;

/**
 * Atomic USD/token reservation against a stream's budget. Reserved on
 * task start, released on completion/abort, deducted on actual cost
 * reconcile. `findOneAndUpdate` on `status` is the atomic primitive
 * (Part 4 / `worky-budget.service.ts`).
 */
@Schema({
  timestamps: true,
  collection: 'worky_budget_reservations',
})
export class WorkyBudgetReservation extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyTask', required: true, index: true })
  taskId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  amountUsd!: number;

  @Prop({ type: Number, required: true, min: 0 })
  tokens!: number;

  @Prop({
    type: String,
    enum: ['reserved', 'released', 'consumed', 'denied'],
    required: true,
    default: 'reserved',
  })
  status!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyBudgetReservationSchema = SchemaFactory.createForClass(WorkyBudgetReservation);

WorkyBudgetReservationSchema.index({ streamId: 1, status: 1 });
WorkyBudgetReservationSchema.index({ taskId: 1, status: 1 });

WorkyBudgetReservationSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
