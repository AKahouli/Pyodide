import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyMailEventLedgerDocument = HydratedDocument<WorkyMailEventLedger>;

/**
 * Append-only ledger of outbound mail events emitted by Worky tasks.
 * `dedupKey` is unique per row so retrying a send never produces a second
 * delivery (Part 3/4 `worky-human-assignment.service.ts`).
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'worky_mail_event_ledger',
})
export class WorkyMailEventLedger extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyTask', default: null })
  taskId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, maxlength: 100 })
  kind!: string;

  @Prop({ type: String, required: true, maxlength: 200 })
  dedupKey!: string;

  @Prop({ type: Date, required: true })
  sentAt!: Date;

  createdAt!: Date;
}

export const WorkyMailEventLedgerSchema = SchemaFactory.createForClass(WorkyMailEventLedger);

WorkyMailEventLedgerSchema.index({ streamId: 1, dedupKey: 1 }, { unique: true });
WorkyMailEventLedgerSchema.index({ taskId: 1 });

WorkyMailEventLedgerSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
