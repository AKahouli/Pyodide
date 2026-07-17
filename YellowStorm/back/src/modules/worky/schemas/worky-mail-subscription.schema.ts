import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type WorkyMailSubscriptionDocument = HydratedDocument<WorkyMailSubscription>;

/**
 * One watched mailbox per user — never one per step.
 *
 * A Graph inbox subscription cannot filter by sender or conversation: it fires
 * for every mail that arrives. So N per-step subscriptions on one mailbox would
 * deliver N duplicate notifications for every single email, and burn the
 * per-mailbox subscription limit within a handful of concurrent sessions. One
 * per mailbox, and the routing token decides which step (if any) a given mail
 * belongs to.
 *
 * The row exists whether or not a Graph subscription does. The push path needs
 * a public webhook URL; the catch-up poll needs nothing but a token, and this
 * row is how the poll knows which mailbox to read. Without it a deployment with
 * no public URL could not route replies at all — instead it routes them a few
 * minutes late.
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

  /** Null when there is no public webhook: the mailbox is polled, not pushed. */
  @Prop({ type: String, default: null, index: true })
  subscriptionId?: string | null;

  /**
   * Shared secret echoed by Graph on every notification, and the only thing
   * proving a notification came from the subscription we created. Random per
   * subscription — the playbook trigger reuses its flowId here, which is
   * guessable; do not copy that. Null when polling.
   */
  @Prop({ type: String, default: null, index: true })
  clientState?: string | null;

  /** Graph caps mailbox subscriptions at 72h; the renewal cron pushes this out. */
  @Prop({ type: Date, default: null })
  expiresAt?: Date | null;

  /** Cursor for the catch-up sweep — how far the inbox has been re-read. */
  @Prop({ type: Date, default: null })
  lastSweptAt?: Date | null;
}

export const WorkyMailSubscriptionSchema =
  SchemaFactory.createForClass(WorkyMailSubscription);

// One live subscription per mailbox — the whole point of the per-mailbox model.
WorkyMailSubscriptionSchema.index({ userId: 1, mailboxAppKey: 1 }, { unique: true });
