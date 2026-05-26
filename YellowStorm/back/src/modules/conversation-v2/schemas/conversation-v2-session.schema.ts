import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ConversationV2SessionDocument = HydratedDocument<ConversationV2Session>;

export type ConversationV2SessionStatus =
  | 'active'
  | 'waiting'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error';

@Schema({ timestamps: true, collection: 'conversation_v2_sessions' })
export class ConversationV2Session extends Document {
  @Prop({ required: true })
  ownerId!: string;

  // AI service's session id (returned by gRPC.CreateSession). Optional
  // because it's only set AFTER gRPC succeeds — doc-first creation inserts
  // the pointer with aiSessionId=null, then patches it. Stored only for
  // gRPC routing; never exposed externally. The document's `_id` is the
  // canonical session id.
  @Prop({ type: String, default: null })
  aiSessionId?: string | null;

  @Prop({ default: '' })
  title!: string;

  @Prop({
    type: String,
    enum: ['active', 'waiting', 'paused', 'stopped', 'completed', 'error'],
    default: 'active',
  })
  status!: ConversationV2SessionStatus;

  @Prop({ type: Date, default: () => new Date() })
  lastEventAt!: Date;

  @Prop({ default: false })
  isShared!: boolean;

  @Prop({ type: String, default: null, index: true, sparse: true })
  shareTokenHash!: string | null;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  // Workspace ObjectIds the user attached to this session via the frontend selector.
  // Persisted so the UI can re-display the selection on session reload. Access is
  // re-checked at chat time — entries here may become stale if the user loses access.
  @Prop({ type: [String], default: [] })
  workspaceIds!: string[];

  // Per-session monotonic counter assigned to every persisted event. Bumped
  // atomically via $inc inside ConversationV2EventStoreService.append.
  @Prop({ type: Number, default: 0, min: 0 })
  eventSequence!: number;

  // Cheap "has any event ever been persisted" check; $inc'ed alongside
  // eventSequence so the two stay in lockstep.
  @Prop({ type: Number, default: 0, min: 0 })
  eventCount!: number;

  // Per-session workspace that holds AI-generated artifacts (harvested from
  // assistant message events) and user-uploaded files. Created eagerly at
  // POST /sessions and cascade-deleted on DELETE /sessions. Optional because
  // sessions created before this rework don't have one.
  @Prop({ type: Types.ObjectId, ref: 'Workspace', default: null })
  systemWorkspaceId?: Types.ObjectId | null;
}

export const ConversationV2SessionSchema =
  SchemaFactory.createForClass(ConversationV2Session);

ConversationV2SessionSchema.index({ ownerId: 1, deletedAt: 1, lastEventAt: -1 });
ConversationV2SessionSchema.index({ aiSessionId: 1 }, { sparse: true });

ConversationV2SessionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.shareTokenHash;
    return ret;
  },
});
