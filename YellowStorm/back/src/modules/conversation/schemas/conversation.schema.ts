import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({
  timestamps: true,
  collection: 'conversations',
})
export class Conversation extends Document {
  @Prop({ type: String, trim: true, maxlength: 200, default: 'New Conversation' })
  title!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Message' }], default: [] })
  messages!: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Workspace' }], default: [] })
  workspaces!: Types.ObjectId[];

  // Skills selected by the user for this conversation (applied to every message)
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Skill' }], default: [] })
  selectedSkills!: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Workspace' })
  systemWorkspaceId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project', default: null, index: true })
  projectId?: Types.ObjectId | null;

  @Prop({ type: Date, index: true })
  lastMessageAt?: Date;

  @Prop({ type: Number, default: 0, min: 0 })
  messageCount!: number;

  @Prop({ type: Boolean, default: false })
  isArchived!: boolean;

  @Prop({ type: Boolean, default: false })
  isShared!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  sharedFrom?: Types.ObjectId;

  @Prop({
    type: {
      isGroup: { type: Boolean, default: false },
      members: [
        {
          userId: { type: Types.ObjectId, ref: 'User', required: true },
          joinedAt: { type: Date, required: true },
          status: { type: String, enum: ['owner', 'member'], required: true },
          job: { type: String, required: false },
          mentions: [
            {
              messageId: { type: Types.ObjectId, ref: 'Message', required: true },
              seenAt: { type: Date, required: false },
            },
          ],
        },
      ],
      invitedUsers: [
        {
          email: { type: String, required: true, trim: true, lowercase: true },
          status: { type: String, enum: ['Confirmed', 'Guest'], required: true },
          invitedAt: { type: Date, required: true },
          job: { type: String, required: false },
        },
      ],
      taggedAgents: [{ type: Types.ObjectId, ref: 'Agent' }],
    },
    required: false,
  })
  groupMeta?: {
    isGroup: boolean;
    members: {
      userId: Types.ObjectId;
      joinedAt: Date;
      status: 'owner' | 'member';
      job?: string;
    }[];
    invitedUsers: {
      email: string;
      status: 'Confirmed' | 'Guest';
      invitedAt: Date;
      job?: string;
    }[];
    taggedAgents?: Types.ObjectId[];
  };

  @Prop({ type: Boolean, default: true })
  isFirstMessage!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Compound indexes
ConversationSchema.index({ createdBy: 1, lastMessageAt: -1 });
ConversationSchema.index({ createdBy: 1, isArchived: 1, lastMessageAt: -1 });
ConversationSchema.index({ createdBy: 1, createdAt: -1 });
ConversationSchema.index({ createdBy: 1, projectId: 1, lastMessageAt: -1 });

// JSON transform
ConversationSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
