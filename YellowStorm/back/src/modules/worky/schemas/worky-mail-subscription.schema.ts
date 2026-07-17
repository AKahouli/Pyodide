import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type WorkyMailSubscriptionDocument = HydratedDocument<WorkyMailSubscription>;

/**
 * One Microsoft Graph inbox subscription per user mailbox — never one per step.
 *
 * A Graph inbox subscription cannot filter by sender or conversation: it fires
 * for every mail that arrives. So N per-step subscriptions on one mailbox would
 * deliver N duplicate notifications for every single email, and burn the
 * per-mailbox subscription limit within a handful of concurrent sessions. One
 * subscription per mailbox, and the routing token decides which step (if any) a
 * given mail belongs to.
 */
@Schema({
  timestamps: true,
  collection: 'worky_mail_subscriptions',
})
export class WorkyMailSubscription extends Document {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /** The connected-app key the user's M365 token was actually found under. */
  @Prop({ type: String, required: true })
  mailboxAppKey!: string;

  @Prop({ type: String, required: true, index: true })
  subscriptionId!: string;

  /**
   * Shared secret echoed by Graph on every notification, and the only thing
   * proving a notification came from the subscription we created. Random per
   * subscription — the playbook trigger reuses its flowId here, which is
   * guessable; do not copy that.
   */
  @Prop({ type: String, required: true, index: true })
  clientState!: string;

  /** Graph caps mailbox subscriptions at 72h; the renewal cron pushes this out. */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  /** Cursor for the catch-up sweep — how far the inbox has been re-read. */
  @Prop({ type: Date, default: null })
  lastSweptAt?: Date | null;
}

export const WorkyMailSubscriptionSchema =
  SchemaFactory.createForClass(WorkyMailSubscription);

// One live subscription per mailbox — the whole point of the per-mailbox model.
WorkyMailSubscriptionSchema.index({ userId: 1, mailboxAppKey: 1 }, { unique: true });
