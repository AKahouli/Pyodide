import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;
export type ConversationRuntimeMode = 'standard' | 'governed';
export type ConversationRuntimePurpose = 'chat' | 'platform_copilot';
export type ConversationInitializationStatus = 'ready' | 'pending' | 'seeding' | 'cleanup_pending';

@Schema({ _id: false })
export class ConversationGovernanceContext {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true }) programId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', required: true }) scopeId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeployment', required: true }) deploymentId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeploymentRevision', required: true }) revisionId!: Types.ObjectId;
  @Prop({ required: true }) revisionNumber!: number;
  @Prop({ required: true }) pinnedAt!: Date;
  @Prop({ type: Object, required: true })
  runtimeDefinition!: { primaryAgentId: string; allowedAgentIds: string[]; workspaceIds: string[] };
}

const ConversationGovernanceContextSchema = SchemaFactory.createForClass(ConversationGovernanceContext);

@Schema({
  timestamps: true,
  collection: 'conversations',
})
export class Conversation extends Document {
  @Prop({ type: String, enum: ['standard', 'governed'], default: 'standard', index: true })
  runtimeMode!: ConversationRuntimeMode;

  @Prop({ type: String, enum: ['chat', 'platform_copilot'], default: 'chat', index: true })
  runtimePurpose!: ConversationRuntimePurpose;

  @Prop({ type: Types.ObjectId, ref: 'Agent', default: null })
  pinnedAgentId?: Types.ObjectId | null;

  @Prop({ type: String })
  platformCopilotCreationRequestId?: string;

  @Prop({ type: ConversationGovernanceContextSchema })
  governanceContext?: ConversationGovernanceContext;

  @Prop({ type: String })
  governedCreationRequestId?: string;
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

  // Sticky agent routing: last @mentioned agents; reused when a turn has no mentions
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Agent' }], default: [] })
  taggedAgentIds!: Types.ObjectId[];

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

  @Prop({ type: String, enum: ['ready', 'pending', 'seeding', 'cleanup_pending'], default: 'ready', index: true })
  initializationStatus!: ConversationInitializationStatus;

  @Prop({ type: String })
  branchSeedAttemptId?: string;

  @Prop({
    type: {
      sourceConversationId: { type: Types.ObjectId, ref: 'Conversation', required: true },
      sourceTargetMessageId: { type: Types.ObjectId, ref: 'Message', required: true },
      requestId: { type: String, required: true },
      requestFingerprint: { type: String, required: true },
      branchedBy: { type: Types.ObjectId, ref: 'User', required: true },
      branchedAt: { type: Date, required: true },
      selectedAnswerIds: [{ type: Types.ObjectId, ref: 'Message' }],
    },
    required: false,
  })
  branchProvenance?: {
    sourceConversationId: Types.ObjectId;
    sourceTargetMessageId: Types.ObjectId;
    requestId: string;
    requestFingerprint: string;
    branchedBy: Types.ObjectId;
    branchedAt: Date;
    selectedAnswerIds: Types.ObjectId[];
  };

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
ConversationSchema.index(
  { createdBy: 1, platformCopilotCreationRequestId: 1 },
  {
    name: 'platform_copilot_creation_request_unique',
    unique: true,
    partialFilterExpression: { platformCopilotCreationRequestId: { $exists: true, $type: 'string' } },
  },
);
ConversationSchema.index({ createdBy: 1, governedCreationRequestId: 1 }, { unique: true, partialFilterExpression: { governedCreationRequestId: { $exists: true, $type: 'string' } } });
ConversationSchema.index(
  { createdBy: 1, 'branchProvenance.requestId': 1 },
  { unique: true, partialFilterExpression: { 'branchProvenance.requestId': { $exists: true, $type: 'string' } } },
);

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
