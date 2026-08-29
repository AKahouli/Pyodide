import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { TrustedConversationPlaybookContextV1 } from '../interfaces/conversation-playbook-handoff.interface';

export type ConversationPlaybookHandoffDocument = HydratedDocument<ConversationPlaybookHandoff>;

@Schema({ timestamps: true, collection: 'conversation_playbook_handoffs' })
export class ConversationPlaybookHandoff {
  @Prop({ required: true, type: Number, enum: [1] }) contractVersion!: 1;
  @Prop({ required: true, type: String }) handoffId!: string;
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' }) ownerId!: Types.ObjectId;
  @Prop({ required: true, type: Types.ObjectId, ref: 'Conversation' }) sourceConversationId!: Types.ObjectId;
  @Prop({ required: true, type: Types.ObjectId, ref: 'Message' }) targetMessageId!: Types.ObjectId;
  @Prop({ required: true, type: String }) displayedAnswerVersion!: string;
  @Prop({ required: true, type: String }) creationRequestId!: string;
  @Prop({ required: true, type: String }) creationRequestFingerprint!: string;
  @Prop({ required: true, type: String }) clientBranchSelectionFingerprint!: string;
  @Prop({ required: true, type: String }) canonicalPathFingerprint!: string;
  @Prop({ required: true, type: String }) contextFingerprint!: string;
  @Prop({ required: true, type: [Types.ObjectId], default: [] }) canonicalSelectedAnswerIds!: Types.ObjectId[];
  @Prop({ required: true, type: Types.ObjectId, ref: 'Conversation' }) platformConversationId!: Types.ObjectId;
  @Prop({ required: true, type: Object }) context!: TrustedConversationPlaybookContextV1;
  @Prop({ required: true, type: Object, default: {} }) candidateBindings!: {
    workspaceIds: string[]; documentIds: string[]; connectorIds: string[]; agentIds: string[]; skillIds: string[];
  };
  @Prop({ required: true, type: [String], default: [] }) defaultWorkspaceIds!: string[];
  @Prop({ required: true, type: String, enum: ['prepared', 'bound', 'consumed'], default: 'prepared' }) status!: 'prepared' | 'bound' | 'consumed';
  @Prop({ type: String }) boundTurnRequestId?: string;
  @Prop({ type: String }) boundPromptHash?: string;
  @Prop({ type: Types.ObjectId, ref: 'Message' }) boundUserMessageId?: Types.ObjectId;
  @Prop({ type: String }) assistantRequestId?: string;
  @Prop({ required: true, type: Date }) preparedAt!: Date;
  @Prop({ type: Date }) boundAt?: Date;
  @Prop({ type: Date }) consumedAt?: Date;
  @Prop({ required: true, type: Date }) expiresAt!: Date;
}

export const ConversationPlaybookHandoffSchema = SchemaFactory.createForClass(ConversationPlaybookHandoff);
ConversationPlaybookHandoffSchema.index({ handoffId: 1 }, { unique: true });
ConversationPlaybookHandoffSchema.index({ ownerId: 1, creationRequestId: 1 }, { unique: true });
ConversationPlaybookHandoffSchema.index({ ownerId: 1, platformConversationId: 1, status: 1 });
ConversationPlaybookHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
