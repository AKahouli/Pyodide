import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { TrustedConversationPlaybookContextV1 } from '@modules/conversation/interfaces/conversation-playbook-handoff.interface';

export type PlaybookAssistantRequestDocument = HydratedDocument<PlaybookAssistantRequest>;
export type PlaybookAssistantOperationKind = 'inspect' | 'existing_construction' | 'generation';

@Schema({ timestamps: true })
export class PlaybookAssistantRequest {
  @Prop({ required: true, type: String, unique: true, index: true })
  requestId!: string;

  @Prop({ required: true, type: String, index: true })
  ownerId!: string;

  @Prop({ required: true, type: String })
  agentId!: string;

  @Prop({ required: true, type: String, index: true })
  conversationId!: string;

  @Prop({ required: true, type: String })
  correlationId!: string;

  @Prop({ required: true, type: String, enum: ['inspect', 'existing_construction', 'generation'] })
  operationKind!: PlaybookAssistantOperationKind;

  @Prop({ required: false, type: String, default: null, index: true })
  playbookId?: string | null;

  @Prop({ required: false, type: Number, min: 0, default: null })
  expectedDefinitionRevision?: number | null;

  @Prop({ required: true, type: String })
  contextId!: string;

  @Prop({ required: true, type: String })
  messageHash!: string;

  @Prop({ required: true, type: String })
  originalText!: string;

  @Prop({ required: false, type: String, default: null })
  requestedName?: string | null;

  @Prop({ required: false, type: Object, default: null })
  handoffContext?: TrustedConversationPlaybookContextV1 | null;

  @Prop({ required: false, type: Object, default: null })
  handoffProvenance?: {
    handoffId: string; handoffVersion: 1; sourceConversationId: string; targetMessageId: string;
    displayedAnswerVersion: string; canonicalPathFingerprint: string; contextFingerprint: string; acceptedAt: string;
  } | null;

  @Prop({ required: true, type: [String], default: [] })
  workspaceDefaultIds!: string[];

  @Prop({ required: false, type: String, default: null })
  selectedTaskId?: string | null;

  @Prop({ required: false, type: String, default: null })
  executionId?: string | null;

  @Prop({ required: true, type: [String], default: [] })
  attachmentIds!: string[];

  @Prop({ required: false, type: String, default: null, index: true })
  continuationId?: string | null;

  @Prop({ required: false, type: Object, default: null })
  assessment?: Record<string, unknown> | null;

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  assessmentVersion!: number;

  @Prop({ required: true, type: [Object], default: [] })
  answers!: Record<string, unknown>[];

  @Prop({ required: false, type: String, default: null })
  mutationOperationId?: string | null;

  @Prop({ required: false, type: String, default: null })
  assistantAnswer?: string | null;

  @Prop({ required: false, type: Object, default: null })
  responsePayload?: Record<string, unknown> | null;

  @Prop({ required: true, type: String, enum: ['processing', 'awaiting_clarification', 'ready', 'completed', 'failed'], default: 'processing', index: true })
  status!: 'processing' | 'awaiting_clarification' | 'ready' | 'completed' | 'failed';

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PlaybookAssistantRequestSchema = SchemaFactory.createForClass(PlaybookAssistantRequest);
PlaybookAssistantRequestSchema.index({ ownerId: 1, conversationId: 1, createdAt: -1 });
PlaybookAssistantRequestSchema.index({ ownerId: 1, playbookId: 1, createdAt: -1 });
PlaybookAssistantRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
